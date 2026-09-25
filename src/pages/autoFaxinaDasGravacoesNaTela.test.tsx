/**
 * 🧹 D182 — a auto-faxina do DVR apagava gravações do disco assim que a
 * página de Downloads abria: com o painel de Gravações FECHADO, sem dizer
 * quantas saíram e engolindo a falha de cada exclusão (o `dvr:delete-file`
 * devolve `{ success: false, error }`, não lança — o `catch` vazio não via).
 *
 * Aqui a página é montada de verdade e o main é um `ipcRenderer` falso:
 *   1. abrir a página NÃO pode chamar `dvr:delete-file`;
 *   2. abrir o painel ⏺ varre, e a tela diz quantas saíram e quantas não
 *      saíram — as recusadas pelo main E as que o IPC nem entregou — com o
 *      PRIMEIRO motivo;
 *   3. fechar e reabrir o painel na mesma sessão não varre de novo.
 *
 * Um teste só, em sequência: `sweptThisSession` é estado de MÓDULO (uma
 * varredura por sessão do app), e é justamente a primeira que interessa.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../components/AsyncVideoPlayer', () => ({ default: () => null }));
vi.mock('../components/AgendaPanel', () => ({ AgendaPanel: () => null }));

vi.mock('../services/downloadService', () => ({
    resumoDaSerie: () => ({ total: 0, concluidos: 0, baixando: 0, tamanho: 0 }),
    downloadService: {
        getDownloads: () => [],
        getDownloadsGrouped: () => ({ movies: [], series: [] }),
        getStorageInfo: async () => ({ used: 0, free: 0, total: 0 }),
        ensureProviderMaxConnections: async () => 4,
        getMaxConcurrent: () => 2,
        setMaxConcurrent: () => undefined,
        isNightOnly: () => false,
        setNightOnly: () => undefined,
        isSmartDownloads: () => false,
        setSmartDownloads: () => undefined,
        formatBytes: (n: number) => `${n} B`,
        deleteDownload: async () => undefined,
        deleteSeries: async () => undefined,
        pauseDownload: () => undefined,
        resumeDownload: () => undefined,
        openDownloadsFolder: () => undefined,
        on: () => undefined,
        off: () => undefined,
    },
}));

import { Downloads } from './Downloads';

const DIA = 86_400_000;
const agora = Date.now();
// Caminhos só como rótulo: o main é falso, nada toca o disco.
const gravacao = (nome: string, dias: number) => ({ name: nome, path: `gravacoes/${nome}`, sizeBytes: 10, mtimeMs: agora - dias * DIA, recording: false });
const VELHA_OK = gravacao('velha-ok.ts', 90);
const VELHA_EM_USO = gravacao('velha-em-uso.ts', 80);
const VELHA_SEM_IPC = gravacao('velha-sem-ipc.ts', 70);
const NOVA = gravacao('nova.ts', 1);

let arquivos = [VELHA_OK, VELHA_EM_USO, VELHA_SEM_IPC, NOVA];
const invoke = vi.fn(async (canal: string, dados?: { path?: string }) => {
    if (canal === 'dvr:list-files') return { success: true, files: [...arquivos] };
    if (canal === 'dvr:delete-file') {
        // O main RECUSA sem lançar (é o caminho real do dvrHandlers)...
        if (dados?.path === VELHA_EM_USO.path) return { success: false, error: 'EBUSY: arquivo em uso: Canal $& Cia.ts' };
        // ...e o IPC em si também pode cair (a promessa rejeita).
        if (dados?.path === VELHA_SEM_IPC.path) throw new Error('IPC caiu');
        arquivos = arquivos.filter(f => f.path !== dados?.path);
        return { success: true };
    }
    if (canal === 'dvr:active') return { success: true, recordings: [] };
    return { success: true, files: [], recordings: [] };
});

let container: HTMLDivElement;
let root: Root;

/** Espera a CONDIÇÃO (não um número fixo de voltas): IPC falso + microtasks + efeitos. */
async function esperar(condicao: () => boolean, oque: string) {
    const limite = Date.now() + 4000;
    while (!condicao()) {
        if (Date.now() > limite) throw new Error(`não aconteceu: ${oque}`);
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    }
}

