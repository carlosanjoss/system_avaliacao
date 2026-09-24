import { api } from './api.js';
import { clear, el, emptyState, percent, skeleton, statusPill, toast } from './ui.js';

let context;
let session = null;
let categories = [];
let keyboardBound = false;

export function setupAvaliador(value) {
  context = value;
  if (!keyboardBound) {
    keyboardBound = true;
    document.addEventListener('keydown', handleKeyboard);
  }
}

function handleKeyboard(event) {
  if (!session || document.querySelector('#view-avaliar').classList.contains('hidden')) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if (event.key === '1' && !event.altKey) selectClassification('hate');
  if (event.key === '2' && !event.altKey) selectClassification('nao_hate');
  if (event.altKey && /^[0-9]$/.test(event.key)) {
    const index = event.key === '0' ? 9 : Number(event.key) - 1;
    toggleCategory(categories[index]?.id);
  }
  if (event.key === 'Enter') document.querySelector('#save-review')?.click();
  if (event.key === 'ArrowLeft') document.querySelector('#previous-item')?.click();
  if (event.key === 'ArrowRight') document.querySelector('#next-item')?.click();
}

function selectClassification(value) {
  if (!session) return;
  cancelAutoSave();
  session.classification = value;
  if (value === 'nao_hate') session.selectedCategories.clear();
  updateSelections();
  if (value === 'nao_hate') scheduleAutoSave(0);
}

function toggleCategory(id) {
  if (!session || session.saving || !id || session.classification !== 'hate') return;
  if (session.selectedCategories.has(id)) session.selectedCategories.delete(id);
  else session.selectedCategories.add(id);
  updateSelections();
}

function cancelAutoSave() {
  if (!session?.autoSaveTimer) return;
  clearTimeout(session.autoSaveTimer);
  session.autoSaveTimer = null;
}

function scheduleAutoSave(delay) {
  if (!session || session.saving) return;
  cancelAutoSave();
  session.autoSaveTimer = setTimeout(() => {
    if (session) session.autoSaveTimer = null;
    saveReview();
  }, delay);
}

function updateSelections() {
  document.querySelectorAll('[data-classification]').forEach((button) => {
    const selected = button.dataset.classification === session.classification;
    button.classList.toggle('selected-hate', selected && session.classification === 'hate');
    button.classList.toggle('selected-safe', selected && session.classification === 'nao_hate');
  });
  const categoryArea = document.querySelector('#category-area');
  categoryArea?.classList.toggle('hidden', session.classification !== 'hate');
  document.querySelectorAll('[data-category]').forEach((button) => button.classList.toggle('selected', session.selectedCategories.has(Number(button.dataset.category))));
  const categorySummary = document.querySelector('#category-summary');
  if (categorySummary) {
    const total = session.selectedCategories.size;
    categorySummary.textContent = `${total} ${total === 1 ? 'categoria selecionada' : 'categorias selecionadas'}`;
  }
  const saveButton = document.querySelector('#save-review');
  if (saveButton && !session.saving) {
    const item = session.queue.items[session.index];
    if (session.classification === 'hate') {
      saveButton.textContent = item.avaliacao_id ? 'Atualizar categorias e avançar' : 'Salvar categorias e avançar';
    } else {
      saveButton.textContent = item.avaliacao_id ? 'Atualizar e avançar' : 'Salvar e avançar';
    }
  }
}

async function openQueue(lote, review = false) {
  const profile = context.getProfile();
  clear(document.querySelector('#view-avaliar')).append(skeleton(4));
  try {
    categories = categories.length ? categories : await api.categorias();
    const queue = await api.lotes.queue(lote.id, profile.id, review);
    if (!queue.items.length) {
      session = null;
      await renderAvaliador();
      toast(review ? 'Não há avaliações para revisar.' : 'Este lote não possui itens pendentes.');
      return;
    }
    session = { lote, profile, review, queue, index: 0, classification: null, selectedCategories: new Set(), saving: false, autoSaveTimer: null };
    renderAnnotationShell();
    loadCurrentItem();
  } catch (error) {
    session = null;
    toast(error.message, 'error');
    await renderAvaliador();
  }
}

