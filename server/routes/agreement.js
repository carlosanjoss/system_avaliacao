import { Router } from 'express';
import { db } from '../db/db.js';
import { calculateAgreement } from '../lib/agreement.js';
import { HttpError, positiveInteger } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';

export const agreementRouter = Router();

agreementRouter.get('/:id/concordancia', requireAdmin, (req, res) => {
  const loteId = positiveInteger(req.params.id);
  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
  if (!lote) throw new HttpError(404, 'Lote não encontrado.');
  if (lote.tipo_avaliacao !== 'dupla') throw new HttpError(400, 'Concordância está disponível apenas para lotes em dupla.');
  const evaluators = db.prepare(`
    SELECT a.id, a.nome, la.ordem FROM lote_avaliadores la
    JOIN avaliadores a ON a.id = la.avaliador_id WHERE la.lote_id = ? ORDER BY la.ordem
  `).all(loteId);
  const rows = db.prepare(`
    SELECT li.id AS item_id, li.linha_index, li.conteudo,
      MAX(CASE WHEN la.ordem = 1 THEN av.classificacao END) AS a1,
      MAX(CASE WHEN la.ordem = 2 THEN av.classificacao END) AS a2,
      MAX(CASE WHEN la.ordem = 1 THEN av.id END) AS av1_id,
      MAX(CASE WHEN la.ordem = 2 THEN av.id END) AS av2_id,
      r.decisao_final, r.categorias_finais
    FROM lote_itens li
    LEFT JOIN lote_avaliadores la ON la.lote_id = li.lote_id
    LEFT JOIN avaliacoes av ON av.item_id = li.id AND av.avaliador_id = la.avaliador_id
    LEFT JOIN reconciliacoes r ON r.item_id = li.id
    WHERE li.lote_id = ? GROUP BY li.id ORDER BY li.linha_index
  `).all(loteId);
  const categories = db.prepare(`
    SELECT ac.avaliacao_id, c.id, c.nome FROM avaliacao_categorias ac
    JOIN categorias_odio c ON c.id = ac.categoria_id
    JOIN avaliacoes av ON av.id = ac.avaliacao_id
    JOIN lote_itens li ON li.id = av.item_id WHERE li.lote_id = ? ORDER BY c.ordem
  `).all(loteId);
  const byReview = new Map();
  categories.forEach((category) => {
    if (!byReview.has(category.avaliacao_id)) byReview.set(category.avaliacao_id, []);
    byReview.get(category.avaliacao_id).push({ id: category.id, nome: category.nome });
  });
  const metrics = calculateAgreement(rows);
  const items = rows.filter((row) => row.a1 && row.a2 && row.a1 !== row.a2).map((row) => ({
    ...row,
    categorias1: byReview.get(row.av1_id) || [],
    categorias2: byReview.get(row.av2_id) || [],
    categorias_finais: JSON.parse(row.categorias_finais || '[]')
  }));
  res.json({ lote, avaliadores: evaluators, metricas: metrics, divergencias: items, pendentesReconciliacao: items.filter((item) => !item.decisao_final).length });
});
