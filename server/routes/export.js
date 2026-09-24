import { Router } from 'express';
import { db } from '../db/db.js';
import { calculateAgreement } from '../lib/agreement.js';
import { HttpError, positiveInteger } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';

export const exportRouter = Router();

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

exportRouter.get('/:id/export.csv', requireAdmin, (req, res) => {
  const loteId = positiveInteger(req.params.id);
  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
  if (!lote) throw new HttpError(404, 'Lote não encontrado.');
  const evaluators = db.prepare('SELECT avaliador_id, ordem FROM lote_avaliadores WHERE lote_id = ? ORDER BY ordem').all(loteId);
  const items = db.prepare('SELECT * FROM lote_itens WHERE lote_id = ? ORDER BY linha_index').all(loteId);
  const reviews = db.prepare(`
    SELECT av.id, av.item_id, av.avaliador_id, av.classificacao,
      COALESCE(GROUP_CONCAT(c.nome, ' | '), '') AS categorias
    FROM avaliacoes av LEFT JOIN avaliacao_categorias ac ON ac.avaliacao_id = av.id
    LEFT JOIN categorias_odio c ON c.id = ac.categoria_id
    JOIN lote_itens li ON li.id = av.item_id WHERE li.lote_id = ? GROUP BY av.id
  `).all(loteId);
  const reconciliations = new Map(db.prepare('SELECT * FROM reconciliacoes WHERE item_id IN (SELECT id FROM lote_itens WHERE lote_id = ?)').all(loteId).map((row) => [row.item_id, row]));
  const reviewMap = new Map(reviews.map((review) => [`${review.item_id}:${review.avaliador_id}`, review]));
  const pairs = items.map((item) => ({
    a1: reviewMap.get(`${item.id}:${evaluators[0]?.avaliador_id}`)?.classificacao,
    a2: reviewMap.get(`${item.id}:${evaluators[1]?.avaliador_id}`)?.classificacao
  }));
  const kappa = lote.tipo_avaliacao === 'dupla' ? calculateAgreement(pairs).kappa : null;
  const originals = items.map((item) => JSON.parse(item.dados_originais));
  const originalHeaders = [...new Set([...originals.flatMap((row) => Object.keys(row)), 'hate/no_hate', 'tipos_hate'])];
  const extras = ['avaliador_1_id', 'avaliador_1_classificacao', 'avaliador_1_categorias', 'avaliador_2_id', 'avaliador_2_classificacao', 'avaliador_2_categorias', 'concordancia', 'decisao_final', 'categorias_finais', 'kappa_lote'];
  const output = [[...originalHeaders, ...extras].map(csvCell).join(',')];
  items.forEach((item, index) => {
    const first = reviewMap.get(`${item.id}:${evaluators[0]?.avaliador_id}`);
    const second = reviewMap.get(`${item.id}:${evaluators[1]?.avaliador_id}`);
    const reconciliation = reconciliations.get(item.id);
    const agree = first && second ? (first.classificacao === second.classificacao ? 'sim' : 'nao') : '';
    const final = lote.tipo_avaliacao === 'individual' ? first?.classificacao || '' : reconciliation?.decisao_final || (agree === 'sim' ? first.classificacao : '');
    const finalCategories = lote.tipo_avaliacao === 'individual' ? first?.categorias || '' : reconciliation ? JSON.parse(reconciliation.categorias_finais).map((id) => db.prepare('SELECT nome FROM categorias_odio WHERE id = ?').get(id)?.nome).filter(Boolean).join(' | ') : (agree === 'sim' ? first?.categorias || '' : '');
    const values = [
      ...originalHeaders.map((header) => header === 'hate/no_hate' ? final : header === 'tipos_hate' ? finalCategories : originals[index][header] ?? ''),
      evaluators[0]?.avaliador_id || '', first?.classificacao || '', first?.categorias || '',
      evaluators[1]?.avaliador_id || '', second?.classificacao || '', second?.categorias || '',
      agree, final, finalCategories, kappa == null ? '' : kappa.toFixed(4)
    ];
    output.push(values.map(csvCell).join(','));
  });
  const safeName = lote.nome_arquivo.replace(/\.csv$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_consolidado.csv"`);
  res.send(`\uFEFF${output.join('\r\n')}`);
});
