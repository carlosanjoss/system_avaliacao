import { api } from './api.js';
import { clear, el, emptyState, modal, skeleton, toast } from './ui.js';

let context;

export function setupAgreement(value) {
  context = value;
}

function metric(label, value, helper) {
  const card = el('div', 'rounded-2xl border border-slate-200 bg-slate-500/[.025] p-4 dark:border-white/[.08]');
  card.append(el('p', 'eyebrow', label), el('p', 'mt-2 text-2xl font-extrabold', value), el('p', 'mt-1 text-[11px] text-slate-500', helper));
  return card;
}

function visible(field, responses) {
  if (!field.condicao) return true;
  const value = responses[field.condicao.campoChave];
  const expected = field.condicao.valores.map(String);
  const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
  if (field.condicao.operador === 'respondido') return !empty;
  if (field.condicao.operador === 'nao_respondido') return empty;
  if (field.condicao.operador === 'igual') return expected.includes(String(value));
  if (field.condicao.operador === 'diferente') return !expected.includes(String(value));
  const values = Array.isArray(value) ? value.map(String) : [String(value ?? '')];
  if (field.condicao.operador === 'contem') return expected.every((item) => values.includes(item));
  return expected.some((item) => values.includes(item));
}

function formatValue(field, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (field.tipo === 'texto') return String(value);
  return (Array.isArray(value) ? value : [value]).map((item) => field.opcoes.find((option) => option.valor === item)?.rotulo || item).join(', ');
}

function genericReconciliationModal(item, data, reload) {
  const dialog = modal({ title: `Adjudicar linha ${item.linha_index}`, subtitle: 'Compare as avaliações cegas e defina a resposta final campo por campo.', wide: true });
  const content = el('p', 'whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-500/[.025] p-5 text-base font-semibold leading-7 dark:border-white/[.08]', item.conteudo);
  const compare = el('div', 'mt-5 grid gap-3 md:grid-cols-2');
  [item.respostas1, item.respostas2].forEach((responses, index) => {
    const card = el('div', 'rounded-2xl border border-slate-200 p-4 dark:border-white/[.08]');
    card.append(el('p', 'mb-3 text-xs font-extrabold text-teal-500', data.avaliadores[index].nome));
    data.modelo.campos.forEach((field) => { if (visible(field, responses)) card.append(el('p', 'mt-2 text-[11px] font-bold text-slate-500', field.rotulo), el('p', 'text-sm', formatValue(field, responses[field.chave]))); });
    compare.append(card);
  });
  let responses = { ...(item.respostas_finais || item.respostas1) };
  const form = el('div', 'mt-6 space-y-4');
  const render = () => {
    clear(form);
    for (const field of data.modelo.campos) {
      if (!visible(field, responses)) { delete responses[field.chave]; continue; }
      const section = el('fieldset', 'rounded-2xl border border-slate-200 p-4 dark:border-white/[.08]');
      section.append(el('legend', 'px-2 text-sm font-extrabold', `${field.rotulo}${field.obrigatorio ? ' *' : ''}`));
      if (field.tipo === 'texto') {
        const input = el('textarea', 'form-field min-h-20');
        input.value = responses[field.chave] || '';
        input.addEventListener('input', () => { responses[field.chave] = input.value; });
        section.append(input);
      } else {
        const grid = el('div', 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3');
        field.opcoes.forEach((option) => {
          const button = el('button', 'category-chip', option.rotulo);
          button.type = 'button';
          const selected = field.tipo === 'multipla' ? (responses[field.chave] || []).includes(option.valor) : responses[field.chave] === option.valor;
          button.classList.toggle('selected', selected);
          button.addEventListener('click', () => {
            if (field.tipo === 'multipla') {
              const values = new Set(responses[field.chave] || []);
              if (values.has(option.valor)) values.delete(option.valor); else values.add(option.valor);
              responses[field.chave] = [...values];
            } else responses[field.chave] = option.valor;
            render();
          });
          grid.append(button);
        });
        section.append(grid);
      }
      form.append(section);
      if (field.tipo !== 'multipla' && field.opcoes.find((option) => option.valor === responses[field.chave])?.encerraFluxo) break;
    }
  };
  render();
  const actions = el('div', 'mt-6 flex justify-end gap-3');
  const cancel = el('button', 'button-secondary', 'Cancelar');
  cancel.addEventListener('click', dialog.destroy);
  const save = el('button', 'button-primary', 'Registrar decisão do adjudicador');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try { await api.reconciliar(item.item_id, { respostasFinais: responses }); dialog.destroy(); toast('Decisão do adjudicador registrada.'); await reload(); }
    catch (error) { toast(error.message, 'error'); save.disabled = false; }
  });
  actions.append(cancel, save);
  dialog.body.append(content, compare, el('p', 'mb-3 mt-6 text-xs font-extrabold uppercase tracking-[.12em] text-slate-500', 'Decisão final'), form, actions);
}

