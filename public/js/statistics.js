import { api } from './api.js';
import { clear, el, emptyState, formatDate, skeleton } from './ui.js';

const number = new Intl.NumberFormat('pt-BR');
const percentage = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

function formatPercent(value) {
  return percentage.format(Number(value) || 0);
}

function percentWidth(value) {
  return `${Math.min(100, Math.max(0, (Number(value) || 0) * 100))}%`;
}

function metricCard(label, value, helper) {
  const card = el('article', 'panel p-5');
  card.append(el('p', 'eyebrow', label), el('p', 'mt-3 text-3xl font-extrabold tracking-tight', value), el('p', 'mt-2 text-xs leading-5 text-slate-500', helper));
  return card;
}

function bar(label, count, value, color = 'bg-teal-400') {
  const row = el('div');
  const labels = el('div', 'mb-2 flex items-center justify-between gap-3 text-xs');
  labels.append(el('span', 'min-w-0 truncate font-bold', label), el('span', 'shrink-0 text-slate-500', `${formatPercent(value)} · ${number.format(count)}`));
  const track = el('div', 'h-2 overflow-hidden rounded-full bg-slate-500/10');
  const fill = el('div', `h-full rounded-full ${color}`);
  fill.style.width = percentWidth(value);
  track.append(fill);
  row.append(labels, track);
  return row;
}

function legacyDistribution(results, compact = false) {
  const root = el('div', compact ? 'grid gap-4 sm:grid-cols-2' : 'space-y-4');
  root.append(bar('Hate', results.hate, results.hatePercent, 'bg-rose-400'), bar('Não Hate', results.naoHate, results.naoHatePercent, 'bg-teal-400'));
  return root;
}

