import { Router } from 'express';
import { db, transaction } from '../db/db.js';
import { HttpError, nonEmptyText, positiveInteger } from '../lib/http.js';
import { requireAdmin, requireEvaluator } from '../lib/auth.js';

export const lotesRouter = Router();

const loteSelect = `
  SELECT l.*,
    COUNT(DISTINCT li.id) AS total_itens,
    COUNT(DISTINCT av.id) AS avaliacoes_feitas,
    COUNT(DISTINCT la.avaliador_id) AS total_avaliadores,
    GROUP_CONCAT(DISTINCT a.nome) AS avaliadores_nomes,
    GROUP_CONCAT(DISTINCT a.id) AS avaliadores_ids
  FROM lotes l
  LEFT JOIN lote_itens li ON li.lote_id = l.id
  LEFT JOIN avaliacoes av ON av.item_id = li.id
  LEFT JOIN lote_avaliadores la ON la.lote_id = l.id
  LEFT JOIN avaliadores a ON a.id = la.avaliador_id
`;

function normalizeAssignment(tipo, ids) {
  if (!['individual', 'dupla', 'conjunto'].includes(tipo)) throw new HttpError(400, 'Tipo de avaliação inválido.');
  const unique = [...new Set((ids || []).map(Number))];
  const invalidIds = unique.some((id) => !Number.isInteger(id) || id <= 0);
  const validCount = tipo === 'conjunto' ? unique.length >= 2 && unique.length <= 50 : unique.length === (tipo === 'dupla' ? 2 : 1);
  if (!validCount || invalidIds) {
    const message = tipo === 'conjunto' ? 'Selecione entre 2 e 50 avaliadores para o modo conjunto.' : `Selecione ${tipo === 'dupla' ? 2 : 1} avaliador${tipo === 'dupla' ? 'es' : ''} para o modo ${tipo}.`;
    throw new HttpError(400, message);
  }
  const found = db.prepare(`SELECT COUNT(*) AS total FROM avaliadores WHERE papel = 'avaliador' AND ativo = 1 AND username IS NOT NULL AND senha_hash IS NOT NULL AND id IN (${unique.map(() => '?').join(',')})`).get(...unique).total;
  if (found !== unique.length) throw new HttpError(400, 'Um ou mais avaliadores não possuem usuário e senha ativos. Edite o cadastro antes de atribuir o lote.');
  return { ids: unique, tipoBanco: tipo === 'conjunto' ? 'individual' : tipo, conjunta: tipo === 'conjunto' };
}

function distributeJointItems(loteId, evaluatorIds, joint) {
  db.prepare('DELETE FROM lote_item_avaliadores WHERE item_id IN (SELECT id FROM lote_itens WHERE lote_id = ?)').run(loteId);
  if (!joint) return;
  const items = db.prepare('SELECT id FROM lote_itens WHERE lote_id = ? ORDER BY linha_index, id').all(loteId);
  const insert = db.prepare('INSERT INTO lote_item_avaliadores (item_id, avaliador_id) VALUES (?, ?)');
  items.forEach((item, index) => insert.run(item.id, evaluatorIds[index % evaluatorIds.length]));
}

function presentLots(rows, user) {
  return rows.map((row) => {
    const required = Number(row.total_itens) * (row.tipo_avaliacao === 'dupla' ? 2 : 1);
    const presented = {
      ...row,
      modo_avaliacao: row.distribuicao_conjunta ? 'conjunto' : row.tipo_avaliacao,
      progresso: required ? Number(row.avaliacoes_feitas) / required : 0
    };
    if (user.papel === 'avaliador') {
      if (row.distribuicao_conjunta) {
        presented.itens_usuario = db.prepare(`SELECT COUNT(*) AS total FROM lote_item_avaliadores lia JOIN lote_itens li ON li.id = lia.item_id WHERE li.lote_id = ? AND lia.avaliador_id = ?`).get(row.id, user.id).total;
      } else {
        presented.itens_usuario = Number(row.total_itens);
      }
      presented.avaliacoes_usuario = db.prepare(`SELECT COUNT(*) AS total FROM avaliacoes av JOIN lote_itens li ON li.id = av.item_id WHERE li.lote_id = ? AND av.avaliador_id = ?`).get(row.id, user.id).total;
    }
    return presented;
  });
}

