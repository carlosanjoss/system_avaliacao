import { api } from './api.js';
import { clear, confirmAction, el, emptyState, errorMessage, formatDate, modal, percent, skeleton, statusPill, toast } from './ui.js';

let cache = { avaliadores: [], lotes: [] };

function actionButton(label, handler, danger = false) {
  const button = el('button', danger ? 'button-danger !px-3 !py-2' : 'button-secondary !px-3 !py-2', label);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

function temporaryCredentialModal(evaluatorName, credentials) {
  const dialog = modal({ title: 'Credencial temporária', subtitle: `${evaluatorName} deverá criar uma senha pessoal no primeiro acesso.` });
  const warning = el('div', 'rounded-2xl border border-amber-400/25 bg-amber-400/[.07] p-4 text-xs leading-6 text-amber-600 dark:text-amber-300');
  warning.textContent = 'Copie e entregue esta credencial agora. A senha temporária não será exibida novamente.';
  const credentialBox = el('div', 'mt-4 space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-white/[.09]');
  credentialBox.append(
    el('p', 'text-xs text-slate-500', 'Usuário'),
    el('p', 'select-all font-mono text-sm font-extrabold', credentials.username),
    el('p', 'pt-2 text-xs text-slate-500', 'Senha temporária'),
    el('p', 'select-all break-all font-mono text-sm font-extrabold text-teal-500', credentials.senhaTemporaria)
  );
  const actions = el('div', 'mt-5 flex flex-wrap justify-end gap-3');
  const copy = el('button', 'button-secondary', 'Copiar credenciais');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`Usuário: ${credentials.username}\nSenha temporária: ${credentials.senhaTemporaria}`);
      toast('Credenciais copiadas.');
    } catch {
      toast('Não foi possível copiar. Selecione os dados exibidos.', 'error');
    }
  });
  const close = el('button', 'button-primary', 'Concluído');
  close.type = 'button';
  close.addEventListener('click', dialog.destroy);
  actions.append(copy, close);
  dialog.body.append(warning, credentialBox, actions);
}

function statCard(label, value, helper, accent) {
  const card = el('article', 'panel stat-card');
  card.style.setProperty('--glow', accent);
  card.append(el('p', 'eyebrow', label), el('p', 'mt-3 text-3xl font-extrabold tracking-tight', value), el('p', 'mt-2 text-xs text-slate-500', helper));
  return card;
}

function panelHeader(title, subtitle, action) {
  const header = el('div', 'flex flex-col gap-4 border-b border-slate-200 p-5 dark:border-white/[.07] sm:flex-row sm:items-center sm:justify-between');
  const text = el('div');
  text.append(el('h2', 'section-title', title), el('p', 'mt-1 text-xs text-slate-500', subtitle));
  header.append(text);
  if (action) header.append(action);
  return header;
}

