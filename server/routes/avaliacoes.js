import { Router } from 'express';
import { db, transaction } from '../db/db.js';
import { HttpError, positiveInteger } from '../lib/http.js';
import { refreshStatus } from './lotes.js';
import { requireEvaluator } from '../lib/auth.js';
import { getModel, validateResponses } from '../lib/models.js';

export const avaliacoesRouter = Router();

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
