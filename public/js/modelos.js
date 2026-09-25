import { api } from './api.js';
import { clear, confirmAction, el, emptyState, modal, skeleton, toast } from './ui.js';

const types = [
  { value: 'unica', label: 'Seleção única' },
  { value: 'multipla', label: 'Seleção múltipla' },
  { value: 'booleano', label: 'Sim / Não' },
  { value: 'texto', label: 'Texto curto' }
];

function inputField(label, value = '') {
  const wrap = el('label');
  wrap.append(el('span', 'field-label', label));
  const input = el('input', 'form-field');
  input.value = value;
  wrap.append(input);
  return { wrap, input };
}

function selectInput(label, values, selected = '') {
  const wrap = el('label');
  wrap.append(el('span', 'field-label', label));
  const select = el('select', 'form-field');
  values.forEach((item) => {
    const option = el('option', '', item.label);
    option.value = item.value;
    option.selected = String(item.value) === String(selected);
    select.append(option);
  });
  wrap.append(select);
  return { wrap, select };
}

function blankField(index) {
  return { chave: `campo_${index + 1}`, rotulo: '', tipo: 'unica', nomeColuna: `campo_${index + 1}`, obrigatorio: true, opcoes: [{ rotulo: 'Opção 1' }, { rotulo: 'Opção 2' }], condicao: null };
}

