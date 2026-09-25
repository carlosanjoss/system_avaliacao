import { api } from './api.js';
import { renderAdmin } from './admin.js';
import { renderAvaliador, setupAvaliador } from './avaliador.js';
import { renderAgreement, setupAgreement } from './agreement.js';
import { renderLogin, renderPasswordChange } from './auth.js';
import { renderExport } from './export.js';
import { renderModelos } from './modelos.js';
import { createRouter } from './router.js';
import { toast } from './ui.js';

const themeKey = 'radar-odio-tema';
let user = null;
let router = null;

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.querySelector('#theme-icon').textContent = theme === 'dark' ? '☼' : '◐';
  localStorage.setItem(themeKey, theme);
}

function updateUserDisplay() {
  document.querySelector('#profile-name').textContent = user.nome;
  document.querySelector('#profile-role').textContent = `${user.papel === 'admin' ? 'Administrador' : 'Avaliador'} · sair`;
  document.querySelector('#profile-avatar').textContent = user.nome.slice(0, 2).toUpperCase();
  document.querySelectorAll('[data-route="admin"], [data-route="modelos"], [data-route="reconciliar"], [data-route="resultados"]').forEach((button) => button.classList.toggle('hidden', user.papel !== 'admin'));
  document.querySelector('[data-route="avaliar"]').classList.toggle('hidden', user.papel !== 'avaliador');
}

async function activate(authenticatedUser) {
  user = authenticatedUser;
  document.querySelector('#login-root').classList.add('hidden');
  document.querySelector('#app-shell').classList.remove('hidden');
  updateUserDisplay();
  setupAvaliador({ getProfile: () => ({ ...user, type: user.papel }) });
  setupAgreement({ getProfile: () => ({ ...user, type: user.papel }) });
  const renderers = {
    admin: () => user.papel === 'admin' ? renderAdmin() : router.navigate('avaliar'),
    modelos: () => user.papel === 'admin' ? renderModelos() : router.navigate('avaliar'),
    avaliar: () => user.papel === 'avaliador' ? renderAvaliador() : router.navigate('admin'),
    reconciliar: () => user.papel === 'admin' ? renderAgreement() : router.navigate('avaliar'),
    resultados: () => user.papel === 'admin' ? renderExport() : router.navigate('avaliar')
  };
  router = createRouter(renderers);
  await router.navigate(user.papel === 'admin' ? 'admin' : 'avaliar');
}

async function initialize() {
  applyTheme(localStorage.getItem(themeKey) || 'dark');
  document.querySelector('#theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'));
  document.querySelector('#profile-button').addEventListener('click', async () => {
    try { await api.auth.logout(); } finally { location.reload(); }
  });
  const sidebar = document.querySelector('#sidebar');
  const backdrop = document.querySelector('#sidebar-backdrop');
  document.querySelector('#menu-button').addEventListener('click', () => { sidebar.classList.remove('-translate-x-full'); backdrop.classList.remove('hidden'); });
  backdrop.addEventListener('click', () => { sidebar.classList.add('-translate-x-full'); backdrop.classList.add('hidden'); });
  window.addEventListener('auth:expired', () => location.reload(), { once: true });

  try {
    await api.health();
    try {
      const result = await api.auth.me();
      if (result.user.senhaTemporaria) renderPasswordChange(result.user, activate);
      else await activate(result.user);
    } catch (error) {
      if (error.status !== 401) throw error;
      renderLogin(activate);
    }
  } catch (error) {
    document.querySelector('#server-status').textContent = 'Servidor indisponível';
    toast(error.message, 'error');
    renderLogin(activate);
  } finally {
    document.querySelector('#loading')?.remove();
  }
}

initialize();