function renderAnnotationShell() {
  const root = document.querySelector('#view-avaliar');
  const top = el('div', 'mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between');
  const info = el('div');
  info.append(el('p', 'eyebrow', session.review ? 'Modo revisão' : 'Anotação em andamento'), el('h2', 'mt-2 text-xl font-extrabold tracking-tight', session.lote.nome_arquivo));
  const exit = el('button', 'button-secondary', '← Voltar aos lotes');
  exit.addEventListener('click', () => { cancelAutoSave(); session = null; renderAvaliador(); });
  top.append(info, exit);

  const card = el('article', 'panel mx-auto max-w-5xl overflow-hidden');
  const progressHeader = el('div', 'border-b border-slate-200 px-5 py-4 dark:border-white/[.07] sm:px-7');
  const progressLabels = el('div', 'mb-3 flex items-center justify-between text-xs');
  progressLabels.append(el('span', 'font-extrabold', 'Progresso no lote'), el('span', 'text-slate-500', `${session.queue.avaliados} de ${session.queue.total} avaliados`));
  const track = el('div', 'progress-track');
  const bar = el('div', 'progress-bar');
  bar.style.width = percent(session.queue.avaliados / session.queue.total);
  track.append(bar);
  progressHeader.append(progressLabels, track);

  const body = el('div', 'p-5 sm:p-8');
  const position = el('div', 'mb-6 flex items-center justify-between');
  position.append(el('span', 'pill bg-slate-500/10 text-slate-500', ''), el('span', 'text-[11px] font-bold text-slate-500', '2 Não Hate avança automaticamente · Enter salva Hate'));
  position.firstChild.id = 'item-position';
  const content = el('p', 'min-h-[150px] whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-500/[.025] p-5 text-lg font-semibold leading-8 dark:border-white/[.08] sm:p-7 sm:text-xl');
  content.id = 'review-content';
  const prompt = el('p', 'mb-3 mt-7 text-xs font-extrabold uppercase tracking-[.12em] text-slate-500', 'Este conteúdo apresenta discurso de ódio?');
  const choices = el('div', 'flex flex-col gap-3 sm:flex-row');
  const hate = el('button', 'classification-card');
  hate.type = 'button';
  hate.dataset.classification = 'hate';
  hate.append(el('span', 'block text-sm font-extrabold text-rose-500', 'Hate'), el('span', 'mt-1 block text-xs leading-5 text-slate-500', 'Ataque direcionado a uma pessoa ou grupo protegido'));
  const safe = el('button', 'classification-card');
  safe.type = 'button';
  safe.dataset.classification = 'nao_hate';
  safe.append(el('span', 'block text-sm font-extrabold text-teal-500', 'Não Hate'), el('span', 'mt-1 block text-xs leading-5 text-slate-500', 'Não atende aos critérios de discurso de ódio'));
  hate.addEventListener('click', () => selectClassification('hate'));
  safe.addEventListener('click', () => selectClassification('nao_hate'));
  choices.append(hate, safe);

  const categoryArea = el('div', 'mt-7 hidden');
  categoryArea.id = 'category-area';
  const categoryHeader = el('div', 'mb-3 flex flex-wrap items-center justify-between gap-2');
  categoryHeader.append(
    el('p', 'text-xs font-extrabold uppercase tracking-[.12em] text-slate-500', 'Selecione uma ou mais categorias'),
    el('span', 'pill bg-teal-500/10 text-teal-500', '0 categorias selecionadas')
  );
  categoryHeader.lastChild.id = 'category-summary';
  categoryArea.append(categoryHeader);
  const categoryGrid = el('div', 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3');
  categories.forEach((category, index) => {
    const button = el('button', 'category-chip');
    button.type = 'button';
    button.dataset.category = category.id;
    button.append(el('span', 'mr-2 text-slate-500', `Alt+${index === 9 ? 0 : index + 1}`), document.createTextNode(category.nome));
    button.addEventListener('click', () => toggleCategory(category.id));
    categoryGrid.append(button);
  });
  categoryArea.append(categoryGrid);

  const actions = el('div', 'mt-8 flex flex-col gap-3 border-t border-slate-200 pt-6 dark:border-white/[.07] sm:flex-row sm:items-center');
  const previous = el('button', 'button-secondary', '← Anterior');
  previous.id = 'previous-item';
  previous.type = 'button';
  previous.addEventListener('click', () => move(-1));
  const next = el('button', 'button-secondary', 'Próximo →');
  next.id = 'next-item';
  next.type = 'button';
  next.addEventListener('click', () => move(1));
  const save = el('button', 'button-primary sm:ml-auto', 'Salvar e avançar');
  save.id = 'save-review';
  save.type = 'button';
  save.addEventListener('click', saveReview);
  actions.append(previous, next, save);
  body.append(position, content, prompt, choices, categoryArea, actions);
  card.append(progressHeader, body);
  clear(root).append(top, card);
}

function loadCurrentItem() {
  cancelAutoSave();
  const item = session.queue.items[session.index];
  session.classification = item.classificacao || null;
  session.selectedCategories = new Set(item.categorias || []);
  document.querySelector('#review-content').textContent = item.conteudo;
  document.querySelector('#item-position').textContent = `Linha ${item.linha_index} · ${session.index + 1}/${session.queue.items.length}`;
  document.querySelector('#previous-item').disabled = session.index === 0;
  document.querySelector('#next-item').disabled = session.index === session.queue.items.length - 1;
  document.querySelector('#save-review').textContent = item.avaliacao_id ? 'Atualizar e avançar' : 'Salvar e avançar';
  updateSelections();
}

function move(direction) {
  const next = session.index + direction;
  if (next < 0 || next >= session.queue.items.length) return;
  session.index = next;
  loadCurrentItem();
}

async function saveReview() {
  if (!session || session.saving) return;
  const item = session.queue.items[session.index];
  if (!session.classification) return toast('Escolha Hate ou Não Hate.', 'error');
  if (session.classification === 'hate' && !session.selectedCategories.size) return toast('Selecione ao menos uma categoria.', 'error');
  cancelAutoSave();
  session.saving = true;
  const button = document.querySelector('#save-review');
  button.disabled = true;
  button.textContent = 'Salvando…';
  document.querySelectorAll('[data-classification], [data-category]').forEach((control) => { control.disabled = true; });
  try {
    await api.avaliar({ itemId: item.id, avaliadorId: session.profile.id, classificacao: session.classification, categorias: [...session.selectedCategories] });
    session.saving = false;
    if (!item.avaliacao_id) session.queue.avaliados += 1;
    if (!session.review) {
      session.queue.items.splice(session.index, 1);
      if (session.index >= session.queue.items.length) session.index = Math.max(0, session.queue.items.length - 1);
    } else {
      item.avaliacao_id = item.avaliacao_id || true;
      item.classificacao = session.classification;
      item.categorias = [...session.selectedCategories];
      session.index = Math.min(session.index + 1, session.queue.items.length - 1);
    }
    toast('Avaliação registrada.');
    if (!session.queue.items.length) {
      const remaining = await api.lotes.queue(session.lote.id, session.profile.id, false);
      if (remaining.items.length) {
        session.queue = remaining;
        session.index = 0;
        renderAnnotationShell();
        loadCurrentItem();
      } else {
        session = null;
        await renderAvaliador();
        toast('Lote concluído. Excelente trabalho!');
      }
      return;
    }
    renderAnnotationShell();
    loadCurrentItem();
  } catch (error) {
    session.saving = false;
    toast(error.message, 'error');
    button.disabled = false;
    button.textContent = 'Salvar e avançar';
    document.querySelectorAll('[data-classification], [data-category]').forEach((control) => { control.disabled = false; });
  }
}

function batchCard(lote, profile) {
  const card = el('article', 'panel p-5');
  const top = el('div', 'flex items-start justify-between gap-4');
  const title = el('div', 'min-w-0');
  title.append(el('p', 'truncate text-sm font-extrabold', lote.nome_arquivo), el('p', 'mt-1 text-xs text-slate-500', `${lote.total_itens} itens · ${lote.tipo_avaliacao === 'dupla' ? 'avaliação dupla' : 'avaliação individual'}`));
  top.append(title, statusPill(lote.status));
  const assignmentCount = Number(lote.total_avaliadores);
  const ownDone = Math.min(Number(lote.total_itens), Math.round(Number(lote.avaliacoes_feitas) / assignmentCount));
  const track = el('div', 'progress-track mt-5');
  const bar = el('div', 'progress-bar');
  bar.style.width = percent(ownDone / Number(lote.total_itens));
  track.append(bar);
  const footer = el('div', 'mt-4 flex flex-wrap items-center gap-2');
  footer.append(el('span', 'mr-auto text-xs font-bold text-slate-500', `${ownDone}/${lote.total_itens} estimados`));
  const review = el('button', 'button-secondary !px-3 !py-2', 'Revisar');
  review.addEventListener('click', () => openQueue(lote, true));
  const start = el('button', 'button-primary !px-3 !py-2', lote.status === 'concluido' ? 'Abrir' : 'Continuar');
  start.addEventListener('click', () => openQueue(lote, false));
  footer.append(review, start);
  card.append(top, track, footer);
  return card;
}

export async function renderAvaliador() {
  if (session) return;
  const root = document.querySelector('#view-avaliar');
  clear(root).append(skeleton(4));
  const profile = context.getProfile();
  if (!profile || profile.type !== 'avaliador') {
    const switchButton = el('button', 'button-primary mt-5', 'Selecionar perfil de avaliador');
    switchButton.addEventListener('click', context.selectProfile);
    clear(root).append(emptyState('Escolha quem vai avaliar', 'Selecione um perfil para visualizar apenas os lotes atribuídos a ele.', switchButton));
    return;
  }
  try {
    const lotes = await api.lotes.list();
    const assigned = lotes.filter((lote) => String(lote.avaliadores_ids || '').split(',').map(Number).includes(profile.id));
    const heading = el('div', 'mb-6');
    heading.append(el('p', 'eyebrow', 'Fila de trabalho'), el('h2', 'mt-2 text-2xl font-extrabold tracking-tight', `Olá, ${profile.nome.split(' ')[0]}`), el('p', 'mt-2 text-sm text-slate-500', 'Escolha um lote para continuar sua avaliação. Você pode revisar respostas já salvas.'));
    const grid = el('div', 'grid gap-4 lg:grid-cols-2');
    assigned.forEach((lote) => grid.append(batchCard(lote, profile)));
    clear(root).append(heading, assigned.length ? grid : emptyState('Nenhum lote atribuído', 'Quando o administrador atribuir um lote a este perfil, ele aparecerá aqui.'));
  } catch (error) {
    clear(root).append(emptyState('Não foi possível carregar a fila', error.message));
  }
}
