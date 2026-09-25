import { Router } from 'express';
import { db } from '../db/db.js';
import { calculateAgreement, calculateMulticlassAgreement } from '../lib/agreement.js';
import { HttpError, positiveInteger } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { formatResponse, getModel, sameResponses } from '../lib/models.js';

export const exportRouter = Router();

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function readAnswers(reviewId) {
  if (!reviewId) return {};
  return Object.fromEntries(db.prepare('SELECT c.chave, ar.valor_json FROM avaliacao_respostas ar JOIN campos_modelo c ON c.id = ar.campo_id WHERE ar.avaliacao_id = ?').all(reviewId).map((row) => [row.chave, JSON.parse(row.valor_json)]));
}

function customCsv(lote, model, evaluators, items) {
  const reviews = db.prepare('SELECT av.id, av.item_id, av.avaliador_id FROM avaliacoes av JOIN lote_itens li ON li.id = av.item_id WHERE li.lote_id = ?').all(lote.id);
  const reviewMap = new Map(reviews.map((review) => [`${review.item_id}:${review.avaliador_id}`, { ...review, respostas: readAnswers(review.id) }]));
  const reconciliations = new Map(db.prepare('SELECT item_id, respostas_json FROM reconciliacoes_personalizadas WHERE item_id IN (SELECT id FROM lote_itens WHERE lote_id = ?)').all(lote.id).map((row) => [row.item_id, JSON.parse(row.respostas_json)]));
  const jointAssignments = new Map(lote.distribuicao_conjunta ? db.prepare('SELECT lia.item_id, lia.avaliador_id FROM lote_item_avaliadores lia JOIN lote_itens li ON li.id = lia.item_id WHERE li.lote_id = ?').all(lote.id).map((row) => [row.item_id, row.avaliador_id]) : []);
  const originals = items.map((item) => JSON.parse(item.dados_originais));
  const outputColumns = model.campos.map((field) => field.nomeColuna);
  const originalHeaders = [...new Set([...originals.flatMap((row) => Object.keys(row)), ...outputColumns])];
  const auditColumns = model.campos.flatMap((field) => [`avaliador_1_${field.nomeColuna}`, `avaliador_2_${field.nomeColuna}`]);
  const extras = ['avaliador_1_id', 'avaliador_2_id', ...auditColumns, 'concordancia', 'decisao_final_registrada', 'modelo_avaliacao', 'modelo_versao', 'kappa_lote'];
  const primary = model.campos.find((field) => ['unica', 'booleano'].includes(field.tipo));
  const pairs = [];
  const rows = [];
  items.forEach((item, index) => {
    const firstId = lote.distribuicao_conjunta ? jointAssignments.get(item.id) : evaluators[0]?.avaliador_id;
    const secondId = lote.distribuicao_conjunta ? null : evaluators[1]?.avaliador_id;
    const first = reviewMap.get(`${item.id}:${firstId}`);
    const second = secondId ? reviewMap.get(`${item.id}:${secondId}`) : null;
    if (primary && first && second) pairs.push({ a1: first.respostas[primary.chave], a2: second.respostas[primary.chave] });
    const agree = first && second ? sameResponses(first.respostas, second.respostas) : null;
    const reconciliation = reconciliations.get(item.id);
    const final = lote.tipo_avaliacao === 'individual' ? first?.respostas || {} : reconciliation || (agree ? first.respostas : {});
    const values = [
      ...originalHeaders.map((header) => {
        const field = model.campos.find((candidate) => candidate.nomeColuna === header);
        return field ? formatResponse(field, final[field.chave]) : originals[index][header] ?? '';
      }),
      firstId || '', secondId || '',
      ...model.campos.flatMap((field) => [formatResponse(field, first?.respostas[field.chave]), formatResponse(field, second?.respostas[field.chave])]),
      agree == null ? '' : agree ? 'sim' : 'nao', reconciliation ? 'sim' : 'nao', model.nome, model.versao, ''
    ];
    rows.push(values);
  });
  const kappa = primary && lote.tipo_avaliacao === 'dupla' ? calculateMulticlassAgreement(pairs).kappa : null;
  rows.forEach((row) => { row[row.length - 1] = kappa == null ? '' : kappa.toFixed(4); });
  return [[...originalHeaders, ...extras].map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n');
}

exportRouter.get('/:id/export.csv', requireAdmin, (req, res) => {
  const loteId = positiveInteger(req.params.id);
  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
  if (!lote) throw new HttpError(404, 'Lote não encontrado.');
  const evaluators = db.prepare('SELECT avaliador_id, ordem FROM lote_avaliadores WHERE lote_id = ? ORDER BY ordem').all(loteId);
  const items = db.prepare('SELECT * FROM lote_itens WHERE lote_id = ? ORDER BY linha_index').all(loteId);
  const model = getModel(lote.modelo_avaliacao_id);
  if (model.sistema !== 'hate_v1') {
    const safeName = lote.nome_arquivo.replace(/\.csv$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_consolidado.csv"`);
    return res.send(`\uFEFF${customCsv(lote, model, evaluators, items)}`);
  }
  const reviews = db.prepare(`
    SELECT av.id, av.item_id, av.avaliador_id, av.classificacao,
      COALESCE(GROUP_CONCAT(c.nome, ' | '), '') AS categorias
    FROM avaliacoes av LEFT JOIN avaliacao_categorias ac ON ac.avaliacao_id = av.id
    LEFT JOIN categorias_odio c ON c.id = ac.categoria_id
    JOIN lote_itens li ON li.id = av.item_id WHERE li.lote_id = ? GROUP BY av.id
  `).all(loteId);
  const reconciliations = new Map(db.prepare('SELECT * FROM reconciliacoes WHERE item_id IN (SELECT id FROM lote_itens WHERE lote_id = ?)').all(loteId).map((row) => [row.item_id, row]));
  const jointAssignments = new Map(lote.distribuicao_conjunta ? db.prepare(`
    SELECT lia.item_id, lia.avaliador_id FROM lote_item_avaliadores lia
    JOIN lote_itens li ON li.id = lia.item_id WHERE li.lote_id = ?
  `).all(loteId).map((row) => [row.item_id, row.avaliador_id]) : []);
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
    const firstEvaluatorId = lote.distribuicao_conjunta ? jointAssignments.get(item.id) : evaluators[0]?.avaliador_id;
    const secondEvaluatorId = lote.distribuicao_conjunta ? null : evaluators[1]?.avaliador_id;
    const first = reviewMap.get(`${item.id}:${firstEvaluatorId}`);
    const second = secondEvaluatorId ? reviewMap.get(`${item.id}:${secondEvaluatorId}`) : null;
    const reconciliation = reconciliations.get(item.id);
    const normalizeCategories = (value) => String(value || '').split(' | ').filter(Boolean).sort().join(' | ');
    const agree = first && second ? (first.classificacao === second.classificacao && normalizeCategories(first.categorias) === normalizeCategories(second.categorias) ? 'sim' : 'nao') : '';
    const final = lote.tipo_avaliacao === 'individual' ? first?.classificacao || '' : reconciliation?.decisao_final || (agree === 'sim' ? first.classificacao : '');
    const finalCategories = lote.tipo_avaliacao === 'individual' ? first?.categorias || '' : reconciliation ? JSON.parse(reconciliation.categorias_finais).map((id) => db.prepare('SELECT nome FROM categorias_odio WHERE id = ?').get(id)?.nome).filter(Boolean).join(' | ') : (agree === 'sim' ? first?.categorias || '' : '');
    const values = [
      ...originalHeaders.map((header) => header === 'hate/no_hate' ? final : header === 'tipos_hate' ? finalCategories : originals[index][header] ?? ''),
      firstEvaluatorId || '', first?.classificacao || '', first?.categorias || '',
      secondEvaluatorId || '', second?.classificacao || '', second?.categorias || '',
      agree, final, finalCategories, kappa == null ? '' : kappa.toFixed(4)
    ];
    output.push(values.map(csvCell).join(','));
  });
  const safeName = lote.nome_arquivo.replace(/\.csv$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_consolidado.csv"`);
  res.send(`\uFEFF${output.join('\r\n')}`);
});
