import { Router } from 'express';
import { db, transaction } from '../db/db.js';
import { HttpError, positiveInteger } from '../lib/http.js';
import { refreshStatus } from './lotes.js';
import { requireEvaluator } from '../lib/auth.js';

export const avaliacoesRouter = Router();

avaliacoesRouter.get('/categorias', (req, res) => {
  res.json(db.prepare('SELECT id, nome, ordem FROM categorias_odio ORDER BY ordem').all());
});

avaliacoesRouter.post('/', requireEvaluator, (req, res) => {
  const itemId = positiveInteger(req.body.itemId, 'itemId');
  const avaliadorId = req.user.id;
  const classificacao = req.body.classificacao;
  const categorias = [...new Set((req.body.categorias || []).map(Number))];
  if (!['hate', 'nao_hate'].includes(classificacao)) throw new HttpError(400, 'Classificação inválida.');
  if (classificacao === 'hate' && !categorias.length) throw new HttpError(400, 'Selecione ao menos uma categoria para Hate.');
  if (classificacao === 'nao_hate' && categorias.length) throw new HttpError(400, 'Não Hate não deve possuir categorias de ódio.');

  const item = db.prepare('SELECT lote_id FROM lote_itens WHERE id = ?').get(itemId);
  if (!item) throw new HttpError(404, 'Item não encontrado.');
  if (!db.prepare('SELECT 1 FROM lote_avaliadores WHERE lote_id = ? AND avaliador_id = ?').get(item.lote_id, avaliadorId)) {
    throw new HttpError(403, 'Este item não está atribuído ao avaliador selecionado.');
  }
  if (categorias.length) {
    const found = db.prepare(`SELECT COUNT(*) AS total FROM categorias_odio WHERE id IN (${categorias.map(() => '?').join(',')})`).get(...categorias).total;
    if (found !== categorias.length) throw new HttpError(400, 'Categoria inválida.');
  }

  const avaliacaoId = transaction(() => {
    db.prepare(`
      INSERT INTO avaliacoes (item_id, avaliador_id, classificacao)
      VALUES (?, ?, ?)
      ON CONFLICT(item_id, avaliador_id) DO UPDATE SET classificacao = excluded.classificacao, atualizado_em = CURRENT_TIMESTAMP
    `).run(itemId, avaliadorId, classificacao);
    const avaliacao = db.prepare('SELECT id FROM avaliacoes WHERE item_id = ? AND avaliador_id = ?').get(itemId, avaliadorId);
    db.prepare('DELETE FROM avaliacao_categorias WHERE avaliacao_id = ?').run(avaliacao.id);
    const insert = db.prepare('INSERT INTO avaliacao_categorias (avaliacao_id, categoria_id) VALUES (?, ?)');
    categorias.forEach((categoriaId) => insert.run(avaliacao.id, categoriaId));
    return avaliacao.id;
  });
  refreshStatus(item.lote_id);
  res.json({ id: avaliacaoId, itemId, avaliadorId, classificacao, categorias });
});
