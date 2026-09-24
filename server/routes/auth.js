import { Router } from 'express';
import { db } from '../db/db.js';
import { authenticate, clearSessionHeader, createSession, hashToken, readCookies, sessionCookie, sessionHeader } from '../lib/auth.js';
import { HttpError, nonEmptyText } from '../lib/http.js';
import { verifyPassword } from '../lib/password.js';

export const authRouter = Router();

function publicUser(user) {
  return { id: user.id, nome: user.nome, email: user.email, username: user.username, papel: user.papel };
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

authRouter.get('/me', (request, response) => {
  const user = authenticate(request);
  if (!user) throw new HttpError(401, 'Sessão não autenticada.');
  response.json({ user });
});

authRouter.post('/logout', (request, response) => {
  const token = readCookies(request)[sessionCookie];
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(token));
  response.setHeader('Set-Cookie', clearSessionHeader(request));
  response.status(204).end();
});
