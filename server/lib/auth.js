import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/db.js';
import { HttpError } from './http.js';

export const sessionCookie = 'radar_avaliacao_session';

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function readCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
  }));
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const days = Math.max(1, Number(process.env.SESSION_DAYS) || 7);
  const expiration = new Date(Date.now() + days * 86400000);
  db.prepare('INSERT INTO sessoes (avaliador_id, token_hash, expira_em) VALUES (?, ?, ?)').run(userId, hashToken(token), expiration.toISOString());
  return { token, days };
}

export function sessionHeader(token, days, request) {
  const secure = request.secure || request.headers['x-forwarded-proto'] === 'https';
  return `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days * 86400}${secure ? '; Secure' : ''}`;
}

export function clearSessionHeader(request) {
  const secure = request.secure || request.headers['x-forwarded-proto'] === 'https';
  return `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function authenticate(request) {
  const token = readCookies(request)[sessionCookie];
  if (!token) return null;
  const user = db.prepare(`
    SELECT a.id, a.nome, a.email, a.username, a.papel, a.ativo, s.id AS sessao_id
    FROM sessoes s JOIN avaliadores a ON a.id = s.avaliador_id
    WHERE s.token_hash = ? AND s.expira_em > ? AND a.ativo = 1
  `).get(hashToken(token), new Date().toISOString());
  if (!user) return null;
  db.prepare('UPDATE sessoes SET ultimo_acesso_em = CURRENT_TIMESTAMP WHERE id = ?').run(user.sessao_id);
  return { id: user.id, nome: user.nome, email: user.email, username: user.username, papel: user.papel };
}

export function requireAuth(request, response, next) {
  const user = authenticate(request);
  if (!user) return response.status(401).json({ erro: 'Faça login para continuar.' });
  request.user = user;
  next();
}

export function requireAdmin(request, response, next) {
  if (request.user?.papel !== 'admin') return next(new HttpError(403, 'Acesso exclusivo do administrador.'));
  next();
}

export function requireEvaluator(request, response, next) {
  if (request.user?.papel !== 'avaliador') return next(new HttpError(403, 'Acesso exclusivo de avaliadores.'));
  next();
}