function modelEditor(existing, reload) {
  const dialog = modal({ title: existing ? `Editar ${existing.nome}` : 'Novo modelo de avaliação', subtitle: existing?.usado ? 'Ao salvar, uma nova versão será criada para preservar os lotes existentes.' : 'Configure as perguntas na ordem em que serão exibidas.', wide: true });
  const form = el('form', 'space-y-6');
  const name = inputField('Nome do modelo', existing?.nome || '');
  name.input.required = true;
  const description = inputField('Descrição', existing?.descricao || '');
  const fieldsRoot = el('div', 'space-y-4');
  let fields = existing?.campos?.map((field) => ({ ...field, opcoes: field.opcoes.map((option) => ({ ...option })), condicao: field.condicao ? { ...field.condicao, valores: [...field.condicao.valores] } : null })) || [blankField(0)];

  function renderFields() {
    clear(fieldsRoot);
    fields.forEach((field, index) => {
      const card = el('section', 'rounded-2xl border border-slate-200 bg-slate-500/[.025] p-4 dark:border-white/[.08]');
      const header = el('div', 'mb-4 flex items-center justify-between gap-3');
      header.append(el('p', 'text-sm font-extrabold', `${index + 1}. ${field.rotulo || 'Nova pergunta'}`));
      const remove = el('button', 'button-danger !px-3 !py-2', 'Remover');
      remove.type = 'button';
      remove.disabled = fields.length === 1;
      remove.addEventListener('click', () => { fields.splice(index, 1); renderFields(); });
      header.append(remove);
      const grid = el('div', 'grid gap-3 md:grid-cols-2');
      const prompt = inputField('Pergunta / rótulo', field.rotulo);
      const column = inputField('Nome da coluna no CSV', field.nomeColuna);
      const type = selectInput('Tipo de resposta', types, field.tipo);
      const required = el('label', 'flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold dark:border-white/[.08]');
      const requiredInput = el('input', 'h-4 w-4 accent-teal-500');
      requiredInput.type = 'checkbox';
      requiredInput.checked = field.obrigatorio !== false;
      required.append(requiredInput, document.createTextNode('Resposta obrigatória'));
      const options = inputField('Opções separadas por vírgula', field.opcoes.map((option) => option.rotulo).join(', '));
      const terminal = selectInput('Opção que encerra o fluxo', [{ value: '', label: 'Nenhuma' }, ...field.opcoes.map((option) => ({ value: option.rotulo, label: option.rotulo }))], field.opcoes.find((option) => option.encerraFluxo)?.rotulo || '');
      const previous = fields.slice(0, index).map((candidate) => ({ value: candidate.chave, label: candidate.rotulo || candidate.chave }));
      const conditionField = selectInput('Mostrar somente quando', [{ value: '', label: 'Sempre visível' }, ...previous], field.condicao?.campoChave || '');
      const operator = selectInput('Operador da condição', [
        { value: 'igual', label: 'É igual a' }, { value: 'diferente', label: 'É diferente de' }, { value: 'contem', label: 'Contém todas' }, { value: 'qualquer', label: 'Contém qualquer' }, { value: 'respondido', label: 'Foi respondido' }, { value: 'nao_respondido', label: 'Não foi respondido' }
      ], field.condicao?.operador || 'igual');
      const conditionValues = inputField('Valor(es) da condição (rótulos ou códigos)', field.condicao?.valores?.join(', ') || '');
      const sync = () => {
        field.rotulo = prompt.input.value;
        field.nomeColuna = column.input.value;
        field.chave = column.input.value || `campo_${index + 1}`;
        field.tipo = type.select.value;
        field.obrigatorio = requiredInput.checked;
        const labels = options.input.value.split(',').map((value) => value.trim()).filter(Boolean);
        field.opcoes = ['unica', 'multipla'].includes(field.tipo) ? labels.map((rotulo) => ({ rotulo, encerraFluxo: terminal.select.value === rotulo })) : [];
        field.condicao = conditionField.select.value ? { campoChave: conditionField.select.value, operador: operator.select.value, valores: conditionValues.input.value.split(',').map((value) => value.trim()).filter(Boolean) } : null;
        options.wrap.classList.toggle('hidden', !['unica', 'multipla'].includes(field.tipo));
        terminal.wrap.classList.toggle('hidden', field.tipo !== 'unica');
        operator.wrap.classList.toggle('hidden', !conditionField.select.value);
        conditionValues.wrap.classList.toggle('hidden', !conditionField.select.value || ['respondido', 'nao_respondido'].includes(operator.select.value));
        header.firstChild.textContent = `${index + 1}. ${field.rotulo || 'Nova pergunta'}`;
      };
      options.input.addEventListener('change', () => {
        const labels = options.input.value.split(',').map((value) => value.trim()).filter(Boolean);
        const current = terminal.select.value;
        terminal.select.replaceChildren();
        [{ value: '', label: 'Nenhuma' }, ...labels.map((label) => ({ value: label, label }))].forEach((item) => {
          const option = el('option', '', item.label);
          option.value = item.value;
          option.selected = item.value === current;
          terminal.select.append(option);
        });
        sync();
      });
      [prompt.input, column.input, type.select, requiredInput, options.input, terminal.select, conditionField.select, operator.select, conditionValues.input].forEach((control) => control.addEventListener('input', sync));
      grid.append(prompt.wrap, column.wrap, type.wrap, required, options.wrap, terminal.wrap, conditionField.wrap, operator.wrap, conditionValues.wrap);
      card.append(header, grid);
      fieldsRoot.append(card);
      sync();
    });
  }
  renderFields();
  const add = el('button', 'button-secondary', '+ Adicionar pergunta');
  add.type = 'button';
  add.addEventListener('click', () => { fields.push(blankField(fields.length)); renderFields(); });
  const flow = el('div', 'rounded-2xl border border-teal-400/20 bg-teal-400/[.05] p-4');
  flow.append(el('p', 'text-xs font-extrabold text-teal-500', 'Como funciona o fluxo'), el('p', 'mt-2 text-xs leading-5 text-slate-500', 'Perguntas condicionais podem depender apenas de perguntas anteriores. Isso permite vários níveis sem criar ciclos. Campos ocultos são limpos automaticamente.'));
  const actions = el('div', 'flex justify-end gap-3');
  const cancel = el('button', 'button-secondary', 'Cancelar');
  cancel.type = 'button';
  cancel.addEventListener('click', dialog.destroy);
  const save = el('button', 'button-primary', existing?.usado ? 'Criar nova versão' : 'Salvar modelo');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(el('div', 'grid gap-4 md:grid-cols-2'), fieldsRoot);
  form.firstChild.append(name.wrap, description.wrap);
  form.append(add, flow, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const payload = { nome: name.input.value, descricao: description.input.value, campos };
      if (existing) await api.modelos.update(existing.id, payload); else await api.modelos.create(payload);
      dialog.destroy();
      toast(existing?.usado ? 'Nova versão publicada.' : 'Modelo salvo.');
      await reload();
    } catch (error) { toast(error.message, 'error'); save.disabled = false; }
  });
  dialog.body.append(form);
}

