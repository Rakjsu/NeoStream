/**
 * A tela de Downloads tem que entregar a gravação ao player como ARQUIVO.
 *
 * O botão "assistir" de uma gravação do DVR monta o AsyncVideoPlayer com um
 * `buildStreamUrl` escrito ali na tela — uma linha solta no meio de uma página
 * de 100 kB, que ninguém montava num teste. Se ela passar a devolver o nome do
 * arquivo, um caminho relativo ou uma string vazia, o motor externo recusa
 * (nem http(s) nem arquivo nosso no disco) e a gravação volta a não tocar,
 * sem nenhum teste reclamar.
 *
 * Aqui a página é montada DE VERDADE e o teste clica onde a pessoa clica
 * (⏺ Gravações → assistir). O player é dublado só pra capturar o que a tela
 * entrega a ele — quem prova o resto do caminho (AsyncVideoPlayer →
 * MpvPlayerView → mpv:play) é gravacaoDoDvrChegaAoMpv.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { languageService } from '../services/languageService';

const GRAVACAO_WINDOWS = {
    name: 'Canal 5 - 2026-09-17 21h00.ts',
    path: 'C:\\Users\\rak\\Videos\\NeoStream\\Gravacoes\\Canal 5 - 2026-09-17 21h00.ts',
    sizeBytes: 1024,
    mtimeMs: Date.now(),
    recording: false,
};

/** O que o `dvr:list-files` e o `dvr:thumbnail` do main devolvem neste teste. */
let gravacao: typeof GRAVACAO_WINDOWS = GRAVACAO_WINDOWS;
let miniatura: string | null = null;

/** O que a tela entregou ao player — preenchido pelo dublê. */
let urlEntregueAoPlayer: string | null = null;

vi.mock('../components/AsyncVideoPlayer', () => ({
    default: (props: { buildStreamUrl: (m: unknown) => Promise<string>; movie: unknown }) => {
        void props.buildStreamUrl(props.movie).then(url => { urlEntregueAoPlayer = url; });
        return <div data-testid="player" />;
    },
}));

// A página só precisa da lista de gravações; o resto do serviço de download
// não tem parte nesta história.
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

let container: HTMLDivElement;
let root: Root;

/** Botão pelo texto/título visível — é por onde a pessoa passa. */
function botao(texto: string): HTMLButtonElement {
    const todos = [...container.querySelectorAll('button')];
    const achado = todos.find(b => (b.textContent || '').includes(texto) || b.title === texto);
    if (!achado) throw new Error(`botão "${texto}" não está na tela`);
    return achado as HTMLButtonElement;
}

async function clicar(alvo: HTMLButtonElement) {
    await act(async () => { alvo.click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
}

/** Espera por CONDICAO (com teto), nao por contagem de microtasks. */
async function esperarAte(condicao: () => boolean, oQue: string) {
    for (let i = 0; i < 50 && !condicao(); i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    }
    if (!condicao()) throw new Error(`esperei demais: ${oQue}`);
}

describe('a tela de Downloads entrega a gravacao ao player', () => {
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        localStorage.clear();
        urlEntregueAoPlayer = null;
        gravacao = GRAVACAO_WINDOWS;
        miniatura = null;
        // Propriedade no window existente — trocar o `window` inteiro quebra o
        // React (e é o que o mockIpc do castQueue faz; aqui não serve).
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            value: {
                invoke: async (canal: string) => {
                    if (canal === 'dvr:list-files') return { success: true, files: [gravacao] };
                    if (canal === 'dvr:thumbnail') return miniatura ? { success: true, path: miniatura } : { success: false };
                    if (canal === 'dvr:active') return { success: true, recordings: [] };
                    return { success: true };
                },
                on: () => undefined,
                off: () => undefined,
                send: () => undefined,
            },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    it('o botao assistir manda o file:/// do arquivo gravado', async () => {
        await act(async () => { root.render(<Downloads />); });
        await act(async () => { await Promise.resolve(); });

        await clicar(botao(languageService.t('downloads', 'recordings')));
        await clicar(botao(languageService.t('liveTV', 'watchNow')));

        expect(container.querySelector('[data-testid="player"]'), 'o player nem abriu').not.toBeNull();
        expect(urlEntregueAoPlayer).toBe(
            'file:///C:/Users/rak/Videos/NeoStream/Gravacoes/Canal 5 - 2026-09-17 21h00.ts');
    });

    it('no Linux e no macOS a URL sai com tres barras, nao quatro', async () => {
        // Fora do Windows o caminho que o main devolve JA comeca com `/`. A
        // tela montava `file:///${caminho}` e saia `file:////home/...`: o
        // Chromium engole a barra a mais, a guarda do mpv le UNC e recusa --
        // a gravacao do DVR nao tocava no MPV fora do Windows. Strings puras:
        // o caso vale igual no Windows e no ubuntu-latest da CI.
        gravacao = {
            ...GRAVACAO_WINDOWS,
            path: '/home/rak/Vídeos/NeoStream/Gravacoes/Canal 5 - 2026-09-17 21h00.ts',
        };
        miniatura = '/home/rak/.config/NeoStream/dvr-thumbs/Canal 5.jpg';

        await act(async () => { root.render(<Downloads />); });
        await clicar(botao(languageService.t('downloads', 'recordings')));
        await esperarAte(() => container.querySelector('img[src^="file:"]') !== null, 'a miniatura da gravacao');

        // A miniatura sai da MESMA montagem: o <img> tambem e desta tela.
        expect(container.querySelector('img[src^="file:"]')?.getAttribute('src'))
            .toBe('file:///home/rak/.config/NeoStream/dvr-thumbs/Canal 5.jpg');

        await clicar(botao(languageService.t('liveTV', 'watchNow')));
        await esperarAte(() => urlEntregueAoPlayer !== null, 'a URL entregue ao player');
        expect(urlEntregueAoPlayer).toBe('file:///home/rak/Vídeos/NeoStream/Gravacoes/Canal 5 - 2026-09-17 21h00.ts');
    });
});
