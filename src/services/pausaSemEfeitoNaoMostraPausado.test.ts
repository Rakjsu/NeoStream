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

    it('pausa aceita pelo main vira ⏸ e emite \'paused\' — é esse evento que redesenha a tela (D180)', async () => {
        const ipc = instalarIpc({ success: true });
        // A tela relê o serviço DENTRO do ouvinte: o status tem que já estar
        // 'paused' no instante do evento (o item é o mesmo objeto, então olhar
        // o argumento depois não prova nada).
        const noEvento: { id: string; status: string }[] = [];
        const pausado = (i: { id: string }) => { noEvento.push({ id: i.id, status: statusDe(i.id) ?? '' }); };
        downloadService.on('paused', pausado);
        const item = await downloadService.addDownload('Filme D180 pausado', 'movie', 'http://x/d180.mp4', '');
        await vi.waitFor(() => expect(statusDe(item.id)).toBe('downloading'));

        await downloadService.pauseDownload(item.id);

        expect(statusDe(item.id)).toBe('paused');
        expect(noEvento).toEqual([{ id: item.id, status: 'paused' }]);

        downloadService.off('paused', pausado);
        // O main derruba o start da pausa: soltá-lo devolve a vaga da fila
        // (o serviço é singleton).
        ipc.soltar({ success: false, error: 'conexão destruída' });
    });
});