function evaluatorModal(existing, onSaved) {
  const dialog = modal({ title: existing ? 'Editar avaliador' : 'Novo avaliador', subtitle: existing ? 'Atualize os dados de identificação e acesso.' : 'Uma senha temporária será gerada automaticamente.' });
  const form = el('form', 'space-y-4');
  const nameWrap = el('label');
  nameWrap.append(el('span', 'field-label', 'Nome completo'), el('input', 'form-field'));
  const nameInput = nameWrap.querySelector('input');
  nameInput.required = true;
  nameInput.maxLength = 120;
  nameInput.value = existing?.nome || '';
  const emailWrap = el('label');
  emailWrap.append(el('span', 'field-label', 'E-mail'), el('input', 'form-field'));
  const emailInput = emailWrap.querySelector('input');
  emailInput.type = 'email';
  emailInput.required = true;
  emailInput.maxLength = 180;
  emailInput.value = existing?.email || '';
  const usernameWrap = el('label');
  usernameWrap.append(el('span', 'field-label', 'Usuário de acesso'), el('input', 'form-field'));
  const usernameInput = usernameWrap.querySelector('input');
  usernameInput.required = true;
  usernameInput.maxLength = 64;
  usernameInput.autocomplete = 'off';
  usernameInput.placeholder = 'Ex.: ana.silva';
  usernameInput.value = existing?.username || '';
  const actions = el('div', 'flex justify-end gap-3 pt-3');
  const cancel = el('button', 'button-secondary', 'Cancelar');
  cancel.type = 'button';
  cancel.addEventListener('click', dialog.destroy);
  const save = el('button', 'button-primary', 'Salvar avaliador');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(nameWrap, emailWrap, usernameWrap, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    save.textContent = 'Salvando…';
    try {
      const payload = { nome: nameInput.value, email: emailInput.value, username: usernameInput.value.trim().toLowerCase() };
      const result = existing ? await api.avaliadores.update(existing.id, payload) : await api.avaliadores.create(payload);
      dialog.destroy();
      toast(existing ? 'Cadastro atualizado.' : 'Avaliador cadastrado.');
      await onSaved();
      if (!existing) temporaryCredentialModal(result.nome, result);
    } catch (error) {
      toast(error.message, 'error');
      save.disabled = false;
      save.textContent = 'Salvar avaliador';
    }
  });
  dialog.body.append(form);
  setTimeout(() => nameInput.focus(), 50);
}

function evaluatorTable(onChanged) {
  const panel = el('article', 'panel overflow-hidden');
  const add = el('button', 'button-primary', '+ Novo avaliador');
  add.addEventListener('click', () => evaluatorModal(null, onChanged));
  panel.append(panelHeader('Equipe de avaliadores', 'Cadastre, edite e acompanhe a atividade da equipe.', add));
  if (!cache.avaliadores.length) {
    panel.append(emptyState('Nenhum avaliador cadastrado', 'Cadastre ao menos um perfil antes de criar o primeiro lote.'));
    return panel;
  }
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'data-table');
  const thead = el('thead');
  const header = el('tr');
  ['Avaliador', 'Contato', 'Lotes', 'Avaliações', 'Ações'].forEach((label) => header.append(el('th', '', label)));
  thead.append(header);
  const tbody = el('tbody');
  cache.avaliadores.forEach((evaluator) => {
    const row = el('tr');
    const identity = el('td');
    const identityWrap = el('div', 'flex items-center gap-3');
    const identityText = el('span');
    const nameLine = el('span', 'flex flex-wrap items-center gap-2 font-bold', evaluator.nome);
    if (evaluator.senha_temporaria) nameLine.append(el('span', 'pill bg-amber-400/10 text-amber-500', 'Troca pendente'));
    identityText.append(nameLine, el('span', 'mt-1 block text-[11px] text-slate-500', `@${evaluator.username || 'sem-usuario'}`));
    identityWrap.append(el('span', 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-400/10 text-xs font-extrabold text-teal-500', evaluator.nome.slice(0, 2).toUpperCase()), identityText);
    identity.append(identityWrap);
    row.append(identity, el('td', 'text-slate-500', evaluator.email), el('td', '', evaluator.lotes_atribuidos), el('td', '', evaluator.avaliacoes_realizadas));
    const actions = el('td');
    const group = el('div', 'flex gap-2');
    group.append(actionButton('Editar', () => evaluatorModal(evaluator, onChanged)), actionButton('Redefinir senha', async () => {
      if (!await confirmAction('Redefinir senha?', `A senha atual de ${evaluator.nome} deixará de funcionar e todas as sessões serão encerradas.`, 'Gerar senha temporária')) return;
      try {
        const credentials = await api.avaliadores.resetPassword(evaluator.id);
        await onChanged();
        temporaryCredentialModal(evaluator.nome, credentials);
      } catch (error) { toast(error.message, 'error'); }
    }), actionButton('Remover', async () => {
      if (!await confirmAction('Remover avaliador?', `${evaluator.nome} será removido se ainda não possuir avaliações.`, 'Remover')) return;
      try { await api.avaliadores.remove(evaluator.id); toast('Avaliador removido.'); await onChanged(); } catch (error) { toast(error.message, 'error'); }
    }, true));
    actions.append(group);
    row.append(actions);
    tbody.append(row);
  });
  table.append(thead, tbody);
  wrap.append(table);
  panel.append(wrap);
  return panel;
}

function parseCsv(file) {
  return new Promise((resolve, reject) => {
    if (!file.name.toLowerCase().endsWith('.csv')) return reject(new Error(`${file.name} não é um arquivo CSV.`));
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      worker: true,
      complete: (result) => {
        const serious = result.errors.filter((error) => ['Quotes', 'Delimiter', 'FieldMismatch'].includes(error.type) || error.code === 'UndetectableDelimiter');
        if (!result.meta.fields?.length) return reject(new Error(`${file.name}: nenhum cabeçalho foi detectado.`));
        if (serious.length) return reject(new Error(`${file.name}: CSV malformado na linha ${(serious[0].row ?? 0) + 1} (${serious[0].message}).`));
        const originalFields = result.meta.fields;
        const fields = originalFields.map((header) => header.replace(/^\uFEFF/, '').trim());
        if (new Set(fields).size !== fields.length || fields.some((field) => !field)) return reject(new Error(`${file.name}: existem cabeçalhos vazios ou duplicados.`));
        const rows = result.data.map((row) => Object.fromEntries(originalFields.map((field, index) => [fields[index], row[field]])));
        const brokenUtf8 = rows.some((row) => Object.values(row).some((value) => String(value ?? '').includes('\uFFFD')));
        if (brokenUtf8) return reject(new Error(`${file.name}: foram encontrados caracteres inválidos. Salve o arquivo como UTF-8.`));
        resolve({ file, fields, rows });
      },
      error: (error) => reject(new Error(`${file.name}: ${error.message}`))
    });
  });
}

