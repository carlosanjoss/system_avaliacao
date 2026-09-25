import { db } from '../db/db.js';
import { HttpError } from './http.js';

export const FIELD_TYPES = new Set(['unica', 'multipla', 'booleano', 'texto']);
export const CONDITION_OPERATORS = new Set(['igual', 'diferente', 'contem', 'qualquer', 'respondido', 'nao_respondido']);

export function slug(value, fallback = 'campo') {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 64);
  return normalized || fallback;
}

export function getModel(modelId) {
  const model = db.prepare(`
    SELECT m.*, EXISTS (SELECT 1 FROM lotes l WHERE l.modelo_avaliacao_id = m.id) AS usado
    FROM modelos_avaliacao m WHERE m.id = ?
  `).get(modelId);
  if (!model) throw new HttpError(404, 'Modelo de avaliação não encontrado.');
  const fields = db.prepare(`
    SELECT c.*, parent.chave AS condicao_campo_chave
    FROM campos_modelo c LEFT JOIN campos_modelo parent ON parent.id = c.condicao_campo_id
    WHERE c.modelo_id = ? ORDER BY c.ordem
  `).all(modelId);
  const options = db.prepare(`
    SELECT o.* FROM opcoes_campo o JOIN campos_modelo c ON c.id = o.campo_id
    WHERE c.modelo_id = ? ORDER BY c.ordem, o.ordem
  `).all(modelId);
  const byField = new Map();
  options.forEach((option) => {
    if (!byField.has(option.campo_id)) byField.set(option.campo_id, []);
    byField.get(option.campo_id).push({ id: option.id, valor: option.valor, rotulo: option.rotulo, cor: option.cor, ordem: option.ordem, encerraFluxo: Boolean(option.encerra_fluxo) });
  });
  return {
    id: model.id,
    chaveBase: model.chave_base,
    nome: model.nome,
    descricao: model.descricao,
    versao: model.versao,
    ativo: Boolean(model.ativo),
    sistema: model.sistema,
    usado: Boolean(model.usado),
    criadoEm: model.criado_em,
    campos: fields.map((field) => ({
      id: field.id,
      chave: field.chave,
      rotulo: field.rotulo,
      tipo: field.tipo,
      nomeColuna: field.nome_coluna,
      obrigatorio: Boolean(field.obrigatorio),
      ordem: field.ordem,
      condicao: field.condicao_campo_id ? { campoId: field.condicao_campo_id, campoChave: field.condicao_campo_chave, operador: field.condicao_operador, valores: JSON.parse(field.condicao_valores || '[]') } : null,
      opcoes: byField.get(field.id) || []
    }))
  };
}

export function normalizeModelPayload(body) {
  const nome = String(body.nome || '').trim();
  const descricao = String(body.descricao || '').trim();
  if (nome.length < 2 || nome.length > 120) throw new HttpError(400, 'Informe um nome de modelo entre 2 e 120 caracteres.');
  if (!Array.isArray(body.campos) || !body.campos.length || body.campos.length > 30) throw new HttpError(400, 'O modelo deve possuir entre 1 e 30 campos.');
  const keys = new Set();
  const columns = new Set();
  const fields = body.campos.map((raw, index) => {
    const rotulo = String(raw.rotulo || '').trim();
    const tipo = String(raw.tipo || 'unica');
    const chave = slug(raw.chave || raw.nomeColuna || rotulo, `campo_${index + 1}`);
    const nomeColuna = slug(raw.nomeColuna || chave, chave);
    if (!rotulo || rotulo.length > 240) throw new HttpError(400, `Informe o texto do campo ${index + 1}.`);
    if (!FIELD_TYPES.has(tipo)) throw new HttpError(400, `Tipo inválido no campo “${rotulo}”.`);
    if (keys.has(chave) || columns.has(nomeColuna)) throw new HttpError(400, 'As chaves e os nomes de coluna precisam ser únicos no modelo.');
    keys.add(chave);
    columns.add(nomeColuna);
    let options = [];
    if (tipo === 'booleano') options = [{ valor: 'sim', rotulo: 'Sim' }, { valor: 'nao', rotulo: 'Não' }];
    else if (tipo === 'unica' || tipo === 'multipla') {
      if (!Array.isArray(raw.opcoes) || raw.opcoes.length < 2 || raw.opcoes.length > 50) throw new HttpError(400, `O campo “${rotulo}” precisa ter entre 2 e 50 opções.`);
      const optionValues = new Set();
      options = raw.opcoes.map((option, optionIndex) => {
        const optionLabel = String(option.rotulo || option.label || option || '').trim();
        const valor = slug(option.valor || optionLabel, `opcao_${optionIndex + 1}`);
        if (!optionLabel || optionValues.has(valor)) throw new HttpError(400, `Existem opções vazias ou repetidas em “${rotulo}”.`);
        optionValues.add(valor);
        return { valor, rotulo: optionLabel.slice(0, 120), cor: String(option.cor || 'teal').slice(0, 20), encerraFluxo: Boolean(option.encerraFluxo) };
      });
    }
    const condition = raw.condicao?.campoChave ? {
      campoChave: slug(raw.condicao.campoChave),
      operador: String(raw.condicao.operador || 'igual'),
      valores: Array.isArray(raw.condicao.valores) ? raw.condicao.valores.map(String) : []
    } : null;
    if (condition) {
      if (!CONDITION_OPERATORS.has(condition.operador)) throw new HttpError(400, `Operador condicional inválido em “${rotulo}”.`);
      const parentIndex = body.campos.findIndex((candidate) => slug(candidate.chave || candidate.nomeColuna || candidate.rotulo) === condition.campoChave);
      if (parentIndex < 0 || parentIndex >= index) throw new HttpError(400, `“${rotulo}” só pode depender de um campo anterior. Isso evita ciclos no fluxo.`);
    }
    return { chave, rotulo, tipo, nomeColuna, obrigatorio: raw.obrigatorio !== false, ordem: index + 1, opcoes: options, condicao: condition };
  });
  fields.forEach((field) => {
    if (!field.condicao || ['respondido', 'nao_respondido'].includes(field.condicao.operador)) return;
    const parent = fields.find((candidate) => candidate.chave === field.condicao.campoChave);
    field.condicao.valores = field.condicao.valores.map((raw) => {
      const text = String(raw).trim();
      const option = parent?.opcoes.find((candidate) => candidate.valor === text || candidate.rotulo.toLocaleLowerCase('pt-BR') === text.toLocaleLowerCase('pt-BR'));
      return option?.valor || slug(text);
    });
    if (!field.condicao.valores.length) throw new HttpError(400, `Informe o valor da condição de “${field.rotulo}”.`);
  });
  return { nome, descricao: descricao.slice(0, 500), campos: fields };
}

