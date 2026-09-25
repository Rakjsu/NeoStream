/**
 * 🗑️ D066 — a lixeira de um download que NÃO terminou tem que chegar ao
 * `downloadService.deleteDownload`.
 *
 * É por ele que as sobras (`.partN`) saem do disco: o serviço manda o
 * descritor ao main (downloadService.test.ts) e o main acha e apaga as
 * partes (electron/downloadHandlers.test.ts). Este teste prende a ponta que
 * sobra — o clique na tela — com a página montada de verdade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const h = vi.hoisted(() => ({
    deleteDownload: vi.fn<(id: string) => Promise<void>>(async () => undefined),
}));

const FALHOU = {
    id: 'movie_filme_d066_1',
    name: 'Filme D066',
    type: 'movie' as const,
    url: 'http://x/filme.mp4',
    cover: '',
    size: 4096,
    downloadedBytes: 2048,
    status: 'failed' as const,
    progress: 50,
    createdAt: 1,
};

vi.mock('../components/AsyncVideoPlayer', () => ({ default: () => null }));

vi.mock('../services/downloadService', () => ({
    resumoDaSerie: () => ({ total: 0, concluidos: 0, baixando: 0, tamanho: 0 }),
    downloadService: {
        getDownloads: () => [FALHOU],
        getDownloadsGrouped: () => ({ movies: [FALHOU], series: [] }),
        getStorageInfo: async () => ({ used: 0, free: 0, total: 0 }),
        ensureProviderMaxConnections: async () => 4,
        getMaxConcurrent: () => 2,
        setMaxConcurrent: () => undefined,
        isNightOnly: () => false,
        setNightOnly: () => undefined,
        isSmartDownloads: () => false,
        setSmartDownloads: () => undefined,
        formatBytes: (n: number) => `${n} B`,
        deleteDownload: h.deleteDownload,
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

async function clicar(alvo: Element | null, oque: string) {
    if (!alvo) throw new Error(`${oque} não está na tela`);
    await act(async () => { (alvo as HTMLElement).click(); });
    await act(async () => { await Promise.resolve(); });
}

describe('tela de Downloads: excluir um download que não terminou', () => {
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        h.deleteDownload.mockClear();
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

    it('lixeira + confirmar chama deleteDownload com o id do item que falhou', async () => {
        await act(async () => { root.render(<Downloads />); });

        await clicar(container.querySelector('.download-card .delete-btn-corner'), 'a lixeira do card');
        await clicar(container.querySelector('.delete-modal .confirm-btn'), 'o confirmar do modal');

        expect(h.deleteDownload).toHaveBeenCalledWith(FALHOU.id);
    });
});
