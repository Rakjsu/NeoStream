/**
 * ⏸ D179 — o botão de pausa do card tem que chegar ao
 * `downloadService.pauseDownload`.
 *
 * É por ele que a pausa vira pausa de verdade: o serviço só mostra ⏸ quando o
 * main pausou algo (pausaSemEfeitoNaoMostraPausado.test.ts) e o main derruba
 * as conexões e fecha os arquivos (electron/pausarDownloadParaDeVerdade.test.ts).
 * Este teste prende a ponta que sobra — o clique na tela — com a página
 * montada de verdade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const h = vi.hoisted(() => ({
    pauseDownload: vi.fn<(id: string) => Promise<void>>(async () => undefined),
}));

const BAIXANDO = {
    id: 'movie_filme_d179_1',
    name: 'Filme D179',
    type: 'movie' as const,
    url: 'http://x/filme.mp4',
    cover: '',
    size: 4096,
    downloadedBytes: 2048,
    status: 'downloading' as const,
    progress: 50,
    createdAt: 1,
};

vi.mock('../components/AsyncVideoPlayer', () => ({ default: () => null }));

vi.mock('../services/downloadService', () => ({
    resumoDaSerie: () => ({ total: 0, concluidos: 0, baixando: 0, tamanho: 0 }),
    downloadService: {
        getDownloads: () => [BAIXANDO],
        getDownloadsGrouped: () => ({ movies: [BAIXANDO], series: [] }),
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
        pauseDownload: h.pauseDownload,
        resumeDownload: () => undefined,
        openDownloadsFolder: () => undefined,
        on: () => undefined,
        off: () => undefined,
    },
}));

import { Downloads } from './Downloads';

let container: HTMLDivElement;
let root: Root;

describe('tela de Downloads: pausar um download em andamento', () => {
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        h.pauseDownload.mockClear();
        localStorage.clear();
        // Propriedade no window existente — trocar o `window` inteiro quebra o React.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            value: {
                // Gravações do DVR: a tela lê `files`/`recordings` na montagem.
                invoke: async () => ({ success: true, files: [], recordings: [] }),
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
    });

    it('o ⏸ do card chama pauseDownload com o id do item', async () => {
        await act(async () => { root.render(<Downloads />); });

        const botao = container.querySelector('.download-card .card-overlay .resume-btn');
        if (!botao) throw new Error('o ⏸ do card não está na tela');
        await act(async () => { (botao as HTMLElement).click(); });

        expect(h.pauseDownload).toHaveBeenCalledWith(BAIXANDO.id);
    });
});
