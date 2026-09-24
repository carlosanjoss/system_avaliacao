export function el(tag, classes = '', text = '') {
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  if (text !== '') node.textContent = String(text);
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function formatDate(value) {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(normalized));
}

export function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

export function toast(message, type = 'success') {
  const root = document.querySelector('#toast-root');
  const item = el('div', 'toast flex items-start gap-3');
  const icon = el('span', `grid h-8 w-8 shrink-0 place-items-center rounded-xl ${type === 'error' ? 'bg-rose-400/10 text-rose-300' : 'bg-teal-400/10 text-teal-300'}`, type === 'error' ? '!' : '✓');
  const body = el('div');
  body.append(el('p', 'text-sm font-bold', type === 'error' ? 'Algo precisa de atenção' : 'Tudo certo'), el('p', 'mt-1 text-xs leading-5 text-slate-400', message));
  item.append(icon, body);
  root.append(item);
  setTimeout(() => item.remove(), 4500);
}

export function modal({ title, subtitle = '', wide = false }) {
  const backdrop = el('div', 'modal-backdrop');
  const card = el('div', `modal-card${wide ? ' wide' : ''}`);
  const header = el('div', 'mb-6 flex items-start justify-between gap-4');
  const heading = el('div');
  heading.append(el('h2', 'text-lg font-extrabold tracking-tight', title));
  if (subtitle) heading.append(el('p', 'mt-1 text-xs leading-5 text-slate-500', subtitle));
  const close = el('button', 'icon-button shrink-0', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fechar');
  header.append(heading, close);
  const body = el('div');
  card.append(header, body);
  backdrop.append(card);
  document.querySelector('#modal-root').append(backdrop);
  const listeners = [];
  const destroy = () => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    listeners.forEach((listener) => listener());
  };
  close.addEventListener('click', destroy);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) destroy(); });
  return { body, close, destroy, backdrop, onClose: (listener) => listeners.push(listener) };
}

export function emptyState(title, text, action) {
  const box = el('div', 'py-12 text-center');
  box.append(el('div', 'mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-500/10 text-2xl text-slate-500', '◇'), el('h3', 'mt-4 text-sm font-extrabold', title), el('p', 'mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500', text));
  if (action) box.append(action);
  return box;
}

export function skeleton(count = 3) {
  const root = el('div', 'space-y-3');
  for (let i = 0; i < count; i += 1) root.append(el('div', 'skeleton h-20'));
  return root;
}

export function statusPill(status) {
  const labels = { pendente: 'Pendente', em_andamento: 'Em andamento', concluido: 'Concluído' };
  const styles = { pendente: 'bg-amber-400/10 text-amber-500', em_andamento: 'bg-sky-400/10 text-sky-500', concluido: 'bg-teal-400/10 text-teal-500' };
  return el('span', `pill ${styles[status] || styles.pendente}`, labels[status] || status);
}

export function errorMessage(error) {
  if (!error.details) return error.message;
  const pieces = [];
  if (error.details.linhasVazias?.length) pieces.push(`linhas vazias: ${error.details.linhasVazias.join(', ')}`);
  if (error.details.duplicadas?.length) pieces.push(`duplicadas: ${error.details.duplicadas.map((pair) => pair.join('/')).join(', ')}`);
  return `${error.message} ${pieces.join(' · ')}`;
}

export function confirmAction(title, text, confirmLabel = 'Confirmar') {
  return new Promise((resolve) => {
    const dialog = modal({ title, subtitle: text });
    let answered = false;
    const finish = (value) => { if (answered) return; answered = true; resolve(value); };
    dialog.onClose(() => finish(false));
    const actions = el('div', 'flex justify-end gap-3');
    const cancel = el('button', 'button-secondary', 'Cancelar');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { finish(false); dialog.destroy(); });
    const confirm = el('button', 'button-danger', confirmLabel);
    confirm.type = 'button';
    confirm.addEventListener('click', () => { finish(true); dialog.destroy(); });
    actions.append(cancel, confirm);
    dialog.body.append(actions);
  });
}
