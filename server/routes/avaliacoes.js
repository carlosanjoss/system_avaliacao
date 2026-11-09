import { Router } from 'express';
import { db, transaction } from '../db/db.js';
import { HttpError, positiveInteger } from '../lib/http.js';
import { refreshStatus } from './lotes.js';
import { requireAdmin, requireEvaluator } from '../lib/auth.js';
import { formatResponse, getModel, validateResponses } from '../lib/models.js';

export const avaliacoesRouter = Router();

function ratio(part, total) {
  return total ? Number(part) / Number(total) : 0;
}

function legacySummary(total, hate, naoHate, categories) {
  return {
    total,
    hate,
    naoHate,
    hatePercent: ratio(hate, total),
    naoHatePercent: ratio(naoHate, total),
    categories: categories.map((category) => ({
      ...category,
      percent: ratio(category.count, hate)
    }))
  };
}

avaliacoesRouter.get('/estatisticas', requireAdmin, (req, res) => {
  const lots = db.prepare(`
    SELECT l.id, l.nome_arquivo, l.data_upload, l.tipo_avaliacao, l.distribuicao_conjunta,
      m.id AS modelo_id, m.nome AS modelo_nome, m.versao AS modelo_versao, m.sistema AS modelo_sistema,
      COUNT(DISTINCT li.id) AS total_itens, COUNT(DISTINCT av.id) AS avaliacoes_feitas
    FROM lotes l
    JOIN modelos_avaliacao m ON m.id = l.modelo_avaliacao_id
    LEFT JOIN lote_itens li ON li.lote_id = l.id
    LEFT JOIN avaliacoes av ON av.item_id = li.id
    GROUP BY l.id
    ORDER BY l.data_upload DESC, l.id DESC
  `).all();
  const categories = db.prepare('SELECT id, nome FROM categorias_odio ORDER BY ordem').all();
  const legacyCounts = new Map(db.prepare(`
    SELECT li.lote_id, COUNT(*) AS total,
      SUM(CASE WHEN av.classificacao = 'hate' THEN 1 ELSE 0 END) AS hate,
      SUM(CASE WHEN av.classificacao = 'nao_hate' THEN 1 ELSE 0 END) AS nao_hate
    FROM avaliacoes av
    JOIN lote_itens li ON li.id = av.item_id
    JOIN lotes l ON l.id = li.lote_id
    JOIN modelos_avaliacao m ON m.id = l.modelo_avaliacao_id
    WHERE m.sistema = 'hate_v1'
    GROUP BY li.lote_id
  `).all().map((row) => [row.lote_id, row]));
  const categoryCounts = new Map();
  db.prepare(`
    SELECT li.lote_id, c.id, c.nome, COUNT(*) AS total
    FROM avaliacao_categorias ac
    JOIN categorias_odio c ON c.id = ac.categoria_id
    JOIN avaliacoes av ON av.id = ac.avaliacao_id
    JOIN lote_itens li ON li.id = av.item_id
    GROUP BY li.lote_id, c.id
  `).all().forEach((row) => {
    if (!categoryCounts.has(row.lote_id)) categoryCounts.set(row.lote_id, new Map());
    categoryCounts.get(row.lote_id).set(row.id, Number(row.total));
  });
  const answerCounts = new Map();
  db.prepare(`
    SELECT li.lote_id, ar.campo_id, ar.valor_json
    FROM avaliacao_respostas ar
    JOIN avaliacoes av ON av.id = ar.avaliacao_id
    JOIN lote_itens li ON li.id = av.item_id
  `).all().forEach((row) => {
    const key = `${row.lote_id}:${row.campo_id}`;
    if (!answerCounts.has(key)) answerCounts.set(key, []);
    answerCounts.get(key).push(JSON.parse(row.valor_json));
  });

  const modelCache = new Map();
  const resultLots = lots.map((lot) => {
    const totalItems = Number(lot.total_itens);
    const completedReviews = Number(lot.avaliacoes_feitas);
    const requiredReviews = totalItems * (lot.tipo_avaliacao === 'dupla' ? 2 : 1);
    const base = {
      id: lot.id,
      fileName: lot.nome_arquivo,
      uploadedAt: lot.data_upload,
      model: { id: lot.modelo_id, name: lot.modelo_nome, version: lot.modelo_versao, system: lot.modelo_sistema },
      mode: lot.distribuicao_conjunta ? 'conjunto' : lot.tipo_avaliacao,
      totalItems,
      requiredReviews,
      completedReviews,
      progress: ratio(completedReviews, requiredReviews)
    };
    if (lot.modelo_sistema === 'hate_v1') {
      const count = legacyCounts.get(lot.id) || { total: 0, hate: 0, nao_hate: 0 };
      const lotCategories = categoryCounts.get(lot.id) || new Map();
      return {
        ...base,
        type: 'hate_v1',
        results: legacySummary(
          Number(count.total),
          Number(count.hate),
          Number(count.nao_hate),
          categories.map((category) => ({ id: category.id, label: category.nome, count: lotCategories.get(category.id) || 0 }))
        )
      };
    }
    if (!modelCache.has(lot.modelo_id)) modelCache.set(lot.modelo_id, getModel(lot.modelo_id));
    const model = modelCache.get(lot.modelo_id);
    const fields = model.campos.map((field) => {
      const answers = answerCounts.get(`${lot.id}:${field.id}`) || [];
      const responseCount = answers.length;
      if (field.tipo === 'texto') {
        const answered = answers.filter((value) => String(value ?? '').trim()).length;
        return { id: field.id, key: field.chave, label: field.rotulo, type: field.tipo, responseCount, coverage: ratio(responseCount, completedReviews), answered, options: [] };
      }
      const counts = new Map(field.opcoes.map((option) => [option.valor, 0]));
      answers.forEach((answer) => {
        const values = Array.isArray(answer) ? answer : [answer];
        values.forEach((value) => counts.set(String(value), (counts.get(String(value)) || 0) + 1));
      });
      return {
        id: field.id,
        key: field.chave,
        label: field.rotulo,
        type: field.tipo,
        responseCount,
        coverage: ratio(responseCount, completedReviews),
        options: field.opcoes.map((option) => ({ value: option.valor, label: option.rotulo, count: counts.get(option.valor) || 0, percent: ratio(counts.get(option.valor) || 0, responseCount) }))
      };
    });
    return { ...base, type: 'custom', results: { fields } };
  });

  const legacyLots = resultLots.filter((lot) => lot.type === 'hate_v1');
  const overallHate = legacyLots.reduce((sum, lot) => sum + lot.results.hate, 0);
  const overallNaoHate = legacyLots.reduce((sum, lot) => sum + lot.results.naoHate, 0);
  const overallCategories = categories.map((category) => ({
    id: category.id,
    label: category.nome,
    count: legacyLots.reduce((sum, lot) => sum + (lot.results.categories.find((item) => item.id === category.id)?.count || 0), 0)
  }));
  const requiredReviews = resultLots.reduce((sum, lot) => sum + lot.requiredReviews, 0);
  const completedReviews = resultLots.reduce((sum, lot) => sum + lot.completedReviews, 0);
  res.json({
    generatedAt: new Date().toISOString(),
    overall: {
      totalItems: resultLots.reduce((sum, lot) => sum + lot.totalItems, 0),
      requiredReviews,
      completedReviews,
      progress: ratio(completedReviews, requiredReviews),
      legacy: legacySummary(overallHate + overallNaoHate, overallHate, overallNaoHate, overallCategories)
    },
    lots: resultLots
  });
});