function flowPreview(model) {
  const root = el('div', 'mt-4 space-y-2');
  model.campos.forEach((field, index) => {
    const row = el('div', 'rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-white/[.07]');
    const condition = field.condicao ? `Se “${field.condicao.campoChave}” ${field.condicao.operador} ${field.condicao.valores.join(' / ') || ''} → ` : '';
    row.append(el('span', 'font-extrabold text-teal-500', `${index + 1}. `), document.createTextNode(`${condition}${field.rotulo}`), el('span', 'ml-2 font-mono text-slate-500', field.nomeColuna));
    root.append(row);
  });
  return root;
}

export async function renderModelos() {
  const root = document.querySelector('#view-modelos');
  clear(root).append(skeleton(4));
  try {
    const models = await api.modelos.list();
    const reload = () => renderModelos();
    const heading = el('div', 'mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between');
    const title = el('div');
    title.append(el('p', 'eyebrow', 'Construtor de fluxo'), el('h2', 'mt-2 text-2xl font-extrabold tracking-tight', 'Modelos de avaliação'), el('p', 'mt-2 max-w-2xl text-sm leading-6 text-slate-500', 'Defina perguntas, opções, colunas do CSV e ramificações do tipo “se isso, então aquilo”.'));
    const add = el('button', 'button-primary', '+ Novo modelo');
    add.addEventListener('click', () => modelEditor(null, reload));
    heading.append(title, add);
    const grid = el('div', 'grid gap-4 xl:grid-cols-2');
    models.forEach((model) => {
      const card = el('article', `panel p-5 ${model.ativo ? '' : 'opacity-60'}`);
      const top = el('div', 'flex items-start justify-between gap-3');
      const info = el('div');
      info.append(el('p', 'text-base font-extrabold', model.nome), el('p', 'mt-1 text-xs text-slate-500', `Versão ${model.versao} · ${model.campos.length} pergunta${model.campos.length === 1 ? '' : 's'}${model.sistema ? ' · padrão do sistema' : ''}`));
      top.append(info, el('span', `pill ${model.ativo ? 'bg-teal-400/10 text-teal-500' : 'bg-slate-500/10 text-slate-500'}`, model.ativo ? 'Ativo' : 'Arquivado'));
      card.append(top, el('p', 'mt-3 text-xs leading-5 text-slate-500', model.descricao || 'Sem descrição.'), flowPreview(model));
      const actions = el('div', 'mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-white/[.07]');
      if (!model.sistema && model.ativo) {
        const edit = el('button', 'button-secondary !px-3 !py-2', model.usado ? 'Nova versão' : 'Editar');
        edit.addEventListener('click', () => modelEditor(model, reload));
        actions.append(edit);
      }
      const duplicate = el('button', 'button-secondary !px-3 !py-2', 'Duplicar');
      duplicate.addEventListener('click', async () => { try { await api.modelos.duplicate(model.id, `${model.nome} (cópia)`); toast('Modelo duplicado.'); await reload(); } catch (error) { toast(error.message, 'error'); } });
      actions.append(duplicate);
      if (!model.sistema && model.ativo) {
        const archive = el('button', 'button-danger !px-3 !py-2', 'Arquivar');
        archive.addEventListener('click', async () => { if (!await confirmAction('Arquivar modelo?', 'Lotes existentes continuarão usando esta versão.', 'Arquivar')) return; await api.modelos.archive(model.id); toast('Modelo arquivado.'); await reload(); });
        actions.append(archive);
      }
      card.append(actions);
      grid.append(card);
    });
    clear(root).append(heading, models.length ? grid : emptyState('Nenhum modelo', 'Crie o primeiro modelo para começar.'));
  } catch (error) { clear(root).append(emptyState('Não foi possível carregar os modelos', error.message)); }
}