function selectField(label, options) {
  const wrap = el('label');
  wrap.append(el('span', 'field-label', label));
  const select = el('select', 'form-field');
  options.forEach(({ value, label: text }) => {
    const option = el('option', '', text);
    option.value = value;
    select.append(option);
  });
  wrap.append(select);
  return { wrap, select };
}

function analyzeRows(rows, column) {
  const empty = [];
  const duplicates = [];
  const seen = new Map();
  rows.forEach((row, index) => {
    const value = String(row[column] ?? '').trim();
    if (!value) empty.push(index + 2);
    const key = value.toLocaleLowerCase('pt-BR');
    if (value && seen.has(key)) duplicates.push([seen.get(key), index + 2]);
    else if (value) seen.set(key, index + 2);
  });
  return { empty, duplicates };
}

function batchConfigModal(parsed) {
  return new Promise((resolve) => {
    const dialog = modal({ title: 'Configurar lote', subtitle: parsed.file.name, wide: true });
    let resolved = false;
    const finish = (value) => { if (resolved) return; resolved = true; resolve(value); };
    dialog.onClose(() => finish(null));
    const form = el('form', 'space-y-6');
    const grid = el('div', 'grid gap-4 md:grid-cols-2');
    const options = parsed.fields.map((field) => ({ value: field, label: field }));
    const contentField = selectField('Coluna do CSV que será analisada', options);
    const typeField = selectField('Tipo de avaliação', [{ value: 'individual', label: 'Individual' }, { value: 'dupla', label: 'Dupla' }]);
    const eligible = cache.avaliadores.filter((item) => item.ativo && item.username && item.tem_senha);
    const firstField = selectField('Avaliador 1', [{ value: '', label: 'Selecione' }, ...eligible.map((item) => ({ value: item.id, label: `${item.nome} (@${item.username})` }))]);
    const secondField = selectField('Avaliador 2', [{ value: '', label: 'Selecione' }, ...eligible.map((item) => ({ value: item.id, label: `${item.nome} (@${item.username})` }))]);
    secondField.wrap.classList.add('hidden');
    const outputInfo = el('div', 'rounded-2xl border border-teal-400/20 bg-teal-400/[.05] p-4 md:col-span-2');
    outputInfo.append(el('p', 'text-xs font-extrabold text-teal-500', 'Colunas criadas/preenchidas na exportação'), el('p', 'mt-2 font-mono text-xs text-slate-500', 'hate/no_hate · tipos_hate'));
    grid.append(contentField.wrap, typeField.wrap, firstField.wrap, secondField.wrap, outputInfo);

    const validation = el('div', 'rounded-2xl border border-slate-200 bg-slate-500/[.03] p-4 text-xs dark:border-white/10');
    const validationTitle = el('p', 'font-extrabold', 'Validação do arquivo');
    const validationText = el('p', 'mt-2 leading-5 text-slate-500');
    validation.append(validationTitle, validationText);

    const previewWrap = el('div');
    previewWrap.append(el('p', 'field-label', 'Prévia das primeiras 5 linhas'));
    const tableWrap = el('div', 'table-wrap rounded-xl border border-slate-200 dark:border-white/10');
    const preview = el('table', 'data-table');
    const head = el('thead');
    const headRow = el('tr');
    parsed.fields.forEach((field) => headRow.append(el('th', '', field)));
    head.append(headRow);
    const body = el('tbody');
    parsed.rows.slice(0, 5).forEach((row) => {
      const tr = el('tr');
      parsed.fields.forEach((field) => tr.append(el('td', 'max-w-[320px] truncate', row[field] ?? '')));
      body.append(tr);
    });
    preview.append(head, body);
    tableWrap.append(preview);
    previewWrap.append(tableWrap);

    const updateValidation = () => {
      const report = analyzeRows(parsed.rows, contentField.select.value);
      if (!report.empty.length && !report.duplicates.length) {
        validation.className = 'rounded-2xl border border-teal-400/20 bg-teal-400/[.05] p-4 text-xs';
        validationText.textContent = `${parsed.rows.length} linhas válidas · nenhum conteúdo vazio ou duplicado.`;
      } else {
        validation.className = 'rounded-2xl border border-rose-400/20 bg-rose-400/[.05] p-4 text-xs';
        validationText.textContent = `${report.empty.length} linha(s) vazia(s) e ${report.duplicates.length} duplicidade(s). Corrija o CSV antes de confirmar.`;
      }
      return report;
    };
    contentField.select.addEventListener('change', updateValidation);
    typeField.select.addEventListener('change', () => secondField.wrap.classList.toggle('hidden', typeField.select.value !== 'dupla'));
    updateValidation();

    const actions = el('div', 'flex flex-col-reverse justify-end gap-3 sm:flex-row');
    const cancel = el('button', 'button-secondary', 'Cancelar');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { finish(null); dialog.destroy(); });
    const save = el('button', 'button-primary', `Criar lote com ${parsed.rows.length} itens`);
    save.type = 'submit';
    actions.append(cancel, save);
    form.append(grid, validation, previewWrap, actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const report = updateValidation();
      if (report.empty.length || report.duplicates.length) return toast('Remova conteúdos vazios e duplicados antes de importar.', 'error');
      const evaluatorIds = [Number(firstField.select.value)];
      if (typeField.select.value === 'dupla') evaluatorIds.push(Number(secondField.select.value));
      if (evaluatorIds.some((id) => !id) || new Set(evaluatorIds).size !== evaluatorIds.length) return toast('Selecione avaliadores distintos para o lote.', 'error');
      save.disabled = true;
      save.textContent = 'Importando…';
      try {
        const payload = {
          nomeArquivo: parsed.file.name,
          colunaConteudo: contentField.select.value,
          tipoAvaliacao: typeField.select.value,
          avaliadoresAtribuidos: evaluatorIds,
          linhas: parsed.rows.map((row, index) => ({ linhaIndex: index + 1, conteudo: row[contentField.select.value], dadosOriginais: row }))
        };
        await api.lotes.create(payload);
        finish(true);
        dialog.destroy();
        toast(`${parsed.file.name} foi importado.`);
      } catch (error) {
        toast(errorMessage(error), 'error');
        save.disabled = false;
        save.textContent = `Criar lote com ${parsed.rows.length} itens`;
      }
    });
    dialog.body.append(form);
  });
}