function refreshStatus(loteId) {
  const stats = db.prepare(`
    SELECT l.status, l.tipo_avaliacao, COUNT(DISTINCT li.id) AS itens, COUNT(DISTINCT av.id) AS feitas,
      COUNT(DISTINCT la.avaliador_id) AS avaliadores
    FROM lotes l
    LEFT JOIN lote_itens li ON li.lote_id = l.id
    LEFT JOIN avaliacoes av ON av.item_id = li.id
    LEFT JOIN lote_avaliadores la ON la.lote_id = l.id
    WHERE l.id = ? GROUP BY l.id
  `).get(loteId);
  if (!stats) return;
  const required = stats.itens * (stats.tipo_avaliacao === 'dupla' ? 2 : 1);
  let status = 'pendente';
  if (stats.feitas > 0) status = 'em_andamento';
  if (stats.feitas >= required) {
    const unresolved = stats.tipo_avaliacao === 'dupla' ? db.prepare(`
      SELECT COUNT(*) AS total FROM (
        SELECT li.id FROM lote_itens li
        JOIN avaliacoes av ON av.item_id = li.id
        LEFT JOIN reconciliacoes r ON r.item_id = li.id
        WHERE li.lote_id = ? GROUP BY li.id
        HAVING COUNT(av.id) = 2 AND COUNT(DISTINCT av.classificacao) = 2 AND MAX(r.item_id) IS NULL
      )
    `).get(loteId).total : 0;
    if (!unresolved) status = 'concluido';
  }
  db.prepare('UPDATE lotes SET status = ? WHERE id = ?').run(status, loteId);
}

lotesRouter.get('/', (req, res) => {
  const scope = req.user.papel === 'admin' ? '' : 'WHERE EXISTS (SELECT 1 FROM lote_avaliadores own WHERE own.lote_id = l.id AND own.avaliador_id = ?)';
  const statement = db.prepare(`${loteSelect} ${scope} GROUP BY l.id ORDER BY l.data_upload DESC, l.id DESC`);
  const rows = req.user.papel === 'admin' ? statement.all() : statement.all(req.user.id);
  res.json(presentLots(rows, req.user));
});

lotesRouter.post('/', requireAdmin, (req, res) => {
  const nomeArquivo = nonEmptyText(req.body.nomeArquivo, 'Nome do arquivo', 255);
  const colunaConteudo = nonEmptyText(req.body.colunaConteudo, 'Coluna de conteúdo', 255);
  const colunaResultado = 'hate/no_hate';
  const assignment = normalizeAssignment(req.body.tipoAvaliacao, req.body.avaliadoresAtribuidos);
  const linhas = req.body.linhas;
  if (!Array.isArray(linhas) || !linhas.length) throw new HttpError(400, 'O lote precisa ter ao menos uma linha válida.');
  if (linhas.length > 100000) throw new HttpError(413, 'O lote excede o limite de 100.000 linhas.');

  const empty = [];
  const duplicate = [];
  const seen = new Map();
  linhas.forEach((linha, index) => {
    const content = String(linha.conteudo ?? '').trim();
    if (!content) empty.push(index + 1);
    const key = content.toLocaleLowerCase('pt-BR');
    if (content && seen.has(key)) duplicate.push([seen.get(key), index + 1]);
    else if (content) seen.set(key, index + 1);
  });
  if (empty.length || duplicate.length) {
    throw new HttpError(422, 'O CSV contém linhas inválidas.', { linhasVazias: empty.slice(0, 30), duplicadas: duplicate.slice(0, 30) });
  }

  const loteId = transaction(() => {
    const lote = db.prepare(`
      INSERT INTO lotes (nome_arquivo, coluna_conteudo, coluna_resultado, tipo_avaliacao, distribuicao_conjunta)
      VALUES (?, ?, ?, ?, ?)
    `).run(nomeArquivo, colunaConteudo, colunaResultado, assignment.tipoBanco, assignment.conjunta ? 1 : 0);
    const id = Number(lote.lastInsertRowid);
    const insertItem = db.prepare(`INSERT INTO lote_itens (lote_id, linha_index, conteudo, dados_originais) VALUES (?, ?, ?, ?)`);
    linhas.forEach((linha, index) => insertItem.run(id, Number(linha.linhaIndex) || index + 1, String(linha.conteudo).trim(), JSON.stringify(linha.dadosOriginais || {})));
    const assign = db.prepare('INSERT INTO lote_avaliadores (lote_id, avaliador_id, ordem) VALUES (?, ?, ?)');
    assignment.ids.forEach((avaliadorId, index) => assign.run(id, avaliadorId, index + 1));
    distributeJointItems(id, assignment.ids, assignment.conjunta);
    return id;
  });

  res.status(201).json(presentLots([db.prepare(`${loteSelect} WHERE l.id = ? GROUP BY l.id`).get(loteId)], req.user)[0]);
});