export function isFieldVisible(field, responses, model) {
  if (!field.condicao) return true;
  const value = responses[field.condicao.campoChave];
  const expected = field.condicao.valores || [];
  if (field.condicao.operador === 'respondido') return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
  if (field.condicao.operador === 'nao_respondido') return value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
  if (field.condicao.operador === 'igual') return expected.some((item) => String(item) === String(value));
  if (field.condicao.operador === 'diferente') return !expected.some((item) => String(item) === String(value));
  const values = Array.isArray(value) ? value.map(String) : [String(value ?? '')];
  if (field.condicao.operador === 'contem') return expected.every((item) => values.includes(String(item)));
  if (field.condicao.operador === 'qualquer') return expected.some((item) => values.includes(String(item)));
  return true;
}

export function validateResponses(model, rawResponses) {
  const responses = rawResponses && typeof rawResponses === 'object' && !Array.isArray(rawResponses) ? { ...rawResponses } : {};
  const normalized = {};
  for (const field of model.campos) {
    if (!isFieldVisible(field, normalized, model)) continue;
    const value = responses[field.chave];
    const empty = value === undefined || value === null || String(value).trim() === '' || (Array.isArray(value) && !value.length);
    if (empty) {
      if (field.obrigatorio) throw new HttpError(400, `Responda o campo “${field.rotulo}”.`);
      continue;
    }
    if (field.tipo === 'texto') {
      normalized[field.chave] = String(value).trim().slice(0, 2000);
    } else if (field.tipo === 'multipla') {
      if (!Array.isArray(value)) throw new HttpError(400, `A resposta de “${field.rotulo}” deve permitir múltiplas opções.`);
      const allowed = new Set(field.opcoes.map((option) => option.valor));
      const selected = [...new Set(value.map(String))];
      if (selected.some((item) => !allowed.has(item))) throw new HttpError(400, `Resposta inválida em “${field.rotulo}”.`);
      normalized[field.chave] = selected;
    } else {
      const selected = String(value);
      if (!field.opcoes.some((option) => option.valor === selected)) throw new HttpError(400, `Resposta inválida em “${field.rotulo}”.`);
      normalized[field.chave] = selected;
      if (field.opcoes.find((option) => option.valor === selected)?.encerraFluxo) break;
    }
  }
  return normalized;
}

export function formatResponse(field, value) {
  if (value === undefined || value === null) return '';
  if (field.tipo === 'texto') return String(value);
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => field.opcoes.find((option) => option.valor === item)?.rotulo || item).join(' | ');
}

export function sameResponses(first = {}, second = {}) {
  const normalize = (value) => Array.isArray(value) ? [...value].map(String).sort() : value ?? null;
  const keys = [...new Set([...Object.keys(first), ...Object.keys(second)])].sort();
  return keys.every((key) => JSON.stringify(normalize(first[key])) === JSON.stringify(normalize(second[key])));
}
