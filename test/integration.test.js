import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('login, CSV, avaliação dupla, reconciliação e exportação', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'radar-avaliacao-'));
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = join(directory, 'teste.sqlite');
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'Admin@Teste2026';
  const { app } = await import(`../server/server.js?test=${Date.now()}`);
  const { db } = await import('../server/db/db.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api`;

  async function call(path, options = {}, cookie = '') {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) }
    });
    const body = response.status === 204 ? null : await response.json();
    return { response, body };
  }

  async function json(path, options = {}, cookie = '') {
    const result = await call(path, options, cookie);
    assert.ok(result.response.ok, JSON.stringify(result.body));
    return result.body;
  }

  async function login(username, password) {
    const result = await call('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    assert.ok(result.response.ok, JSON.stringify(result.body));
    return { user: result.body.user, cookie: result.response.headers.get('set-cookie').split(';')[0] };
  }

  try {
    const adminSession = await login('admin', 'Admin@Teste2026');
    assert.equal(adminSession.user.papel, 'admin');
    const first = await json('/avaliadores', { method: 'POST', body: JSON.stringify({ nome: 'Ana Lima', email: 'ana@example.org', username: 'ana.lima' }) }, adminSession.cookie);
    const second = await json('/avaliadores', { method: 'POST', body: JSON.stringify({ nome: 'Bruno Luz', email: 'bruno@example.org', username: 'bruno.luz' }) }, adminSession.cookie);
    assert.ok(first.senhaTemporaria && second.senhaTemporaria);
    const firstSession = await login('ana.lima', first.senhaTemporaria);
    const secondSession = await login('bruno.luz', second.senhaTemporaria);
    assert.equal(firstSession.user.senhaTemporaria, true);
    assert.equal(secondSession.user.senhaTemporaria, true);
    const firstChanged = await json('/auth/alterar-senha', { method: 'POST', body: JSON.stringify({ novaSenha: 'Ana@Definitiva2026' }) }, firstSession.cookie);
    const secondChanged = await json('/auth/alterar-senha', { method: 'POST', body: JSON.stringify({ novaSenha: 'Bruno@Definitiva2026' }) }, secondSession.cookie);
    assert.equal(firstChanged.user.senhaTemporaria, false);
    assert.equal(secondChanged.user.senhaTemporaria, false);
    const forbidden = await call('/avaliadores', {}, firstSession.cookie);
    assert.equal(forbidden.response.status, 403);

    const lote = await json('/lotes', {
      method: 'POST',
      body: JSON.stringify({
        nomeArquivo: 'amostra.csv',
        colunaConteudo: 'texto',
        tipoAvaliacao: 'dupla',
        avaliadoresAtribuidos: [first.id, second.id],
        linhas: [
          { linhaIndex: 1, conteudo: 'Conteúdo de teste A', dadosOriginais: { id: '1', texto: 'Conteúdo de teste A' } },
          { linhaIndex: 2, conteudo: 'Conteúdo de teste B', dadosOriginais: { id: '2', texto: 'Conteúdo de teste B' } }
        ]
      })
    }, adminSession.cookie);
    const categories = await json('/avaliacoes/categorias', {}, firstSession.cookie);
    const items = await json(`/lotes/${lote.id}/itens`, {}, adminSession.cookie);
    const etarismo = categories.find((category) => category.nome === 'Etarismo');
    const sexismo = categories.find((category) => category.nome === 'Sexismo');
    assert.ok(etarismo && sexismo);
    await json('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: items.items[0].id, classificacao: 'hate', categorias: [etarismo.id, sexismo.id] }) }, firstSession.cookie);
    await json('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: items.items[0].id, classificacao: 'nao_hate', categorias: [] }) }, secondSession.cookie);
    await json('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: items.items[1].id, classificacao: 'nao_hate', categorias: [] }) }, firstSession.cookie);
    await json('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: items.items[1].id, classificacao: 'nao_hate', categorias: [] }) }, secondSession.cookie);

    const agreement = await json(`/lotes/${lote.id}/concordancia`, {}, adminSession.cookie);
    assert.equal(agreement.metricas.totalPareados, 2);
    assert.equal(agreement.metricas.concordantes, 1);
    assert.equal(agreement.divergencias.length, 1);
    assert.equal(agreement.pendentesReconciliacao, 1);
    const beforeReconciliation = await json('/lotes', {}, adminSession.cookie);
    assert.equal(beforeReconciliation[0].status, 'em_andamento');

    await json(`/reconciliacoes/${items.items[0].id}`, { method: 'POST', body: JSON.stringify({ decisaoFinal: 'hate', categoriasFinais: [categories[7].id] }) }, adminSession.cookie);
    const after = await json(`/lotes/${lote.id}/concordancia`, {}, adminSession.cookie);
    assert.equal(after.pendentesReconciliacao, 0);

    const response = await fetch(`${base}/lotes/${lote.id}/export.csv`, { headers: { Cookie: adminSession.cookie } });
    assert.ok(response.ok);
    const csv = await response.text();
    assert.match(csv, /hate\/no_hate/);
    assert.match(csv, /tipos_hate/);
    assert.match(csv, /avaliador_1_classificacao/);
    assert.match(csv, /decisao_final/);
    assert.match(csv, /Racismo/);
    assert.match(csv, /Etarismo \| Sexismo/);

    const evaluatorLots = await json('/lotes', {}, firstSession.cookie);
    assert.equal(evaluatorLots.length, 1);
    const lots = await json('/lotes', {}, adminSession.cookie);
    assert.equal(lots[0].status, 'concluido');
    assert.equal(lots[0].avaliacoes_feitas, 4);

    const reset = await json(`/avaliadores/${first.id}/resetar-senha`, { method: 'POST' }, adminSession.cookie);
    assert.ok(reset.senhaTemporaria);
    const invalidated = await call('/lotes', {}, firstSession.cookie);
    assert.equal(invalidated.response.status, 401);
    const resetSession = await login('ana.lima', reset.senhaTemporaria);
    assert.equal(resetSession.user.senhaTemporaria, true);
    const changedAgain = await json('/auth/alterar-senha', { method: 'POST', body: JSON.stringify({ novaSenha: 'Ana@NovaSenha2027' }) }, resetSession.cookie);
    assert.equal(changedAgain.user.senhaTemporaria, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
