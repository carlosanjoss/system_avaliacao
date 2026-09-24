const metadata = {
  admin: ['Visão geral', 'Acompanhe lotes e equipe em um só lugar'],
  avaliar: ['Espaço de avaliação', 'Classifique conteúdos com foco e agilidade'],
  reconciliar: ['Reconciliação', 'Resolva divergências entre avaliações em dupla'],
  resultados: ['Resultados', 'Exporte dados consolidados e métricas de concordância']
};

export function createRouter(renderers) {
  let current = location.hash.replace('#/', '') || 'admin';

  async function navigate(route) {
    if (!renderers[route]) route = 'admin';
    current = route;
    if (location.hash !== `#/${route}`) history.replaceState(null, '', `#/${route}`);
    document.querySelectorAll('[data-view]').forEach((view) => view.classList.toggle('hidden', view.id !== `view-${route}`));
    document.querySelectorAll('[data-route]').forEach((button) => button.classList.toggle('active', button.dataset.route === route));
    document.querySelector('#page-title').textContent = metadata[route][0];
    document.querySelector('#page-subtitle').textContent = metadata[route][1];
    await renderers[route]();
  }

  document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => {
    navigate(button.dataset.route);
    document.querySelector('#sidebar').classList.add('-translate-x-full');
    document.querySelector('#sidebar-backdrop').classList.add('hidden');
  }));
  window.addEventListener('hashchange', () => navigate(location.hash.replace('#/', '') || 'admin'));
  return { start: () => navigate(current), navigate, current: () => current };
}