function assignmentModal(lote, onSaved) {
  const dialog = modal({ title: 'Editar atribuição', subtitle: lote.nome_arquivo });
  const form = el('form', 'space-y-4');
  const currentIds = String(lote.avaliadores_ids || '').split(',').filter(Boolean).map(Number);
  const typeField = selectField('Tipo de avaliação', [{ value: 'individual', label: 'Individual' }, { value: 'dupla', label: 'Dupla' }]);
  typeField.select.value = lote.tipo_avaliacao;
  const choices = [{ value: '', label: 'Selecione' }, ...cache.avaliadores.filter((item) => item.ativo && item.username && item.tem_senha).map((item) => ({ value: item.id, label: `${item.nome} (@${item.username})` }))];
  const first = selectField('Avaliador 1', choices);
  const second = selectField('Avaliador 2', choices);
  first.select.value = currentIds[0] || '';
  second.select.value = currentIds[1] || '';
  second.wrap.classList.toggle('hidden', lote.tipo_avaliacao !== 'dupla');
  typeField.select.addEventListener('change', () => second.wrap.classList.toggle('hidden', typeField.select.value !== 'dupla'));
  const actions = el('div', 'flex justify-end gap-3 pt-3');
  const cancel = el('button', 'button-secondary', 'Cancelar');
  cancel.type = 'button';
  cancel.addEventListener('click', dialog.destroy);
  const save = el('button', 'button-primary', 'Salvar atribuição');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(typeField.wrap, first.wrap, second.wrap, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ids = [Number(first.select.value)];
    if (typeField.select.value === 'dupla') ids.push(Number(second.select.value));
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return toast('Selecione perfis distintos.', 'error');
    try {
      await api.lotes.update(lote.id, { tipoAvaliacao: typeField.select.value, avaliadoresAtribuidos: ids });
      dialog.destroy();
      toast('Atribuição atualizada.');
      await onSaved();
    } catch (error) { toast(error.message, 'error'); }
  });
  dialog.body.append(form);
}