function botaoGravacoes(): HTMLButtonElement | undefined {
    return [...container.querySelectorAll('button')].find(b => (b.textContent || '').includes('⏺')) as HTMLButtonElement | undefined;
}

const contagem = () => botaoGravacoes()?.textContent || '';
const exclusoes = () => invoke.mock.calls.filter(([canal]) => canal === 'dvr:delete-file').map(([, d]) => d?.path);

describe('tela de Downloads: auto-faxina das gravações (D182)', () => {
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        // Faxina LIGADA em 30 dias (ela é opt-in: sem a chave, nada é apagado).
        localStorage.setItem('neostream_dvr_max_age_days', '30');
        arquivos = [VELHA_OK, VELHA_EM_USO, VELHA_SEM_IPC, NOVA];
        invoke.mockClear();
        // Propriedade no window existente — trocar o `window` inteiro quebra o React.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            value: { invoke, on: () => undefined, off: () => undefined, send: () => undefined },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('abrir a página não apaga nada; abrir o painel varre uma vez e diz o que saiu e o que falhou', async () => {
        await act(async () => { root.render(<Downloads />); });

        // A lista FOI lida com o painel fechado (a contagem do botão ⏺ prova —
        // e ela só é gravada DEPOIS do laço de exclusões, se houver um)...
        await esperar(() => /\(\d+\)/.test(contagem()), 'o botão ⏺ mostrar a contagem');
        // ...e nenhuma gravação saiu do disco por isso.
        expect(exclusoes()).toEqual([]);
        expect(arquivos.length).toBe(4);
        expect(contagem().includes('(4)')).toBe(true);

        // Abre o painel de Gravações: agora sim a faxina roda.
        await act(async () => { botaoGravacoes()!.click(); });
        await esperar(() => container.querySelector('[role="status"]') !== null, 'o aviso da auto-faxina aparecer');
        // A contagem só cai DEPOIS da releitura pós-faxina: é o fim do laço inteiro.
        await esperar(() => contagem().includes('(3)'), 'a lista recarregar sem a apagada');

        const aviso = container.querySelector('[role="status"]')!.textContent || '';
        // 1 apagada; 2 que não saíram (uma recusada pelo main, uma que o IPC
        // nem entregou) — com o PRIMEIRO motivo, o que o main deu.
        expect(aviso.includes('1 gravação(ões) com mais de 30 dias apagada(s)')).toBe(true);
        // O motivo vai LITERAL: `$&` num nome de arquivo não pode virar o "{erro}"
        // que o String.replace com texto de substituição colaria no lugar.
        expect(aviso.includes('2 gravação(ões) vencida(s) não saiu(saíram) do disco (EBUSY: arquivo em uso: Canal $& Cia.ts)')).toBe(true);
        expect(aviso.includes('IPC caiu')).toBe(false);

        // Só as vencidas foram candidatas; a nova nunca.
        expect([...exclusoes()].sort()).toEqual([VELHA_EM_USO.path, VELHA_OK.path, VELHA_SEM_IPC.path].sort());

        // Uma varredura por SESSÃO: fechar e reabrir o painel não tenta de novo
        // as que falharam. Cada releitura traz um arquivo novo, então a contagem
        // só muda quando o loadRecordings inteiro (varredura incluída) terminou.
        arquivos = [...arquivos, gravacao('nova-2.ts', 0)];
        await act(async () => { botaoGravacoes()!.click(); });
        await esperar(() => contagem().includes('(4)'), 'a releitura com o painel fechado');
        arquivos = [...arquivos, gravacao('nova-3.ts', 0)];
        await act(async () => { botaoGravacoes()!.click(); });
        await esperar(() => contagem().includes('(5)'), 'a releitura ao reabrir o painel');
        expect(exclusoes().length).toBe(3);
    });
});
