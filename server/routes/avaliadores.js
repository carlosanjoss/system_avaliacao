import { Router } from 'express';
import { db } from '../db/db.js';
import { HttpError, nonEmptyText, positiveInteger } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { createPasswordHash, generateTemporaryPassword } from '../lib/password.js';

export const avaliadoresRouter = Router();
avaliadoresRouter.use(requireAdmin);

avaliadoresRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.nome, a.email, a.username, a.ativo, a.criado_em,
      CASE WHEN a.senha_hash IS NOT NULL THEN 1 ELSE 0 END AS tem_senha,
      a.senha_temporaria,
      COUNT(DISTINCT la.lote_id) AS lotes_atribuidos,
      COUNT(DISTINCT av.id) AS avaliacoes_realizadas
    FROM avaliadores a
    LEFT JOIN lote_avaliadores la ON la.avaliador_id = a.id
    LEFT JOIN avaliacoes av ON av.avaliador_id = a.id
    WHERE a.papel = 'avaliador'
    GROUP BY a.id
    ORDER BY a.nome COLLATE NOCASE
  `).all();
  res.json(rows);
});

avaliadoresRouter.post('/', (req, res) => {
  const nome = nonEmptyText(req.body.nome, 'Nome', 120);
  const email = nonEmptyText(req.body.email, 'E-mail', 180).toLowerCase();
  const username = nonEmptyText(req.body.username, 'Usuário', 64).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'E-mail inválido.');
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new HttpError(400, 'O usuário deve ter de 3 a 64 caracteres e usar apenas letras minúsculas, números, ponto, hífen ou sublinhado.');
  const temporaryPassword = generateTemporaryPassword();
  const credentials = createPasswordHash(temporaryPassword);
  try {
    const result = db.prepare("INSERT INTO avaliadores (nome, email, username, senha_hash, senha_salt, senha_temporaria, papel) VALUES (?, ?, ?, ?, ?, 1, 'avaliador')").run(nome, email, username, credentials.hash, credentials.salt);
    const created = db.prepare('SELECT id, nome, email, username, ativo, criado_em, senha_temporaria FROM avaliadores WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ...created, senhaTemporaria: temporaryPassword });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Já existe um avaliador com esse e-mail ou usuário.');
    throw error;
  }
});

avaliadoresRouter.put('/:id', (req, res) => {
  const id = positiveInteger(req.params.id);
  const nome = nonEmptyText(req.body.nome, 'Nome', 120);
  const email = nonEmptyText(req.body.email, 'E-mail', 180).toLowerCase();
  const username = nonEmptyText(req.body.username, 'Usuário', 64).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'E-mail inválido.');
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new HttpError(400, 'Usuário inválido.');
  try {
    const result = db.prepare('UPDATE avaliadores SET nome = ?, email = ?, username = ? WHERE id = ? AND papel = ?').run(nome, email, username, id, 'avaliador');
    if (!result.changes) throw new HttpError(404, 'Avaliador não encontrado.');
    res.json(db.prepare('SELECT * FROM avaliadores WHERE id = ?').get(id));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Já existe um avaliador com esse e-mail ou usuário.');
    throw error;
  }
});

avaliadoresRouter.post('/:id/resetar-senha', (req, res) => {
  const id = positiveInteger(req.params.id);
  const evaluator = db.prepare("SELECT id, username FROM avaliadores WHERE id = ? AND papel = 'avaliador'").get(id);
  if (!evaluator) throw new HttpError(404, 'Avaliador não encontrado.');
  const temporaryPassword = generateTemporaryPassword();
  const credentials = createPasswordHash(temporaryPassword);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE avaliadores SET senha_hash = ?, senha_salt = ?, senha_temporaria = 1 WHERE id = ?').run(credentials.hash, credentials.salt, id);
    db.prepare('DELETE FROM sessoes WHERE avaliador_id = ?').run(id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.json({ username: evaluator.username, senhaTemporaria: temporaryPassword });
});

avaliadoresRouter.delete('/:id', (req, res) => {
  const id = positiveInteger(req.params.id);
  const usage = db.prepare('SELECT COUNT(*) AS total FROM avaliacoes WHERE avaliador_id = ?').get(id).total;
  if (usage) throw new HttpError(409, 'Este avaliador possui avaliações e não pode ser removido. Edite o cadastro ou remova os lotes relacionados.');
  const assignments = db.prepare('SELECT COUNT(*) AS total FROM lote_avaliadores WHERE avaliador_id = ?').get(id).total;
  if (assignments) throw new HttpError(409, 'Este avaliador está atribuído a um lote. Altere a atribuição antes de removê-lo.');
  const result = db.prepare("DELETE FROM avaliadores WHERE id = ? AND papel = 'avaliador'").run(id);
  if (!result.changes) throw new HttpError(404, 'Avaliador não encontrado.');
  res.status(204).end();
});
