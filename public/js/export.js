import { api } from './api.js';
import { clear, el, emptyState, skeleton } from './ui.js';

export async function renderExport() {
  const root = document.querySelector('#view-resultados');
  clear(root).append(skeleton(4));
  try {
    const lotes = await api.lotes.list();
    const heading = el('div', 'mb-6');
    heading.append(el('p', 'eyebrow', 'Dados consolidados'), el('h2', 'mt-2 text-2xl font-extrabold tracking-tight', 'Exportação por lote'), el('p', 'mt-2 max-w-2xl text-sm leading-6 text-slate-500', 'Cada CSV preserva as colunas originais e acrescenta as colunas definidas no modelo, respostas individuais, concordância, decisão final e métricas do lote.'));
    const panel = el('article', 'panel overflow-hidden');
    if (!lotes.length) panel.append(emptyState('Nada para exportar', 'Importe um lote para disponibilizar o CSV consolidado.'));
    else {
      const list = el('div', 'divide-y divide-slate-200 dark:divide-white/[.07]');
      lotes.forEach((lote) => {
        const row = el('div', 'flex flex-col gap-4 p-5 sm:flex-row sm:items-center');
        const info = el('div', 'min-w-0 flex-1');
        const mode = lote.distribuicao_conjunta ? 'modo conjunto' : lote.tipo_avaliacao === 'dupla' ? 'modo dupla cega' : 'modo individual';
        info.append(el('p', 'truncate text-sm font-extrabold', lote.nome_arquivo), el('p', 'mt-1 text-xs text-slate-500', `${lote.avaliacoes_feitas} avaliações · ${mode} · ${lote.modelo_nome || 'Modelo padrão'} v${lote.modelo_versao || 1}`));
        const download = el('a', 'button-primary', '↓ Baixar CSV');
        download.href = api.lotes.exportUrl(lote.id);
        info.dataset.lote = lote.id;
        row.append(info, download);
        list.append(row);
      });
      panel.append(list);
    }
    clear(root).append(heading, panel, (() => {
      const note = el('div', 'mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[.05] p-4 text-xs leading-5 text-slate-500');
      note.append(el('strong', 'text-amber-500', 'Nota de segurança: '), document.createTextNode('campos iniciados por =, +, - ou @ recebem prefixo seguro para evitar execução de fórmulas ao abrir o arquivo em planilhas.'));
      return note;
    })());
  } catch (error) {
    clear(root).append(emptyState('Não foi possível preparar as exportações', error.message));
  }
}
