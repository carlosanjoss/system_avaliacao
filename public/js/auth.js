import { api } from './api.js';
import { clear, el } from './ui.js';

export function renderLogin(onAuthenticated) {
  const root = document.querySelector('#login-root');
  document.querySelector('#app-shell').classList.add('hidden');
  root.classList.remove('hidden');
  const shell = el('main', 'login-shell');
  const hero = el('section', 'login-hero text-white');
  const brand = el('div', 'relative z-10');
  brand.append(el('div', 'mb-8 grid h-14 w-14 place-items-center rounded-2xl bg-teal-400 text-xl font-extrabold text-slate-950 shadow-2xl shadow-teal-400/20', 'RO'), el('p', 'eyebrow !text-teal-300', 'RADAR ÓDIO · AVALIAÇÃO POR CSV'), el('h1', 'mt-5 max-w-2xl text-4xl font-extrabold leading-tight tracking-[-.04em] sm:text-5xl', 'Revisão humana, decisão por decisão.'), el('p', 'mt-5 max-w-xl text-sm leading-7 text-slate-400 sm:text-base', 'Importe seus conjuntos de dados, distribua as avaliações e gere CSVs consolidados com rastreabilidade individual.'));
  const points = el('div', 'relative z-10 mt-10 grid gap-3 text-sm text-slate-300 sm:grid-cols-3');
  ['Login individual', 'Hate multirrótulo', 'CSV consolidado'].forEach((text, index) => {
    const point = el('div', 'rounded-2xl border border-white/10 bg-white/[.035] p-4');
    point.append(el('span', 'mb-3 grid h-8 w-8 place-items-center rounded-xl bg-teal-400/10 font-bold text-teal-300', index + 1), el('span', 'font-bold', text));
    points.append(point);
  });
  hero.append(brand, points);

  const panel = el('section', 'login-panel');
  const card = el('div', 'login-card');
  card.append(el('p', 'eyebrow', 'ACESSO SEGURO'), el('h2', 'mt-3 text-2xl font-extrabold tracking-tight', 'Entre no sistema'), el('p', 'mt-2 text-sm leading-6 text-slate-500', 'Administradores e avaliadores usam suas próprias credenciais.'));
  const form = el('form', 'mt-7 space-y-4');
  const usernameWrap = el('label');
  usernameWrap.append(el('span', 'field-label', 'Usuário'), el('input', 'form-field'));
  const username = usernameWrap.querySelector('input');
  username.name = 'username';
  username.autocomplete = 'username';
  username.placeholder = 'Ex.: ana.silva';
  username.required = true;
  const passwordWrap = el('label');
  passwordWrap.append(el('span', 'field-label', 'Senha'), el('input', 'form-field'));
  const password = passwordWrap.querySelector('input');
  password.type = 'password';
  password.name = 'password';
  password.autocomplete = 'current-password';
  password.placeholder = 'Digite sua senha';
  password.required = true;
  const error = el('div', 'hidden rounded-xl border border-rose-400/20 bg-rose-400/[.07] p-3 text-xs font-semibold text-rose-500');
  error.setAttribute('role', 'alert');
  const submit = el('button', 'button-primary mt-2 w-full !py-3', 'Entrar');
  submit.type = 'submit';
  form.append(usernameWrap, passwordWrap, error, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.classList.add('hidden');
    submit.disabled = true;
    submit.textContent = 'Entrando…';
    try {
      const result = await api.auth.login(username.value.trim().toLowerCase(), password.value);
      if (result.user.senhaTemporaria) renderPasswordChange(result.user, onAuthenticated);
      else await onAuthenticated(result.user);
    } catch (cause) {
      error.textContent = cause.message;
      error.classList.remove('hidden');
      submit.disabled = false;
      submit.textContent = 'Entrar';
    }
  });
  card.append(form, el('p', 'mt-5 text-center text-[11px] leading-5 text-slate-500', 'Cada avaliação fica vinculada à conta autenticada.'));
  panel.append(card);
  shell.append(hero, panel);
  clear(root).append(shell);
  setTimeout(() => username.focus(), 50);
}

export function renderPasswordChange(user, onAuthenticated) {
  const root = document.querySelector('#login-root');
  document.querySelector('#app-shell').classList.add('hidden');
  root.classList.remove('hidden');
  const shell = el('main', 'login-shell');
  const hero = el('section', 'login-hero text-white');
  const content = el('div', 'relative z-10 max-w-2xl');
  content.append(
    el('div', 'mb-8 grid h-14 w-14 place-items-center rounded-2xl bg-teal-400 text-xl font-extrabold text-slate-950 shadow-2xl shadow-teal-400/20', 'RO'),
    el('p', 'eyebrow !text-teal-300', 'PRIMEIRO ACESSO'),
    el('h1', 'mt-5 text-4xl font-extrabold leading-tight tracking-[-.04em] sm:text-5xl', 'Sua conta, sua senha.'),
    el('p', 'mt-5 max-w-xl text-sm leading-7 text-slate-400 sm:text-base', 'A senha fornecida pelo administrador é temporária. Crie uma senha pessoal antes de iniciar as avaliações.')
  );
  hero.append(content);

  const panel = el('section', 'login-panel');
  const card = el('div', 'login-card');
  card.append(
    el('p', 'eyebrow', 'TROCA OBRIGATÓRIA'),
    el('h2', 'mt-3 text-2xl font-extrabold tracking-tight', `Olá, ${user.nome.split(' ')[0]}`),
    el('p', 'mt-2 text-sm leading-6 text-slate-500', 'Defina uma senha definitiva para liberar seu painel de avaliação.')
  );
  const form = el('form', 'mt-7 space-y-4');
  const passwordWrap = el('label');
  passwordWrap.append(el('span', 'field-label', 'Nova senha'), el('input', 'form-field'));
  const password = passwordWrap.querySelector('input');
  password.type = 'password';
  password.autocomplete = 'new-password';
  password.required = true;
  password.placeholder = 'Crie uma senha forte';
  const confirmationWrap = el('label');
  confirmationWrap.append(el('span', 'field-label', 'Confirmar nova senha'), el('input', 'form-field'));
  const confirmation = confirmationWrap.querySelector('input');
  confirmation.type = 'password';
  confirmation.autocomplete = 'new-password';
  confirmation.required = true;
  confirmation.placeholder = 'Digite novamente';
  const rules = el('p', 'rounded-xl border border-slate-200 bg-slate-500/[.035] p-3 text-[11px] leading-5 text-slate-500 dark:border-white/[.08]', 'Use pelo menos 10 caracteres, com letra maiúscula, minúscula, número e caractere especial.');
  const error = el('div', 'hidden rounded-xl border border-rose-400/20 bg-rose-400/[.07] p-3 text-xs font-semibold text-rose-500');
  error.setAttribute('role', 'alert');
  const submit = el('button', 'button-primary mt-2 w-full !py-3', 'Criar minha senha');
  submit.type = 'submit';
  form.append(passwordWrap, confirmationWrap, rules, error, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.classList.add('hidden');
    if (password.value !== confirmation.value) {
      error.textContent = 'As senhas não coincidem.';
      error.classList.remove('hidden');
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Salvando…';
    try {
      const result = await api.auth.changePassword(password.value);
      await onAuthenticated(result.user);
    } catch (cause) {
      error.textContent = cause.message;
      error.classList.remove('hidden');
      submit.disabled = false;
      submit.textContent = 'Criar minha senha';
    }
  });
  card.append(form);
  panel.append(card);
  shell.append(hero, panel);
  clear(root).append(shell);
  setTimeout(() => password.focus(), 50);
}
