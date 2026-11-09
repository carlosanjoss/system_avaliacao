import { api } from './api.js';
import { clear, el, emptyState, formatDate, modal, skeleton } from './ui.js';

function selectControl(label, items, placeholder) {
  const wrap = el('label');
  wrap.append(el('span', 'field-label', label));
  const select = el('select', 'form-field');
  const empty = el('option', '', placeholder);
  empty.value = '';
  select.append(empty);
  items.forEach(({ value, text }) => {
    const option = el('option', '', text);
    option.value = value;
    select.append(option);
  });
  wrap.append(select);
  return { wrap, select };
}

function showDetails(item) {
  const dialog = modal({
    title: `Avaliação de ${item.avaliador_nome}`,
    subtitle: `${item.nome_arquivo} · linha ${item.linha_index} · ${formatDate(item.atualizado_em)}`,
    wide: true
  });
  const content = el('div', 'rounded-2xl border border-slate-200 bg-slate-500/[.025] p-5 dark:border-white/[.08]');
  content.append(el('p', 'field-label', 'Conteúdo avaliado'), el('p', 'mt-3 whitespace-pre-wrap break-words text-sm leading-7', item.conteudo));
  const answers = el('div', 'mt-5 grid gap-3 sm:grid-cols-2');
  item.respostas.forEach((answer) => {
    const card = el('div', 'rounded-2xl border border-slate-200 p-4 dark:border-white/[.08]');
    card.append(el('p', 'text-[11px] font-extrabold uppercase tracking-wide text-slate-500', answer.rotulo), el('p', 'mt-2 whitespace-pre-wrap break-words text-sm font-bold', answer.valor || '—'));
    answers.append(card);
  });
  const close = el('button', 'button-primary mt-5', 'Fechar');
  close.type = 'button';
  close.addEventListener('click', dialog.destroy);
  const actions = el('div', 'flex justify-end');
  close.classList.add('w-full', 'sm:w-auto');
  actions.append(close);
  dialog.body.append(content, answers, actions);
}

function answerSummary(item) {
  return item.respostas.map((answer) => `${answer.rotulo}: ${answer.valor}`).join(' · ');
}

export async function renderAudit() {
  const root = document.querySelector('#view-auditoria');
  clear(root).append(skeleton(4));
  try {
    const [evaluators, lots] = await Promise.all([api.avaliadores.list(), api.lotes.list()]);
    const heading = el('div', 'mb-6');
    heading.append(
      el('p', 'eyebrow', 'Rastreabilidade'),
      el('h2', 'mt-2 text-2xl font-extrabold tracking-tight', 'Auditoria das avaliações'),
      el('p', 'mt-2 max-w-2xl text-sm leading-6 text-slate-500', 'Veja exatamente o que cada avaliador registrou, com conteúdo, respostas e horário da última atualização.')
    );

    const filters = el('form', 'panel mb-5 grid gap-4 p-5 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end');
    const evaluator = selectControl('Avaliador', evaluators.map((item) => ({ value: item.id, text: item.nome })), 'Todos os avaliadores');
    const lot = selectControl('Lote', lots.map((item) => ({ value: item.id, text: item.nome_arquivo })), 'Todos os lotes');
    const searchWrap = el('label');
    searchWrap.append(el('span', 'field-label', 'Busca'));
    const search = el('input', 'form-field');
    search.type = 'search';
    search.maxLength = 200;
    search.placeholder = 'Conteúdo, arquivo ou avaliador';
    searchWrap.append(search);
    const apply = el('button', 'button-primary w-full md:w-auto', 'Filtrar');
    apply.type = 'submit';
    filters.append(evaluator.wrap, lot.wrap, searchWrap, apply);

    const panel = el('article', 'panel overflow-hidden');
    const results = el('div');
    panel.append(results);
    clear(root).append(heading, filters, panel);

    let currentPage = 1;
    let requestNumber = 0;
    const load = async (page = 1) => {
      const ownRequest = ++requestNumber;
      clear(results).append(skeleton(4));
      const data = await api.auditoria.list({
        page,
        avaliadorId: evaluator.select.value,
        loteId: lot.select.value,
        busca: search.value.trim()
      });
      if (ownRequest !== requestNumber) return;
      currentPage = data.page;
      clear(results);
      if (!data.items.length) {
        results.append(emptyState('Nenhuma avaliação encontrada', 'Altere os filtros ou aguarde o registro de novas avaliações.'));
        return;
      }

      const wrap = el('div', 'table-wrap');
      const table = el('table', 'data-table responsive-table');
      const head = el('thead');
      const headRow = el('tr');
      ['Atualizada em', 'Avaliador', 'Lote', 'Conteúdo', 'Avaliação', ''].forEach((label) => headRow.append(el('th', '', label)));
      head.append(headRow);
      const body = el('tbody');
      data.items.forEach((item) => {
        const row = el('tr');
        row.append(
          el('td', 'whitespace-nowrap text-xs text-slate-500', formatDate(item.atualizado_em)),
          el('td', 'font-bold', item.avaliador_nome),
          el('td', 'max-w-[220px] text-xs text-slate-500', `${item.nome_arquivo} · linha ${item.linha_index}`),
          el('td', 'max-w-[320px] truncate', item.conteudo),
          el('td', 'max-w-[320px] text-xs text-slate-500', answerSummary(item))
        );
        const action = el('td');
        const detail = el('button', 'button-secondary !px-3 !py-2', 'Detalhes');
        detail.type = 'button';
        detail.addEventListener('click', () => showDetails(item));
        action.append(detail);
        row.append(action);
        ['Atualizada em', 'Avaliador', 'Lote', 'Conteúdo', 'Avaliação', 'Ações'].forEach((label, index) => { row.children[index].dataset.label = label; });
        body.append(row);
      });
      table.append(head, body);
      wrap.append(table);

      const pagination = el('div', 'flex flex-col gap-3 border-t border-slate-200 p-4 text-xs text-slate-500 dark:border-white/[.07] sm:flex-row sm:items-center sm:justify-between');
      pagination.append(el('p', '', `${data.total.toLocaleString('pt-BR')} avaliação${data.total === 1 ? '' : 'ões'} · página ${data.page} de ${data.totalPages}`));
      const controls = el('div', 'grid grid-cols-2 gap-2 sm:flex');
      const previous = el('button', 'button-secondary !px-3 !py-2', '← Anterior');
      previous.type = 'button';
      previous.disabled = currentPage <= 1;
      previous.addEventListener('click', () => safeLoad(currentPage - 1));
      const next = el('button', 'button-secondary !px-3 !py-2', 'Próxima →');
      next.type = 'button';
      next.disabled = currentPage >= data.totalPages;
      next.addEventListener('click', () => safeLoad(currentPage + 1));
      controls.append(previous, next);
      pagination.append(controls);
      results.append(wrap, pagination);
    };

    const safeLoad = async (page) => {
      try {
        await load(page);
      } catch (error) {
        clear(results).append(emptyState('Não foi possível carregar a auditoria', error.message));
      }
    };

    filters.addEventListener('submit', async (event) => {
      event.preventDefault();
      await safeLoad(1);
    });
    await safeLoad(1);
  } catch (error) {
    clear(root).append(emptyState('Não foi possível carregar a auditoria', error.message));
  }
}
