const base = '/api';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('auth:expired'));
    const error = new Error(payload.erro || 'Não foi possível concluir a operação.');
    error.details = payload.detalhes;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const api = {
  health: () => request('/health'),
  auth: {
    login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    me: () => request('/auth/me'),
    changePassword: (novaSenha) => request('/auth/alterar-senha', { method: 'POST', body: JSON.stringify({ novaSenha }) }),
    logout: () => request('/auth/logout', { method: 'POST' })
  },
  avaliadores: {
    list: () => request('/avaliadores'),
    create: (data) => request('/avaliadores', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/avaliadores/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    resetPassword: (id) => request(`/avaliadores/${id}/resetar-senha`, { method: 'POST' }),
    remove: (id) => request(`/avaliadores/${id}`, { method: 'DELETE' })
  },
  lotes: {
    list: () => request('/lotes'),
    create: (data) => request('/lotes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/lotes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id) => request(`/lotes/${id}`, { method: 'DELETE' }),
    items: (id, page = 1) => request(`/lotes/${id}/itens?page=${page}`),
    queue: (id, avaliadorId, todos = false, page = 1) => request(`/lotes/${id}/pendentes/${avaliadorId}?todos=${todos ? 1 : 0}&page=${page}`),
    agreement: (id) => request(`/lotes/${id}/concordancia`),
    exportUrl: (id) => `${base}/lotes/${id}/export.csv`
  },
  categorias: () => request('/avaliacoes/categorias'),
  avaliar: (data) => request('/avaliacoes', { method: 'POST', body: JSON.stringify(data) }),
  reconciliar: (itemId, data) => request(`/reconciliacoes/${itemId}`, { method: 'POST', body: JSON.stringify(data) })
};
