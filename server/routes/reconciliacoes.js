import { Router } from 'express';
import { db } from '../db/db.js';
import { HttpError, positiveInteger } from '../lib/http.js';
import { refreshStatus } from './lotes.js';
import { requireAdmin } from '../lib/auth.js';
import { getModel, sameResponses, validateResponses } from '../lib/models.js';

export const reconciliacoesRouter = Router();
reconciliacoesRouter.use(requireAdmin);

reconciliacoesRouter.post('/:itemId', (req, res) => {
  const itemId = positiveInteger(req.params.itemId, 'itemId');
  const item = db.prepare('SELECT li.lote_id, l.tipo_avaliacao, l.modelo_avaliacao_id, m.sistema AS modelo_sistema FROM lote_itens li JOIN lotes l ON l.id = li.lote_id JOIN modelos_avaliacao m ON m.id = l.modelo_avaliacao_id WHERE li.id = ?').get(itemId);
  if (!item) throw new HttpError(404, 'Item não encontrado.');
  if (item.tipo_avaliacao !== 'dupla') throw new HttpError(400, 'Reconciliação só é permitida em lotes de avaliação dupla.');
  if (item.modelo_sistema !== 'hate_v1') {
    const model = getModel(item.modelo_avaliacao_id);
    const answers = validateResponses(model, req.body.respostasFinais);
    const reviews = db.prepare('SELECT id FROM avaliacoes WHERE item_id = ? ORDER BY id').all(itemId).map((review) => Object.fromEntries(db.prepare('SELECT c.chave, ar.valor_json FROM avaliacao_respostas ar JOIN campos_modelo c ON c.id = ar.campo_id WHERE ar.avaliacao_id = ?').all(review.id).map((row) => [row.chave, JSON.parse(row.valor_json)])));
    if (reviews.length !== 2 || sameResponses(reviews[0], reviews[1])) throw new HttpError(409, 'O item precisa ter duas respostas divergentes para ser reconciliado.');
    db.prepare(`INSERT INTO reconciliacoes_personalizadas (item_id, respostas_json, decidido_por) VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET respostas_json = excluded.respostas_json, decidido_por = excluded.decidido_por, atualizado_em = CURRENT_TIMESTAMP`).run(itemId, JSON.stringify(answers), req.user.id);
    refreshStatus(item.lote_id);
    return res.json({ itemId, respostasFinais: answers, decididoPor: req.user.id });
  }
  const decisao = req.body.decisaoFinal;
  const categorias = [...new Set((req.body.categoriasFinais || []).map(Number))];
  const decididoPor = req.user.id;
  if (!['hate', 'nao_hate'].includes(decisao)) throw new HttpError(400, 'Decisão final inválida.');
  if (decisao === 'hate' && !categorias.length) throw new HttpError(400, 'Selecione ao menos uma categoria final para Hate.');
  if (decisao === 'nao_hate' && categorias.length) throw new HttpError(400, 'Não Hate não deve possuir categorias finais.');
  const reviews = db.prepare('SELECT id, classificacao FROM avaliacoes WHERE item_id = ? ORDER BY id').all(itemId);
  const categorySets = reviews.map((review) => db.prepare('SELECT categoria_id FROM avaliacao_categorias WHERE avaliacao_id = ? ORDER BY categoria_id').all(review.id).map((row) => row.categoria_id));
  const divergent = reviews.length === 2 && (reviews[0].classificacao !== reviews[1].classificacao || JSON.stringify(categorySets[0]) !== JSON.stringify(categorySets[1]));
  if (!divergent) throw new HttpError(409, 'O item precisa ter classificações ou categorias divergentes para ser adjudicado.');
  db.prepare(`
    INSERT INTO reconciliacoes (item_id, decisao_final, categorias_finais, decidido_por)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET decisao_final = excluded.decisao_final,
      categorias_finais = excluded.categorias_finais, decidido_por = excluded.decidido_por,
      atualizado_em = CURRENT_TIMESTAMP
  `).run(itemId, decisao, JSON.stringify(categorias), decididoPor);
  refreshStatus(item.lote_id);
  res.json({ itemId, decisaoFinal: decisao, categoriasFinais: categorias, decididoPor });
});
