export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function positiveInteger(value, field = 'id') {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, `${field} inválido.`);
  return number;
}

export function nonEmptyText(value, field, max = 500) {
  const text = String(value ?? '').trim();
  if (!text) throw new HttpError(400, `${field} é obrigatório.`);
  if (text.length > max) throw new HttpError(400, `${field} excede ${max} caracteres.`);
  return text;
}