avaliacoesRouter.get('/auditoria', requireAdmin, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const avaliadorId = req.query.avaliadorId ? positiveInteger(req.query.avaliadorId, 'avaliadorId') : null;
  const loteId = req.query.loteId ? positiveInteger(req.query.loteId, 'loteId') : null;
  const busca = String(req.query.busca || '').trim().slice(0, 200);
  const conditions = [];
  const params = [];
  if (avaliadorId) {
    conditions.push('av.avaliador_id = ?');
    params.push(avaliadorId);
  }
  if (loteId) {
    conditions.push('li.lote_id = ?');
    params.push(loteId);
  }
  if (busca) {
    conditions.push('(LOWER(li.conteudo) LIKE LOWER(?) OR LOWER(l.nome_arquivo) LIKE LOWER(?) OR LOWER(a.nome) LIKE LOWER(?))');
    const pattern = `%${busca}%`;
    params.push(pattern, pattern, pattern);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const from = `
    FROM avaliacoes av
    JOIN lote_itens li ON li.id = av.item_id
    JOIN lotes l ON l.id = li.lote_id
    JOIN avaliadores a ON a.id = av.avaliador_id
    JOIN modelos_avaliacao m ON m.id = l.modelo_avaliacao_id
  `;
  const total = db.prepare(`SELECT COUNT(*) AS total ${from} ${where}`).get(...params).total;
  const rows = db.prepare(`
    SELECT av.id, av.classificacao, av.criado_em, av.atualizado_em,
      a.id AS avaliador_id, a.nome AS avaliador_nome,
      l.id AS lote_id, l.nome_arquivo, li.id AS item_id, li.linha_index, li.conteudo,
      m.id AS modelo_id, m.nome AS modelo_nome, m.versao AS modelo_versao, m.sistema AS modelo_sistema
    ${from} ${where}
    ORDER BY av.atualizado_em DESC, av.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, (page - 1) * limit);

  const modelCache = new Map();
  const items = rows.map((row) => {
    let respostas;
    if (row.modelo_sistema === 'hate_v1') {
      const categorias = db.prepare(`
        SELECT c.nome FROM avaliacao_categorias ac
        JOIN categorias_odio c ON c.id = ac.categoria_id
        WHERE ac.avaliacao_id = ? ORDER BY c.ordem
      `).all(row.id).map((item) => item.nome);
      respostas = [{ rotulo: 'Classificação', valor: row.classificacao === 'hate' ? 'Hate' : 'Não Hate' }];
      if (categorias.length) respostas.push({ rotulo: 'Categorias', valor: categorias.join(', ') });
    } else {
      if (!modelCache.has(row.modelo_id)) modelCache.set(row.modelo_id, getModel(row.modelo_id));
      const model = modelCache.get(row.modelo_id);
      const values = new Map(db.prepare(`
        SELECT c.chave, ar.valor_json FROM avaliacao_respostas ar
        JOIN campos_modelo c ON c.id = ar.campo_id
        WHERE ar.avaliacao_id = ?
      `).all(row.id).map((answer) => [answer.chave, JSON.parse(answer.valor_json)]));
      respostas = model.campos
        .filter((field) => values.has(field.chave))
        .map((field) => ({ rotulo: field.rotulo, valor: formatResponse(field, values.get(field.chave)) }));
    }
    return { ...row, respostas };
  });

  res.json({ items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

avaliacoesRouter.get('/categorias', (req, res) => {
  res.json(db.prepare('SELECT id, nome, ordem FROM categorias_odio ORDER BY ordem').all());
});

avaliacoesRouter.post('/', requireEvaluator, (req, res) => {
  const itemId = positiveInteger(req.body.itemId, 'itemId');
  const avaliadorId = req.user.id;
  const classificacao = req.body.classificacao;
  const categorias = [...new Set((req.body.categorias || []).map(Number))];

  const item = db.prepare('SELECT li.lote_id, l.distribuicao_conjunta, l.modelo_avaliacao_id, m.sistema AS modelo_sistema FROM lote_itens li JOIN lotes l ON l.id = li.lote_id JOIN modelos_avaliacao m ON m.id = l.modelo_avaliacao_id WHERE li.id = ?').get(itemId);
  if (!item) throw new HttpError(404, 'Item não encontrado.');
  if (!db.prepare('SELECT 1 FROM lote_avaliadores WHERE lote_id = ? AND avaliador_id = ?').get(item.lote_id, avaliadorId)) {
    throw new HttpError(403, 'Este item não está atribuído ao avaliador selecionado.');
  }
  if (item.distribuicao_conjunta && !db.prepare('SELECT 1 FROM lote_item_avaliadores WHERE item_id = ? AND avaliador_id = ?').get(itemId, avaliadorId)) {
    throw new HttpError(403, 'Este item pertence à fila de outro avaliador.');
  }
  const legacy = item.modelo_sistema === 'hate_v1';
  let respostas = null;
  if (legacy) {
    if (!['hate', 'nao_hate'].includes(classificacao)) throw new HttpError(400, 'Classificação inválida.');
    if (classificacao === 'hate' && !categorias.length) throw new HttpError(400, 'Selecione ao menos uma categoria para Hate.');
    if (classificacao === 'nao_hate' && categorias.length) throw new HttpError(400, 'Não Hate não deve possuir categorias de ódio.');
  } else {
    respostas = validateResponses(getModel(item.modelo_avaliacao_id), req.body.respostas);
  }
  if (legacy && categorias.length) {
    const found = db.prepare(`SELECT COUNT(*) AS total FROM categorias_odio WHERE id IN (${categorias.map(() => '?').join(',')})`).get(...categorias).total;
    if (found !== categorias.length) throw new HttpError(400, 'Categoria inválida.');
  }

  const avaliacaoId = transaction(() => {
    db.prepare(`
      INSERT INTO avaliacoes (item_id, avaliador_id, classificacao)
      VALUES (?, ?, ?)
      ON CONFLICT(item_id, avaliador_id) DO UPDATE SET classificacao = excluded.classificacao, atualizado_em = CURRENT_TIMESTAMP
    `).run(itemId, avaliadorId, legacy ? classificacao : null);
    const avaliacao = db.prepare('SELECT id FROM avaliacoes WHERE item_id = ? AND avaliador_id = ?').get(itemId, avaliadorId);
    db.prepare('DELETE FROM avaliacao_categorias WHERE avaliacao_id = ?').run(avaliacao.id);
    const insert = db.prepare('INSERT INTO avaliacao_categorias (avaliacao_id, categoria_id) VALUES (?, ?)');
    if (legacy) categorias.forEach((categoriaId) => insert.run(avaliacao.id, categoriaId));
    db.prepare('DELETE FROM avaliacao_respostas WHERE avaliacao_id = ?').run(avaliacao.id);
    if (!legacy) {
      const model = getModel(item.modelo_avaliacao_id);
      const fields = new Map(model.campos.map((field) => [field.chave, field]));
      const insertAnswer = db.prepare('INSERT INTO avaliacao_respostas (avaliacao_id, campo_id, valor_json) VALUES (?, ?, ?)');
      Object.entries(respostas).forEach(([key, value]) => insertAnswer.run(avaliacao.id, fields.get(key).id, JSON.stringify(value)));
    }
    return avaliacao.id;
  });
  refreshStatus(item.lote_id);
  res.json({ id: avaliacaoId, itemId, avaliadorId, classificacao: legacy ? classificacao : null, categorias: legacy ? categorias : [], respostas: respostas || {} });
});
