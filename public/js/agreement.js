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

function reconciliationModal(item, data, categories, reload) {
  const dialog = modal({ title: `Reconciliar linha ${item.linha_index}`, subtitle: 'A decisão final substitui a divergência apenas no CSV consolidado.', wide: true });
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
  const save = el('button', 'button-primary', 'Registrar decisão final');
  save.type = 'button';
  save.addEventListener('click', async () => {
    if (!decision) return toast('Selecione uma decisão final.', 'error');
    if (decision === 'hate' && !selected.size) return toast('Selecione ao menos uma categoria final.', 'error');
    save.disabled = true;
    try {
      const profile = context.getProfile();
      await api.reconciliar(item.item_id, { decisaoFinal: decision, categoriasFinais: [...selected], decididoPor: profile?.type === 'avaliador' ? profile.id : null });
      dialog.destroy();
      toast('Divergência reconciliada.');
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
    const [data, categories] = await Promise.all([api.lotes.agreement(lote.id), api.categorias()]);
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
    metrics.append(metric('Kappa de Cohen', kappa, 'concordância além do acaso'), metric('Concordância', agreement, `${data.metricas.concordantes}/${data.metricas.totalPareados} itens pareados`), metric('A reconciliar', data.pendentesReconciliacao, `${data.divergencias.length} divergências totais`));
    wrapper.append(metrics);
    const panel = el('article', 'panel overflow-hidden');
    panel.append((() => {
      const head = el('div', 'border-b border-slate-200 p-5 dark:border-white/[.07]');
      head.append(el('h3', 'section-title', 'Itens divergentes'), el('p', 'mt-1 text-xs text-slate-500', 'Abra cada item para comparar as avaliações e registrar a decisão final.'));
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
        labels.append(el('span', 'pill bg-rose-400/10 text-rose-500', 'Hate'), el('span', 'text-slate-500', '×'), el('span', 'pill bg-teal-400/10 text-teal-500', 'Não Hate'));
        const open = el('button', item.decisao_final ? 'button-secondary' : 'button-primary', item.decisao_final ? 'Editar decisão' : 'Reconciliar');
        open.addEventListener('click', () => reconciliationModal(item, data, categories, () => loadAgreement(lote, root)));
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
    heading.append(el('p', 'eyebrow', 'Qualidade das anotações'), el('h2', 'mt-2 text-2xl font-extrabold tracking-tight', 'Lotes com avaliação dupla'), el('p', 'mt-2 text-sm text-slate-500', 'O Kappa é calculado sobre os itens já avaliados pelos dois perfis.'));
    const grid = el('div', 'grid gap-4 lg:grid-cols-2');
    lotes.forEach((lote) => {
      const card = el('button', 'panel p-5 text-left transition hover:-translate-y-0.5 hover:border-teal-400');
      card.type = 'button';
      card.append(el('p', 'truncate text-sm font-extrabold', lote.nome_arquivo), el('p', 'mt-2 text-xs text-slate-500', `${lote.avaliadores_nomes} · ${lote.total_itens} itens`));
      card.addEventListener('click', () => loadAgreement(lote, root));
      grid.append(card);
    });
    clear(root).append(heading, lotes.length ? grid : emptyState('Nenhum lote em dupla', 'Crie um lote em modo dupla para calcular concordância e reconciliar divergências.'));
  } catch (error) {
    clear(root).append(emptyState('Não foi possível carregar os lotes', error.message));
  }
}