function categoryGrid(categories) {
  const root = el('div', 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3');
  categories.forEach((category) => root.append(bar(category.label, category.count, category.percent, 'bg-violet-400')));
  return root;
}

function customFields(fields) {
  const root = el('div', 'space-y-5');
  fields.forEach((field) => {
    const section = el('section', 'rounded-2xl border border-slate-200 p-4 dark:border-white/[.08]');
    const heading = el('div', 'mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between');
    heading.append(
      el('h4', 'text-sm font-extrabold', field.label),
      el('p', 'text-[11px] text-slate-500', `${number.format(field.responseCount)} resposta${field.responseCount === 1 ? '' : 's'} · cobertura ${formatPercent(field.coverage)}`)
    );
    section.append(heading);
    if (field.type === 'texto') {
      section.append(el('p', 'text-xs leading-5 text-slate-500', `${number.format(field.answered)} resposta${field.answered === 1 ? '' : 's'} com texto. O conteúdo livre não é agrupado para preservar a leitura estatística.`));
    } else if (!field.responseCount) {
      section.append(el('p', 'text-xs text-slate-500', 'Ainda não há respostas para este campo.'));
    } else {
      const options = el('div', 'grid gap-3 sm:grid-cols-2');
      field.options.forEach((option) => options.append(bar(option.label, option.count, option.percent, field.type === 'multipla' ? 'bg-violet-400' : 'bg-sky-400')));
      section.append(options);
      if (field.type === 'multipla') section.append(el('p', 'mt-3 text-[11px] leading-5 text-slate-500', 'Campo multirrótulo: as porcentagens podem somar mais de 100%.'));
    }
    root.append(section);
  });
  return root;
}

function lotCard(lot) {
  const card = el('details', 'panel overflow-hidden');
  const summary = el('summary', 'cursor-pointer list-none p-5 transition hover:bg-slate-500/[.03]');
  const top = el('div', 'flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between');
  const identity = el('div', 'min-w-0');
  identity.append(
    el('p', 'truncate text-base font-extrabold', lot.fileName),
    el('p', 'mt-1 text-xs text-slate-500', `${lot.model.name} v${lot.model.version} · ${number.format(lot.totalItems)} itens · ${formatDate(lot.uploadedAt)}`)
  );
  const metrics = el('div', 'grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3');
  const miniMetric = (label, value) => {
    const item = el('div', 'rounded-xl bg-slate-500/[.06] px-3 py-2');
    item.append(el('p', 'text-[10px] font-bold uppercase tracking-wide text-slate-500', label), el('p', 'mt-1 text-sm font-extrabold', value));
    return item;
  };
  metrics.append(miniMetric('Avaliado', formatPercent(lot.progress)));
  if (lot.type === 'hate_v1') {
    metrics.append(miniMetric('Hate', formatPercent(lot.results.hatePercent)), miniMetric('Não Hate', formatPercent(lot.results.naoHatePercent)));
  } else {
    metrics.append(miniMetric('Decisões', number.format(lot.completedReviews)), miniMetric('Perguntas', number.format(lot.results.fields.length)));
  }
  top.append(identity, metrics);
  const track = el('div', 'mt-4 h-2 overflow-hidden rounded-full bg-slate-500/10');
  const fill = el('div', 'h-full rounded-full bg-teal-400');
  fill.style.width = percentWidth(lot.progress);
  track.append(fill);
  summary.append(top, track, el('p', 'mt-3 text-[11px] font-bold text-teal-500', 'Clique para ver a distribuição completa'));
  const body = el('div', 'border-t border-slate-200 p-5 dark:border-white/[.07]');
  if (!lot.completedReviews) {
    body.append(emptyState('Ainda sem avaliações', 'Os percentuais aparecerão assim que a primeira decisão for registrada.'));
  } else if (lot.type === 'hate_v1') {
    body.append(el('h3', 'mb-4 text-sm font-extrabold', 'Hate e Não Hate'), legacyDistribution(lot.results, true));
    body.append(el('h3', 'mb-1 mt-7 text-sm font-extrabold', 'Multirrótulos de Hate'), el('p', 'mb-4 text-[11px] leading-5 text-slate-500', 'Cada percentual usa como base somente as avaliações classificadas como Hate. Como uma avaliação pode ter vários rótulos, a soma pode ultrapassar 100%.'), categoryGrid(lot.results.categories));
  } else {
    body.append(el('p', 'mb-4 text-[11px] leading-5 text-slate-500', 'Em campos condicionais, a cobertura mostra quantas decisões chegaram àquela pergunta. As alternativas usam como base somente quem respondeu ao campo.'), customFields(lot.results.fields));
  }
  card.append(summary, body);
  return card;
}

export async function renderStatistics() {
  const root = document.querySelector('#view-estatisticas');
  clear(root).append(skeleton(5));
  try {
    const data = await api.estatisticas();
    const heading = el('div', 'mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between');
    const title = el('div');
    title.append(
      el('p', 'eyebrow', 'Leitura geral e por CSV'),
      el('h2', 'mt-2 text-2xl font-extrabold tracking-tight', 'Percentuais das avaliações'),
      el('p', 'mt-2 max-w-3xl text-sm leading-6 text-slate-500', 'Acompanhe o avanço de cada arquivo e a distribuição das respostas. Os resultados representam decisões registradas; em avaliação dupla, cada avaliador conta como uma decisão.')
    );
    const filter = el('select', 'form-field w-full lg:w-[360px]');
    const all = el('option', '', 'Todos os CSVs');
    all.value = '';
    filter.append(all);
    data.lots.forEach((lot) => {
      const option = el('option', '', lot.fileName);
      option.value = lot.id;
      filter.append(option);
    });
    heading.append(title, filter);

    const summary = el('div', 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4');
    summary.append(
      metricCard('Progresso geral', formatPercent(data.overall.progress), `${number.format(data.overall.completedReviews)} de ${number.format(data.overall.requiredReviews)} decisões`),
      metricCard('Itens importados', number.format(data.overall.totalItems), `${number.format(data.lots.length)} arquivo${data.lots.length === 1 ? '' : 's'} CSV`),
      metricCard('Hate', formatPercent(data.overall.legacy.hatePercent), `${number.format(data.overall.legacy.hate)} de ${number.format(data.overall.legacy.total)} decisões do modelo de ódio`),
      metricCard('Não Hate', formatPercent(data.overall.legacy.naoHatePercent), `${number.format(data.overall.legacy.naoHate)} de ${number.format(data.overall.legacy.total)} decisões do modelo de ódio`)
    );

    const overall = el('article', 'panel mt-6 p-5');
    overall.append(
      el('h3', 'text-base font-extrabold', 'Distribuição geral do modelo de discurso de ódio'),
      el('p', 'mt-1 text-xs leading-5 text-slate-500', 'Hate e Não Hate usam todas as decisões desse modelo. Os multirrótulos usam somente as decisões Hate.'),
      el('div', 'mt-5')
    );
    overall.lastChild.append(legacyDistribution(data.overall.legacy, true));
    overall.append(el('h4', 'mb-4 mt-7 text-sm font-extrabold', 'Multirrótulos gerais'), categoryGrid(data.overall.legacy.categories));

    const lotsHeading = el('div', 'mb-4 mt-7');
    lotsHeading.append(el('h3', 'text-lg font-extrabold', 'Detalhamento por CSV'), el('p', 'mt-1 text-xs text-slate-500', 'Abra um arquivo para consultar todos os percentuais e contagens.'));
    const lotsRoot = el('div', 'space-y-4');
    const renderLots = () => {
      clear(lotsRoot);
      const visible = filter.value ? data.lots.filter((lot) => String(lot.id) === filter.value) : data.lots;
      visible.forEach((lot) => lotsRoot.append(lotCard(lot)));
      if (!visible.length) lotsRoot.append(emptyState('Nenhum CSV encontrado', 'Selecione outro arquivo.'));
    };
    filter.addEventListener('change', renderLots);
    renderLots();
    clear(root).append(heading, summary, overall, lotsHeading, data.lots.length ? lotsRoot : emptyState('Nenhum CSV importado', 'Importe um lote para começar a acompanhar os percentuais.'));
  } catch (error) {
    clear(root).append(emptyState('Não foi possível carregar as estatísticas', error.message));
  }
}