function batchesPanel(onChanged) {
  const panel = el('article', 'panel overflow-hidden');
  const fileInput = el('input', 'hidden');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = '.csv,text/csv';
  const upload = el('button', 'button-primary', '↑ Importar CSV');
  upload.addEventListener('click', () => {
    if (!cache.avaliadores.some((item) => item.ativo && item.username && item.tem_senha)) return toast('Cadastre ou edite ao menos um avaliador com usuário e senha antes de importar o CSV.', 'error');
    fileInput.click();
  });
  panel.append(panelHeader('Lotes de trabalho', 'Importe CSVs, acompanhe o progresso e gerencie atribuições.', upload), fileInput);
  const drop = el('div', 'dropzone m-5');
  drop.append(el('p', 'text-sm font-extrabold', 'Solte arquivos CSV aqui'), el('p', 'mt-2 text-xs text-slate-500', 'UTF-8 com cabeçalho · um arquivo corresponde a um lote'));
  drop.addEventListener('click', () => {
    if (!cache.avaliadores.some((item) => item.ativo && item.username && item.tem_senha)) return toast('Cadastre ou edite um avaliador com usuário e senha antes de importar o CSV.', 'error');
    fileInput.click();
  });
  ['dragenter', 'dragover'].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove('dragover'); }));

  const handleFiles = async (files) => {
    if (!cache.avaliadores.some((item) => item.ativo && item.username && item.tem_senha)) return toast('Cadastre ou edite um avaliador com usuário e senha antes de importar lotes.', 'error');
    for (const file of [...files]) {
      try {
        const parsed = await parseCsv(file);
        await batchConfigModal(parsed);
      } catch (error) { toast(error.message, 'error'); }
    }
    await onChanged();
  };
  fileInput.addEventListener('change', async () => { await handleFiles(fileInput.files); fileInput.value = ''; });
  drop.addEventListener('drop', (event) => handleFiles(event.dataTransfer.files));
  panel.append(drop);

  if (!cache.lotes.length) {
    panel.append(emptyState('Nenhum lote importado', 'Use um CSV com cabeçalho para iniciar o fluxo de avaliação.'));
    return panel;
  }
  const wrap = el('div', 'table-wrap border-t border-slate-200 dark:border-white/[.07]');
  const table = el('table', 'data-table');
  const head = el('thead');
  const headRow = el('tr');
  ['Lote', 'Modo', 'Equipe', 'Progresso', 'Status', 'Ações'].forEach((label) => headRow.append(el('th', '', label)));
  head.append(headRow);
  const body = el('tbody');
  cache.lotes.forEach((lote) => {
    const row = el('tr');
    const name = el('td');
    name.append(el('p', 'max-w-[250px] truncate font-bold', lote.nome_arquivo), el('p', 'mt-1 text-[11px] text-slate-500', `${lote.total_itens} itens · ${formatDate(lote.data_upload)}`));
    const progress = el('td', 'min-w-[165px]');
    const numbers = el('div', 'mb-2 flex justify-between text-[11px]');
    numbers.append(el('span', 'font-bold', `${lote.avaliacoes_feitas}/${lote.total_itens * lote.total_avaliadores}`), el('span', 'text-slate-500', percent(lote.progresso)));
    const track = el('div', 'progress-track');
    const bar = el('div', 'progress-bar');
    bar.style.width = percent(lote.progresso);
    track.append(bar);
    progress.append(numbers, track);
    row.append(name, el('td', '', lote.tipo_avaliacao === 'dupla' ? 'Dupla' : 'Individual'), el('td', 'max-w-[220px] text-slate-500', lote.avaliadores_nomes || '—'), progress);
    const status = el('td');
    status.append(statusPill(lote.status));
    row.append(status);
    const actions = el('td');
    const group = el('div', 'flex gap-2');
    group.append(actionButton('Atribuir', () => assignmentModal(lote, onChanged)), actionButton('Excluir', async () => {
      if (!await confirmAction('Excluir lote?', `${lote.nome_arquivo} e todas as avaliações relacionadas serão excluídos.`, 'Excluir lote')) return;
      try { await api.lotes.remove(lote.id); toast('Lote excluído.'); await onChanged(); } catch (error) { toast(error.message, 'error'); }
    }, true));
    actions.append(group);
    row.append(actions);
    body.append(row);
  });
  table.append(head, body);
  wrap.append(table);
  panel.append(wrap);
  return panel;
}