lotesRouter.get('/:id/itens', requireAdmin, (req, res) => {
  const loteId = positiveInteger(req.params.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const rows = db.prepare(`
    SELECT li.id, li.linha_index, li.conteudo, li.dados_originais,
      COUNT(av.id) AS total_avaliacoes
    FROM lote_itens li LEFT JOIN avaliacoes av ON av.item_id = li.id
    WHERE li.lote_id = ? GROUP BY li.id ORDER BY li.linha_index LIMIT ? OFFSET ?
  `).all(loteId, limit, (page - 1) * limit);
  const total = db.prepare('SELECT COUNT(*) AS total FROM lote_itens WHERE lote_id = ?').get(loteId).total;
  res.json({ items: rows.map((row) => ({ ...row, dados_originais: JSON.parse(row.dados_originais) })), page, limit, total });
});

lotesRouter.get('/:id/pendentes/:avaliadorId', requireEvaluator, (req, res) => {
  const loteId = positiveInteger(req.params.id, 'loteId');
  const avaliadorId = positiveInteger(req.params.avaliadorId, 'avaliadorId');
  if (avaliadorId !== req.user.id) throw new HttpError(403, 'Você só pode acessar sua própria fila de avaliação.');
  const includeReviewed = req.query.todos === '1';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 100;
  const lote = db.prepare('SELECT distribuicao_conjunta FROM lotes WHERE id = ?').get(loteId);
  if (!lote) throw new HttpError(404, 'Lote não encontrado.');
  const assigned = db.prepare('SELECT 1 FROM lote_avaliadores WHERE lote_id = ? AND avaliador_id = ?').get(loteId, avaliadorId);
  if (!assigned) throw new HttpError(403, 'O lote não está atribuído a este avaliador.');
  const condition = includeReviewed ? '' : 'AND av.id IS NULL';
  const jointScope = lote.distribuicao_conjunta ? 'AND EXISTS (SELECT 1 FROM lote_item_avaliadores lia WHERE lia.item_id = li.id AND lia.avaliador_id = ?)' : '';
  const itemParams = [avaliadorId, loteId, ...(lote.distribuicao_conjunta ? [avaliadorId] : []), limit, (page - 1) * limit];
  const items = db.prepare(`
    SELECT li.id, li.linha_index, li.conteudo, av.classificacao, av.id AS avaliacao_id,
      COALESCE(json_group_array(ac.categoria_id) FILTER (WHERE ac.categoria_id IS NOT NULL), '[]') AS categorias
    FROM lote_itens li
    LEFT JOIN avaliacoes av ON av.item_id = li.id AND av.avaliador_id = ?
    LEFT JOIN avaliacao_categorias ac ON ac.avaliacao_id = av.id
    WHERE li.lote_id = ? ${jointScope} ${condition}
    GROUP BY li.id ORDER BY li.linha_index LIMIT ? OFFSET ?
  `).all(...itemParams).map((row) => ({ ...row, categorias: JSON.parse(row.categorias) }));
  const statParams = [avaliadorId, loteId, ...(lote.distribuicao_conjunta ? [avaliadorId] : [])];
  const stats = db.prepare(`
    SELECT COUNT(*) AS total, COUNT(av.id) AS avaliados
    FROM lote_itens li LEFT JOIN avaliacoes av ON av.item_id = li.id AND av.avaliador_id = ?
    WHERE li.lote_id = ? ${jointScope}
  `).get(...statParams);
  res.json({ items, ...stats, page, limit });
});

lotesRouter.patch('/:id', requireAdmin, (req, res) => {
  const id = positiveInteger(req.params.id);
  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(id);
  if (!lote) throw new HttpError(404, 'Lote não encontrado.');
  const currentMode = lote.distribuicao_conjunta ? 'conjunto' : lote.tipo_avaliacao;
  const tipo = req.body.tipoAvaliacao || currentMode;
  const assigned = req.body.avaliadoresAtribuidos || db.prepare('SELECT avaliador_id FROM lote_avaliadores WHERE lote_id = ? ORDER BY ordem').all(id).map((row) => row.avaliador_id);
  const assignment = normalizeAssignment(tipo, assigned);
  const hasReviews = db.prepare('SELECT 1 FROM avaliacoes av JOIN lote_itens li ON li.id = av.item_id WHERE li.lote_id = ? LIMIT 1').get(id);
  if (hasReviews && (tipo !== currentMode || req.body.avaliadoresAtribuidos)) throw new HttpError(409, 'Não é possível alterar o tipo ou a atribuição após o início das avaliações.');
  transaction(() => {
    db.prepare('UPDATE lotes SET tipo_avaliacao = ?, distribuicao_conjunta = ? WHERE id = ?').run(assignment.tipoBanco, assignment.conjunta ? 1 : 0, id);
    if (!hasReviews) {
      db.prepare('DELETE FROM lote_avaliadores WHERE lote_id = ?').run(id);
      const assign = db.prepare('INSERT INTO lote_avaliadores (lote_id, avaliador_id, ordem) VALUES (?, ?, ?)');
      assignment.ids.forEach((avaliadorId, index) => assign.run(id, avaliadorId, index + 1));
      distributeJointItems(id, assignment.ids, assignment.conjunta);
    }
  });
  refreshStatus(id);
  res.json(presentLots([db.prepare(`${loteSelect} WHERE l.id = ? GROUP BY l.id`).get(id)], req.user)[0]);
});

lotesRouter.delete('/:id', requireAdmin, (req, res) => {
  const id = positiveInteger(req.params.id);
  const result = db.prepare('DELETE FROM lotes WHERE id = ?').run(id);
  if (!result.changes) throw new HttpError(404, 'Lote não encontrado.');
  res.status(204).end();
});

export { refreshStatus };
