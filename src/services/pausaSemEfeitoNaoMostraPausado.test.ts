import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';

// O serviço notifica no registro — o módulo real puxa a árvore de UI.
vi.mock('./episodeNotificationService', () => ({
    appNotificationService: { addDownloadNotification: vi.fn() },
}));

import { downloadService } from './downloadService';

/**
 * ⏸ D179 — o botão de pausa só pode mostrar ⏸ quando o main pausou algo.
 *
 * `pauseDownload` ignorava a resposta do `download:pause` e marcava o item
 * como pausado de qualquer jeito. Quando o main respondia "Download not
 * found" (não havia o que parar), a tela mostrava ⏸ para um download que
 * seguia baixando — e que, ao terminar, "despausava" sozinho como concluído.
 */
describe('downloadService.pauseDownload respeita a resposta do main', () => {
    function instalarIpc(respostaDoPause: unknown) {
        let soltarStart: (r: unknown) => void = () => undefined;
        const invoke = vi.fn(async (canal: string) => {
            if (canal === 'download:start') return new Promise(resolve => { soltarStart = resolve; });
            if (canal === 'download:pause') return respostaDoPause;
            if (canal === 'download:cache-image') return { success: false };
            return { success: true };
        });
        (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { on: vi.fn(), off: vi.fn(), invoke, send: vi.fn() };
        return { invoke, soltar: (r: unknown) => soltarStart(r) };
    }

    const statusDe = (id: string) => downloadService.getDownloads().find(d => d.id === id)?.status;

    it('"Download not found" não vira ⏸: o item segue baixando e conclui normalmente', async () => {
        const ipc = instalarIpc({ success: false, error: 'Download not found' });
        const pausado = vi.fn();
        downloadService.on('paused', pausado);
        const item = await downloadService.addDownload('Filme D179 sem entrada', 'movie', 'http://x/d179a.mp4', '');
        await vi.waitFor(() => expect(statusDe(item.id)).toBe('downloading'));

        await downloadService.pauseDownload(item.id);

        expect(ipc.invoke).toHaveBeenCalledWith('download:pause', { id: item.id });
        expect(statusDe(item.id)).toBe('downloading');
        expect(pausado).not.toHaveBeenCalled();

        ipc.soltar({ success: true, filePath: 'C:/d/movies/Filme D179 sem entrada.mp4', size: 10 });
        await vi.waitFor(() => expect(statusDe(item.id)).toBe('completed'));
        downloadService.off('paused', pausado);
    });
});
