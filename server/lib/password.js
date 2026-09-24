import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function validatePassword(password) {
  if (password.length < 10 || password.length > 128) return 'A senha deve ter entre 10 e 128 caracteres.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return 'Use ao menos uma letra maiúscula e uma minúscula.';
  if (!/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) return 'Use ao menos um número e um caractere especial.';
  return null;
}

export function createPasswordHash(password, salt = randomBytes(16).toString('hex')) {
  return { hash: scryptSync(password, salt, 64).toString('hex'), salt };
}

export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  const body = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  return `${body.slice(0, 4)}@${body.slice(4, 8)}#${body.slice(8)}7aA`;
}

export function verifyPassword(password, salt, storedHash) {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(storedHash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