export async function renderAdmin() {
  const root = document.querySelector('#view-admin');
  clear(root).append(skeleton(4));
  try {
    [cache.avaliadores, cache.lotes] = await Promise.all([api.avaliadores.list(), api.lotes.list()]);
    const rerender = () => renderAdmin();
    const completed = cache.lotes.filter((lote) => lote.status === 'concluido').length;
    const reviews = cache.lotes.reduce((sum, lote) => sum + Number(lote.avaliacoes_feitas), 0);
    const stats = el('div', 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4');
    stats.append(
      statCard('Lotes ativos', cache.lotes.length, `${completed} concluído${completed === 1 ? '' : 's'}`, 'rgba(45,212,191,.14)'),
      statCard('Avaliadores', cache.avaliadores.length, 'perfis cadastrados', 'rgba(56,189,248,.13)'),
      statCard('Avaliações', reviews.toLocaleString('pt-BR'), 'decisões registradas', 'rgba(167,139,250,.13)'),
      statCard('Itens importados', cache.lotes.reduce((sum, lote) => sum + Number(lote.total_itens), 0).toLocaleString('pt-BR'), 'conteúdos no banco', 'rgba(251,191,36,.13)')
    );
    clear(root).append(stats, el('div', 'h-6'), batchesPanel(rerender), el('div', 'h-6'), evaluatorTable(rerender));
  } catch (error) {
    clear(root).append(emptyState('Não foi possível carregar o painel', error.message));
  }
}

export function getAdminCache() {
  return cache;
}