function reconciliationModal(item, data, categories, reload) {
  const dialog = modal({ title: `Adjudicar linha ${item.linha_index}`, subtitle: 'Compare as avaliações cegas. A decisão do admin será usada no CSV consolidado.', wide: true });
  const content = el('p', 'whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-500/[.025] p-5 text-base font-semibold leading-7 dark:border-white/[.08]', item.conteudo);
  const compare = el('div', 'mt-5 grid gap-3 md:grid-cols-2');
  data.avaliadores.forEach((evaluator, index) => {
    const classification = index === 0 ? item.a1 : item.a2;
    const labels = index === 0 ? item.categorias1 : item.categorias2;
    const card = el('div', 'rounded-2xl border border-slate-200 p-4 dark:border-white/[.08]');
    card.append(el('p', 'text-xs font-extrabold', evaluator.nome), el('p', `mt-2 text-sm font-bold ${classification === 'hate' ? 'text-rose-500' : 'text-teal-500'}`, classification === 'hate' ? 'Hate' : 'Não Hate'), el('p', 'mt-2 text-xs leading-5 text-slate-500', labels.map((label) => label.nome).join(', ') || 'Sem categorias'));
    compare.append(card);
  });

  let decision = item.decisao_final || null;
  const selected = new Set(item.categorias_finais || []);
  const decisionLabel = el('p', 'mb-3 mt-6 text-xs font-extrabold uppercase tracking-[.12em] text-slate-500', 'Decisão final');
  const decisionButtons = el('div', 'flex gap-3');
  const hate = el('button', 'classification-card', 'Hate');
  const safe = el('button', 'classification-card', 'Não Hate');
  hate.type = safe.type = 'button';
  const categoryArea = el('div', 'mt-6 hidden');
  categoryArea.append(el('p', 'mb-3 text-xs font-extrabold uppercase tracking-[.12em] text-slate-500', 'Categorias finais'));
  const categoryGrid = el('div', 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3');
  const update = () => {
    hate.classList.toggle('selected-hate', decision === 'hate');
    safe.classList.toggle('selected-safe', decision === 'nao_hate');
    categoryArea.classList.toggle('hidden', decision !== 'hate');
    categoryGrid.querySelectorAll('[data-category]').forEach((button) => button.classList.toggle('selected', selected.has(Number(button.dataset.category))));
  };
  hate.addEventListener('click', () => { decision = 'hate'; update(); });
  safe.addEventListener('click', () => { decision = 'nao_hate'; selected.clear(); update(); });
  decisionButtons.append(hate, safe);
  categories.forEach((category) => {
    const button = el('button', 'category-chip', category.nome);
    button.type = 'button';
    button.dataset.category = category.id;
    button.addEventListener('click', () => { if (selected.has(category.id)) selected.delete(category.id); else selected.add(category.id); update(); });
    categoryGrid.append(button);
  });
  categoryArea.append(categoryGrid);
  const actions = el('div', 'mt-7 flex justify-end gap-3 border-t border-slate-200 pt-5 dark:border-white/[.07]');
  const cancel = el('button', 'button-secondary', 'Cancelar');
  cancel.type = 'button';
  cancel.addEventListener('click', dialog.destroy);
  const save = el('button', 'button-primary', 'Registrar decisão do adjudicador');
  save.type = 'button';
  save.addEventListener('click', async () => {
    if (!decision) return toast('Selecione uma decisão final.', 'error');
    if (decision === 'hate' && !selected.size) return toast('Selecione ao menos uma categoria final.', 'error');
    save.disabled = true;
    try {
      const profile = context.getProfile();
      await api.reconciliar(item.item_id, { decisaoFinal: decision, categoriasFinais: [...selected], decididoPor: profile?.type === 'avaliador' ? profile.id : null });
      dialog.destroy();
      toast('Decisão do adjudicador registrada.');
      await reload();
    } catch (error) { toast(error.message, 'error'); save.disabled = false; }
  });
  actions.append(cancel, save);
  dialog.body.append(content, compare, decisionLabel, decisionButtons, categoryArea, actions);
  update();
}

async function loadAgreement(lote, root) {
  clear(root).append(skeleton(4));
  try {
    const data = await api.lotes.agreement(lote.id);
    const categories = data.modelo?.sistema === 'hate_v1' ? await api.categorias() : [];
    const wrapper = el('div');
    const back = el('button', 'button-secondary mb-5', '← Outros lotes');
    back.addEventListener('click', renderAgreement);
    wrapper.append(back);
    const title = el('div', 'mb-6');
    title.append(el('p', 'eyebrow', 'Concordância entre avaliadores'), el('h2', 'mt-2 text-xl font-extrabold tracking-tight', lote.nome_arquivo), el('p', 'mt-2 text-xs text-slate-500', `${data.avaliadores.map((item) => item.nome).join(' × ')}`));
    wrapper.append(title);
    const metrics = el('div', 'mb-6 grid gap-3 sm:grid-cols-3');
    const kappa = data.metricas.kappa == null ? 'N/D' : data.metricas.kappa.toFixed(3);
    const agreement = data.metricas.percentual == null ? 'N/D' : `${Math.round(data.metricas.percentual * 100)}%`;
    metrics.append(metric('Kappa de Cohen', kappa, 'concordância da classificação principal'), metric('Concordância', agreement, `${data.metricas.concordantes}/${data.metricas.totalPareados} itens pareados`), metric('A adjudicar', data.pendentesReconciliacao, `${data.divergencias.length} conflitos totais`));
    wrapper.append(metrics);
    const panel = el('article', 'panel overflow-hidden');
    panel.append((() => {
      const head = el('div', 'border-b border-slate-200 p-5 dark:border-white/[.07]');
      head.append(el('h3', 'section-title', 'Conflitos identificados'), el('p', 'mt-1 text-xs text-slate-500', 'Abra cada item para comparar as avaliações cegas e registrar a decisão do adjudicador.'));
      return head;
    })());
    if (!data.divergencias.length) panel.append(emptyState('Sem divergências', 'Não há conflitos entre os itens avaliados pelos dois perfis.'));
    else {
      const list = el('div', 'divide-y divide-slate-200 dark:divide-white/[.07]');
      data.divergencias.forEach((item) => {
        const row = el('div', 'flex flex-col gap-4 p-5 md:flex-row md:items-center');
        const text = el('div', 'min-w-0 flex-1');
        text.append(el('p', 'text-[11px] font-bold text-slate-500', `Linha ${item.linha_index}`), el('p', 'mt-1 line-clamp-2 text-sm font-semibold leading-6', item.conteudo));
        const labels = el('div', 'flex shrink-0 items-center gap-2 text-xs font-extrabold');
        if (data.modelo?.sistema === 'hate_v1' && item.conflito_classificacao) labels.append(el('span', 'pill bg-rose-400/10 text-rose-500', item.a1 === 'hate' ? 'Hate' : 'Não Hate'), el('span', 'text-slate-500', '×'), el('span', 'pill bg-teal-400/10 text-teal-500', item.a2 === 'hate' ? 'Hate' : 'Não Hate'));
        else if (data.modelo?.sistema === 'hate_v1') labels.append(el('span', 'pill bg-amber-400/10 text-amber-500', 'Categorias diferentes'));
        else labels.append(el('span', 'pill bg-amber-400/10 text-amber-500', 'Respostas diferentes'));
        const reconciled = data.modelo?.sistema === 'hate_v1' ? Boolean(item.decisao_final) : item.reconciliado;
        const open = el('button', reconciled ? 'button-secondary' : 'button-primary', reconciled ? 'Editar decisão' : 'Adjudicar');
        open.addEventListener('click', () => data.modelo?.sistema === 'hate_v1' ? reconciliationModal(item, data, categories, () => loadAgreement(lote, root)) : genericReconciliationModal(item, data, () => loadAgreement(lote, root)));
        row.append(text, labels, open);
        list.append(row);
      });
      panel.append(list);
    }
    wrapper.append(panel);
    clear(root).append(wrapper);
    document.querySelector('#conflict-badge').textContent = data.pendentesReconciliacao;
    document.querySelector('#conflict-badge').classList.toggle('hidden', !data.pendentesReconciliacao);
  } catch (error) {
    clear(root).append(emptyState('Não foi possível calcular a concordância', error.message));
  }
}

export async function renderAgreement() {
  const root = document.querySelector('#view-reconciliar');
  clear(root).append(skeleton(4));
  try {
    const lotes = (await api.lotes.list()).filter((lote) => lote.tipo_avaliacao === 'dupla');
    const heading = el('div', 'mb-6');
    heading.append(el('p', 'eyebrow', 'Avaliação cega'), el('h2', 'mt-2 text-2xl font-extrabold tracking-tight', 'Conflitos para adjudicação'), el('p', 'mt-2 text-sm text-slate-500', 'Os avaliadores não veem a resposta um do outro. O admin compara os conflitos e registra a decisão final.'));
    const grid = el('div', 'grid gap-4 lg:grid-cols-2');
    lotes.forEach((lote) => {
      const card = el('button', 'panel p-5 text-left transition hover:-translate-y-0.5 hover:border-teal-400');
      card.type = 'button';
      card.append(el('p', 'truncate text-sm font-extrabold', lote.nome_arquivo), el('p', 'mt-2 text-xs text-slate-500', `${lote.avaliadores_nomes} · ${lote.total_itens} itens`));
      card.addEventListener('click', () => loadAgreement(lote, root));
      grid.append(card);
    });
    clear(root).append(heading, lotes.length ? grid : emptyState('Nenhum lote em dupla cega', 'Crie um lote em modo dupla cega para calcular concordância e adjudicar conflitos.'));
  } catch (error) {
    clear(root).append(emptyState('Não foi possível carregar os lotes', error.message));
  }
}
