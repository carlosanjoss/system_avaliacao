import { Router } from 'express';
import { db, transaction } from '../db/db.js';
import { HttpError, positiveInteger } from '../lib/http.js';
import { getModel, normalizeModelPayload, slug } from '../lib/models.js';
import { requireAdmin } from '../lib/auth.js';

export const modelosRouter = Router();

function insertDefinition(definition, metadata) {
  const result = db.prepare(`INSERT INTO modelos_avaliacao (chave_base, nome, descricao, versao, ativo, sistema) VALUES (?, ?, ?, ?, 1, NULL)`).run(metadata.base, definition.nome, definition.descricao, metadata.version);
  const modelId = Number(result.lastInsertRowid);
  const fieldIds = new Map();
  const insertField = db.prepare(`INSERT INTO campos_modelo (modelo_id, chave, rotulo, tipo, nome_coluna, obrigatorio, ordem, condicao_campo_id, condicao_operador, condicao_valores) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertOption = db.prepare(`INSERT INTO opcoes_campo (campo_id, valor, rotulo, cor, ordem, encerra_fluxo) VALUES (?, ?, ?, ?, ?, ?)`);
  definition.campos.forEach((field) => {
    const parentId = field.condicao ? fieldIds.get(field.condicao.campoChave) : null;
    const inserted = insertField.run(modelId, field.chave, field.rotulo, field.tipo, field.nomeColuna, field.obrigatorio ? 1 : 0, field.ordem, parentId || null, field.condicao?.operador || null, JSON.stringify(field.condicao?.valores || []));
    const fieldId = Number(inserted.lastInsertRowid);
    fieldIds.set(field.chave, fieldId);
    field.opcoes.forEach((option, index) => insertOption.run(fieldId, option.valor, option.rotulo, option.cor || 'teal', index + 1, option.encerraFluxo ? 1 : 0));
  });
  return modelId;
}

modelosRouter.get('/', (req, res) => {
  const rows = db.prepare(`SELECT id FROM modelos_avaliacao ${req.user.papel === 'admin' ? '' : 'WHERE ativo = 1'} ORDER BY ativo DESC, nome, versao DESC`).all();
  res.json(rows.map((row) => getModel(row.id)));
});

modelosRouter.get('/:id', (req, res) => res.json(getModel(positiveInteger(req.params.id))));

modelosRouter.post('/', requireAdmin, (req, res) => {
  const definition = normalizeModelPayload(req.body);
  const base = slug(definition.nome, 'modelo');
  const existing = db.prepare('SELECT 1 FROM modelos_avaliacao WHERE chave_base = ? LIMIT 1').get(base);
  if (existing) throw new HttpError(409, 'Já existe um modelo com esse nome. Edite ou duplique o modelo existente.');
  const id = transaction(() => insertDefinition(definition, { base, version: 1 }));
  res.status(201).json(getModel(id));
});

modelosRouter.put('/:id', requireAdmin, (req, res) => {
  const id = positiveInteger(req.params.id);
  const current = getModel(id);
  if (current.sistema) throw new HttpError(409, 'O modelo padrão do sistema não pode ser alterado. Duplique-o para personalizar.');
  const definition = normalizeModelPayload(req.body);
  const nextId = transaction(() => {
    if (!current.usado) {
      db.prepare('UPDATE modelos_avaliacao SET nome = ?, descricao = ? WHERE id = ?').run(definition.nome, definition.descricao, id);
      db.prepare('DELETE FROM opcoes_campo WHERE campo_id IN (SELECT id FROM campos_modelo WHERE modelo_id = ?)').run(id);
      db.prepare('SELECT id FROM campos_modelo WHERE modelo_id = ? ORDER BY ordem DESC').all(id).forEach((field) => db.prepare('DELETE FROM campos_modelo WHERE id = ?').run(field.id));
      const fieldIds = new Map();
      const insertField = db.prepare(`INSERT INTO campos_modelo (modelo_id, chave, rotulo, tipo, nome_coluna, obrigatorio, ordem, condicao_campo_id, condicao_operador, condicao_valores) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertOption = db.prepare(`INSERT INTO opcoes_campo (campo_id, valor, rotulo, cor, ordem, encerra_fluxo) VALUES (?, ?, ?, ?, ?, ?)`);
      definition.campos.forEach((field) => {
        const inserted = insertField.run(id, field.chave, field.rotulo, field.tipo, field.nomeColuna, field.obrigatorio ? 1 : 0, field.ordem, field.condicao ? fieldIds.get(field.condicao.campoChave) : null, field.condicao?.operador || null, JSON.stringify(field.condicao?.valores || []));
        const fieldId = Number(inserted.lastInsertRowid);
        fieldIds.set(field.chave, fieldId);
        field.opcoes.forEach((option, index) => insertOption.run(fieldId, option.valor, option.rotulo, option.cor || 'teal', index + 1, option.encerraFluxo ? 1 : 0));
      });
      return id;
    }
    db.prepare('UPDATE modelos_avaliacao SET ativo = 0 WHERE chave_base = ?').run(current.chaveBase);
    const version = db.prepare('SELECT MAX(versao) AS value FROM modelos_avaliacao WHERE chave_base = ?').get(current.chaveBase).value + 1;
    return insertDefinition(definition, { base: current.chaveBase, version });
  });
  res.json(getModel(nextId));
});

modelosRouter.post('/:id/duplicar', requireAdmin, (req, res) => {
  const source = getModel(positiveInteger(req.params.id));
  const definition = normalizeModelPayload({ nome: req.body.nome || `${source.nome} (cópia)`, descricao: source.descricao, campos: source.campos });
  let base = slug(definition.nome, 'modelo');
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM modelos_avaliacao WHERE chave_base = ?').get(base)) base = `${slug(definition.nome)}_${suffix++}`;
  const id = transaction(() => insertDefinition(definition, { base, version: 1 }));
  res.status(201).json(getModel(id));
});

modelosRouter.delete('/:id', requireAdmin, (req, res) => {
  const id = positiveInteger(req.params.id);
  const model = getModel(id);
  if (model.sistema) throw new HttpError(409, 'O modelo padrão do sistema não pode ser arquivado.');
  db.prepare('UPDATE modelos_avaliacao SET ativo = 0 WHERE id = ?').run(id);
  res.status(204).end();
});
