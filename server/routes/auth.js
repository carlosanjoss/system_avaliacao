import { Router } from 'express';
import { db } from '../db/db.js';
import { authenticate, clearSessionHeader, createSession, hashToken, readCookies, sessionCookie, sessionHeader } from '../lib/auth.js';
import { HttpError, nonEmptyText } from '../lib/http.js';
import { createPasswordHash, validatePassword, verifyPassword } from '../lib/password.js';

export const authRouter = Router();

function publicUser(user) {
  return { id: user.id, nome: user.nome, email: user.email, username: user.username, papel: user.papel, senhaTemporaria: Boolean(user.senha_temporaria ?? user.senhaTemporaria) };
}

authRouter.post('/login', (request, response) => {
  const username = nonEmptyText(request.body.username, 'Usuário', 64).toLowerCase();
  const password = String(request.body.password || '');
  const recentFailures = db.prepare("SELECT COUNT(*) AS total FROM tentativas_login WHERE username = ? AND sucesso = 0 AND tentado_em > datetime('now', '-15 minutes')").get(username).total;
  if (recentFailures >= 10) throw new HttpError(429, 'Muitas tentativas incorretas. Aguarde 15 minutos.');
  const user = db.prepare('SELECT * FROM avaliadores WHERE username = ? COLLATE NOCASE').get(username);
  const valid = Boolean(user?.ativo && user.senha_hash && user.senha_salt && verifyPassword(password, user.senha_salt, user.senha_hash));
  db.prepare('INSERT INTO tentativas_login (username, sucesso) VALUES (?, ?)').run(username, valid ? 1 : 0);
  if (!valid) throw new HttpError(401, 'Usuário ou senha incorretos.');
  const session = createSession(user.id);
  response.setHeader('Set-Cookie', sessionHeader(session.token, session.days, request));
  response.json({ user: publicUser(user) });
});

authRouter.post('/alterar-senha', (request, response) => {
  const user = authenticate(request);
  if (!user) throw new HttpError(401, 'Sessão não autenticada.');
  const newPassword = String(request.body.novaSenha || '');
  const passwordError = validatePassword(newPassword);
  if (passwordError) throw new HttpError(400, passwordError);
  const current = db.prepare('SELECT senha_hash, senha_salt FROM avaliadores WHERE id = ?').get(user.id);
  if (current?.senha_hash && verifyPassword(newPassword, current.senha_salt, current.senha_hash)) throw new HttpError(400, 'A nova senha deve ser diferente da senha temporária.');
  const credentials = createPasswordHash(newPassword);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE avaliadores SET senha_hash = ?, senha_salt = ?, senha_temporaria = 0 WHERE id = ?').run(credentials.hash, credentials.salt, user.id);
    db.prepare('DELETE FROM sessoes WHERE avaliador_id = ? AND id <> ?').run(user.id, user.sessaoId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  response.json({ user: publicUser({ ...user, senhaTemporaria: false }) });
});

authRouter.get('/me', (request, response) => {
  const user = authenticate(request);
  if (!user) throw new HttpError(401, 'Sessão não autenticada.');
  response.json({ user: publicUser(user) });
});

authRouter.post('/logout', (request, response) => {
  const token = readCookies(request)[sessionCookie];
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(token));
  response.setHeader('Set-Cookie', clearSessionHeader(request));
  response.status(204).end();
});
