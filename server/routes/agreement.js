import { Router } from 'express';
import { db } from '../db/db.js';
import { calculateAgreement, calculateMulticlassAgreement } from '../lib/agreement.js';
import { HttpError, positiveInteger } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { getModel, sameResponses } from '../lib/models.js';

export const agreementRouter = Router();

agreementRouter.get('/:id/concordancia', requireAdmin, (req, res) => {
  const loteId = positiveInteger(req.params.id);
  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
  if (!lote) throw new HttpError(404, 'Lote não encontrado.');
  if (lote.tipo_avaliacao !== 'dupla') throw new HttpError(400, 'Concordância está disponível apenas para lotes em dupla.');
  const model = getModel(lote.modelo_avaliacao_id);
  const evaluators = db.prepare(`
    SELECT a.id, a.nome, la.ordem FROM lote_avaliadores la
    JOIN avaliadores a ON a.id = la.avaliador_id WHERE la.lote_id = ? ORDER BY la.ordem
  `).all(loteId);
  if (model.sistema !== 'hate_v1') {
    const itemRows = db.prepare('SELECT id AS item_id, linha_index, conteudo FROM lote_itens WHERE lote_id = ? ORDER BY linha_index').all(loteId);
    const firstMetricField = model.campos.find((field) => ['unica', 'booleano'].includes(field.tipo));
    const divergencias = [];
    const metricRows = [];
    itemRows.forEach((item) => {
      const reviews = evaluators.map((evaluator) => {
        const review = db.prepare('SELECT id FROM avaliacoes WHERE item_id = ? AND avaliador_id = ?').get(item.item_id, evaluator.id);
        if (!review) return null;
        return { id: review.id, respostas: Object.fromEntries(db.prepare('SELECT c.chave, ar.valor_json FROM avaliacao_respostas ar JOIN campos_modelo c ON c.id = ar.campo_id WHERE ar.avaliacao_id = ?').all(review.id).map((row) => [row.chave, JSON.parse(row.valor_json)])) };
      });
      if (reviews[0] && reviews[1]) {
        if (firstMetricField) metricRows.push({ a1: reviews[0].respostas[firstMetricField.chave], a2: reviews[1].respostas[firstMetricField.chave] });
        if (!sameResponses(reviews[0].respostas, reviews[1].respostas)) {
          const reconciliation = db.prepare('SELECT respostas_json FROM reconciliacoes_personalizadas WHERE item_id = ?').get(item.item_id);
          divergencias.push({ ...item, respostas1: reviews[0].respostas, respostas2: reviews[1].respostas, respostas_finais: reconciliation ? JSON.parse(reconciliation.respostas_json) : null, reconciliado: Boolean(reconciliation) });
        }
      }
    });
    const metrics = firstMetricField ? calculateMulticlassAgreement(metricRows) : {
      totalPareados: itemRows.filter((item) => evaluators.every((evaluator) => db.prepare('SELECT 1 FROM avaliacoes WHERE item_id = ? AND avaliador_id = ?').get(item.item_id, evaluator.id))).length,
      concordantes: itemRows.length - divergencias.length,
      percentual: itemRows.length ? (itemRows.length - divergencias.length) / itemRows.length : null,
      kappa: null
    };
    return res.json({ lote, modelo: model, avaliadores: evaluators, metricas: metrics, divergencias, pendentesReconciliacao: divergencias.filter((item) => !item.reconciliado).length });
  }
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
  const items = rows.filter((row) => {
    if (!row.a1 || !row.a2) return false;
    const firstCategories = (byReview.get(row.av1_id) || []).map((category) => category.id).sort((a, b) => a - b);
    const secondCategories = (byReview.get(row.av2_id) || []).map((category) => category.id).sort((a, b) => a - b);
    return row.a1 !== row.a2 || JSON.stringify(firstCategories) !== JSON.stringify(secondCategories);
  }).map((row) => {
    const categorias1 = byReview.get(row.av1_id) || [];
    const categorias2 = byReview.get(row.av2_id) || [];
    return {
      ...row,
      categorias1,
      categorias2,
      conflito_classificacao: row.a1 !== row.a2,
      conflito_categorias: JSON.stringify(categorias1.map((category) => category.id).sort((a, b) => a - b)) !== JSON.stringify(categorias2.map((category) => category.id).sort((a, b) => a - b)),
      categorias_finais: JSON.parse(row.categorias_finais || '[]')
    };
  });
  res.json({ lote, modelo: model, avaliadores: evaluators, metricas: metrics, divergencias: items, pendentesReconciliacao: items.filter((item) => !item.decisao_final).length });
});
