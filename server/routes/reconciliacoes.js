import { Router } from 'express';
import { db } from '../db/db.js';
import { HttpError, positiveInteger } from '../lib/http.js';
import { refreshStatus } from './lotes.js';
import { requireAdmin } from '../lib/auth.js';

export const reconciliacoesRouter = Router();
reconciliacoesRouter.use(requireAdmin);

reconciliacoesRouter.post('/:itemId', (req, res) => {
  const itemId = positiveInteger(req.params.itemId, 'itemId');
  const decisao = req.body.decisaoFinal;
  const categorias = [...new Set((req.body.categoriasFinais || []).map(Number))];
  const decididoPor = req.user.id;
  if (!['hate', 'nao_hate'].includes(decisao)) throw new HttpError(400, 'Decisão final inválida.');
  if (decisao === 'hate' && !categorias.length) throw new HttpError(400, 'Selecione ao menos uma categoria final para Hate.');
  if (decisao === 'nao_hate' && categorias.length) throw new HttpError(400, 'Não Hate não deve possuir categorias finais.');
  const item = db.prepare('SELECT li.lote_id, l.tipo_avaliacao FROM lote_itens li JOIN lotes l ON l.id = li.lote_id WHERE li.id = ?').get(itemId);
  if (!item) throw new HttpError(404, 'Item não encontrado.');
  if (item.tipo_avaliacao !== 'dupla') throw new HttpError(400, 'Reconciliação só é permitida em lotes de avaliação dupla.');
  const reviews = db.prepare('SELECT classificacao FROM avaliacoes WHERE item_id = ?').all(itemId);
  if (reviews.length !== 2 || reviews[0].classificacao === reviews[1].classificacao) throw new HttpError(409, 'O item precisa ter duas classificações divergentes para ser reconciliado.');
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
