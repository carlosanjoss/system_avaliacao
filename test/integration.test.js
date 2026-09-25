import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('login, CSV, modelos condicionais, contexto, avaliação dupla, conjunta, reconciliação e exportação', async () => {
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
    const third = await json('/avaliadores', { method: 'POST', body: JSON.stringify({ nome: 'Carla Sol', email: 'carla@example.org', username: 'carla.sol' }) }, adminSession.cookie);
    assert.ok(first.senhaTemporaria && second.senhaTemporaria && third.senhaTemporaria);
    const firstSession = await login('ana.lima', first.senhaTemporaria);
    const secondSession = await login('bruno.luz', second.senhaTemporaria);
    const thirdSession = await login('carla.sol', third.senhaTemporaria);
    assert.equal(firstSession.user.senhaTemporaria, true);
    assert.equal(secondSession.user.senhaTemporaria, true);
    const firstChanged = await json('/auth/alterar-senha', { method: 'POST', body: JSON.stringify({ novaSenha: 'Ana@Definitiva2026' }) }, firstSession.cookie);
    const secondChanged = await json('/auth/alterar-senha', { method: 'POST', body: JSON.stringify({ novaSenha: 'Bruno@Definitiva2026' }) }, secondSession.cookie);
    const thirdChanged = await json('/auth/alterar-senha', { method: 'POST', body: JSON.stringify({ novaSenha: 'Carla@Definitiva2026' }) }, thirdSession.cookie);
    assert.equal(firstChanged.user.senhaTemporaria, false);
    assert.equal(secondChanged.user.senhaTemporaria, false);
    assert.equal(thirdChanged.user.senhaTemporaria, false);
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
    const blindQueue = await json(`/lotes/${lote.id}/pendentes/${second.id}`, {}, secondSession.cookie);
    const blindItem = blindQueue.items.find((item) => item.id === items.items[0].id);
    assert.equal(blindItem.classificacao, null);
    assert.deepEqual(blindItem.categorias, []);
    await json('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: items.items[0].id, classificacao: 'hate', categorias: [categories[7].id] }) }, secondSession.cookie);
    await json('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: items.items[1].id, classificacao: 'nao_hate', categorias: [] }) }, firstSession.cookie);
    await json('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: items.items[1].id, classificacao: 'nao_hate', categorias: [] }) }, secondSession.cookie);

    const agreement = await json(`/lotes/${lote.id}/concordancia`, {}, adminSession.cookie);
    assert.equal(agreement.metricas.totalPareados, 2);
    assert.equal(agreement.metricas.concordantes, 2);
    assert.equal(agreement.divergencias.length, 1);
    assert.equal(agreement.divergencias[0].conflito_classificacao, false);
    assert.equal(agreement.divergencias[0].conflito_categorias, true);
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

    const joint = await json('/lotes', {
      method: 'POST',
      body: JSON.stringify({
        nomeArquivo: 'amostra-grande.csv',
        colunaConteudo: 'texto',
        tipoAvaliacao: 'conjunto',
        avaliadoresAtribuidos: [first.id, second.id, third.id],
        linhas: Array.from({ length: 8 }, (_, index) => ({
          linhaIndex: index + 1,
          conteudo: `Conteúdo distribuído ${index + 1}`,
          dadosOriginais: { id: String(index + 1), texto: `Conteúdo distribuído ${index + 1}` }
        }))
      })
    }, adminSession.cookie);
    assert.equal(joint.distribuicao_conjunta, 1);
    assert.equal(joint.modo_avaliacao, 'conjunto');
    const jointQueues = await Promise.all([
      json(`/lotes/${joint.id}/pendentes/${first.id}`, {}, firstSession.cookie),
      json(`/lotes/${joint.id}/pendentes/${second.id}`, {}, secondSession.cookie),
      json(`/lotes/${joint.id}/pendentes/${third.id}`, {}, thirdSession.cookie)
    ]);
    assert.deepEqual(jointQueues.map((queue) => queue.total), [3, 3, 2]);
    assert.equal(new Set(jointQueues.flatMap((queue) => queue.items.map((item) => item.id))).size, 8);
    const wrongEvaluator = await call('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: jointQueues[1].items[0].id, classificacao: 'nao_hate', categorias: [] }) }, firstSession.cookie);
    assert.equal(wrongEvaluator.response.status, 403);
    for (const [index, queue] of jointQueues.entries()) {
      const session = [firstSession, secondSession, thirdSession][index];
      for (const item of queue.items) {
        await json('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: item.id, classificacao: 'nao_hate', categorias: [] }) }, session.cookie);
      }
    }
    const jointStatus = (await json('/lotes', {}, adminSession.cookie)).find((item) => item.id === joint.id);
    assert.equal(jointStatus.status, 'concluido');
    assert.equal(jointStatus.avaliacoes_feitas, 8);
    assert.equal(jointStatus.progresso, 1);
    const jointExportResponse = await fetch(`${base}/lotes/${joint.id}/export.csv`, { headers: { Cookie: adminSession.cookie } });
    assert.ok(jointExportResponse.ok);
    const jointCsv = await jointExportResponse.text();
    assert.match(jointCsv, /nao_hate/);
    assert.match(jointCsv, new RegExp(String(third.id)));

    const customModel = await json('/modelos-avaliacao', {
      method: 'POST',
      body: JSON.stringify({
        nome: 'Toxicidade contextual',
        descricao: 'Fluxo condicional para testar avaliações personalizadas.',
        campos: [
          { chave: 'toxico', rotulo: 'O conteúdo é tóxico?', tipo: 'booleano', nomeColuna: 'toxico', obrigatorio: true },
          { chave: 'tipo_toxicidade', rotulo: 'Qual é o tipo?', tipo: 'unica', nomeColuna: 'tipo_toxicidade', obrigatorio: true, opcoes: [{ rotulo: 'Discurso de ódio' }, { rotulo: 'Ofensa pessoal' }, { rotulo: 'Ameaça' }], condicao: { campoChave: 'toxico', operador: 'igual', valores: ['sim'] } },
          { chave: 'grupos', rotulo: 'Quais grupos?', tipo: 'multipla', nomeColuna: 'grupos_atingidos', obrigatorio: true, opcoes: [{ rotulo: 'Racismo' }, { rotulo: 'Sexismo' }], condicao: { campoChave: 'tipo_toxicidade', operador: 'igual', valores: ['discurso_de_odio'] } }
        ]
      })
    }, adminSession.cookie);
    assert.equal(customModel.versao, 1);
    assert.equal(customModel.campos[2].condicao.campoChave, 'tipo_toxicidade');

    const customLot = await json('/lotes', {
      method: 'POST',
      body: JSON.stringify({
        nomeArquivo: 'contextual.csv',
        colunaConteudo: 'texto',
        colunasContexto: ['autor', 'publicado_em'],
        modeloAvaliacaoId: customModel.id,
        tipoAvaliacao: 'dupla',
        avaliadoresAtribuidos: [first.id, second.id],
        linhas: [{ linhaIndex: 1, conteudo: 'Mensagem contextual', dadosOriginais: { id: 'c1', texto: 'Mensagem contextual', autor: 'perfil público', publicado_em: '2026-09-24' } }]
      })
    }, adminSession.cookie);
    const firstCustomQueue = await json(`/lotes/${customLot.id}/pendentes/${first.id}`, {}, firstSession.cookie);
    const secondCustomQueue = await json(`/lotes/${customLot.id}/pendentes/${second.id}`, {}, secondSession.cookie);
    assert.deepEqual(firstCustomQueue.items[0].contexto, { autor: 'perfil público', publicado_em: '2026-09-24' });
    assert.equal(firstCustomQueue.modelo.nome, 'Toxicidade contextual');
    await json('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: firstCustomQueue.items[0].id, respostas: { toxico: 'sim', tipo_toxicidade: 'discurso_de_odio', grupos: ['racismo', 'sexismo'] } }) }, firstSession.cookie);
    await json('/avaliacoes', { method: 'POST', body: JSON.stringify({ itemId: secondCustomQueue.items[0].id, respostas: { toxico: 'sim', tipo_toxicidade: 'ofensa_pessoal' } }) }, secondSession.cookie);
    const customAgreement = await json(`/lotes/${customLot.id}/concordancia`, {}, adminSession.cookie);
    assert.equal(customAgreement.divergencias.length, 1);
    assert.equal(customAgreement.pendentesReconciliacao, 1);
    await json(`/reconciliacoes/${firstCustomQueue.items[0].id}`, { method: 'POST', body: JSON.stringify({ respostasFinais: { toxico: 'sim', tipo_toxicidade: 'discurso_de_odio', grupos: ['racismo'] } }) }, adminSession.cookie);
    const customExportResponse = await fetch(`${base}/lotes/${customLot.id}/export.csv`, { headers: { Cookie: adminSession.cookie } });
    assert.ok(customExportResponse.ok);
    const customCsv = await customExportResponse.text();
    assert.match(customCsv, /tipo_toxicidade/);
    assert.match(customCsv, /grupos_atingidos/);
    assert.match(customCsv, /Discurso de ódio/);
    assert.match(customCsv, /perfil público/);
    const versionTwo = await json(`/modelos-avaliacao/${customModel.id}`, { method: 'PUT', body: JSON.stringify({ nome: 'Toxicidade contextual', descricao: 'Versão revisada.', campos: customModel.campos }) }, adminSession.cookie);
    assert.equal(versionTwo.versao, 2);

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
