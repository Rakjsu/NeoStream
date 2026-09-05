import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// O serviço notifica no registro — o módulo real puxa a árvore de UI.
vi.mock('./episodeNotificationService', () => ({
    appNotificationService: { addDownloadNotification: vi.fn() },
}));

import { downloadService } from './downloadService';
import { appNotificationService } from './episodeNotificationService';

/**
 * 📥 Item 12 — o que chega do celular precisa APARECER na página de Downloads.
 * Episódio sem seriesName some da tela inteira (a grade principal esconde
 * type==='episode' e o agrupamento por série exige o campo).
 */
describe('downloadService.registerReceived (transferência do celular)', () => {
    beforeEach(() => {
        vi.mocked(appNotificationService.addDownloadNotification).mockClear();
    });

    it('episódio recebido aparece agrupado pela série', async () => {
        await downloadService.registerReceived({
            title: 'Dark · T1E3',
            kind: 'episode',
            filePath: 'C:/u/transfers/Dark T1E3.mkv',
            size: 100,
            transferId: 'dark_t1e3_mkv',
            seriesName: 'Dark',
            season: 1,
            episode: 3,
        });
        const grouped = downloadService.getDownloadsGrouped();
        const serie = grouped.series.find(s => s.seriesName === 'Dark');
        expect(serie).toBeTruthy();
        expect(serie?.seasons[0].episodes.map(e => e.name)).toContain('Dark · T1E3');
    });

    it('episódio de app antigo (sem seriesName) ainda aparece — série vem do título', async () => {
        await downloadService.registerReceived({
            title: 'Loki · T2E5',
            kind: 'episode',
            filePath: 'C:/u/transfers/Loki T2E5.mkv',
            size: 100,
            transferId: 'loki_t2e5_mkv',
        });
        expect(downloadService.getDownloadsGrouped().series.map(s => s.seriesName)).toContain('Loki');
    });

    it('nem título com série dá: sobra um grupo em vez de sumir', async () => {
        await downloadService.registerReceived({
            title: 'AvulsoSemSerie',
            kind: 'episode',
            filePath: 'C:/u/transfers/avulso.mkv',
            size: 100,
            transferId: 'avulso_mkv',
        });
        const nomes = downloadService.getDownloadsGrouped().series.map(s => s.seriesName);
        expect(nomes).toContain('AvulsoSemSerie');
    });

    // O mesmo recebimento chega pelo evento ao vivo E pela reconciliação de
    // boot: sem id determinístico virava DUAS entradas pro mesmo arquivo.
    // (fake timers só no Date: o id antigo carregava Date.now() e as duas
    // chamadas seguidas caíam no mesmo milissegundo, mascarando o bug.)
    it('registrar o mesmo transferId 2× não duplica a entrada', async () => {
        const payload = {
            title: 'Avatar',
            kind: 'movie' as const,
            filePath: 'C:/u/transfers/Avatar.mp4',
            size: 100,
            transferId: 'avatar_mp4',
        };
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-07-27T10:00:00Z'));
        const first = await downloadService.registerReceived(payload);
        vi.setSystemTime(new Date('2026-07-27T10:05:00Z'));
        const second = await downloadService.registerReceived(payload);
        vi.useRealTimers();
        expect(second.id).toBe(first.id);
        const avatares = downloadService.getDownloadsGrouped().movies.filter(m => m.name === 'Avatar');
        expect(avatares).toHaveLength(1);
        // E o usuário não leva duas notificações do mesmo arquivo.
        expect(appNotificationService.addDownloadNotification).toHaveBeenCalledTimes(1);
    });
});

/**
 * 🧹 Vazamento do listener de progresso.
 *
 * Cada download registrava `ipcRenderer.on('download:progress', ...)` e ninguém
 * dava `off`. O wrapper fica guardado num Map dentro do preload
 * (electron/preload.ts:255), então nem o closure nem o DownloadItem capturado
 * eram coletados, e todo evento de progresso passava a percorrer os N handlers
 * acumulados desde que o app abriu.
 *
 * O sintoma que o usuário via era outro: retomar um download registrava um
 * SEGUNDO handler com o mesmo id, e cada evento virava dois `emit('progress')`.
 */
describe('downloadService: listener de progresso', () => {
    function instalarIpc(inicioDoDownload: () => Promise<unknown>) {
        const on = vi.fn();
        const off = vi.fn();
        const invoke = vi.fn(async (canal: string) => {
            if (canal === 'download:start') return inicioDoDownload();
            if (canal === 'download:cache-image') return { success: false };
            return { success: true };
        });
        (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { on, off, invoke, send: vi.fn() };
        return { on, off, invoke };
    }

    /** O handler de 'download:progress' que foi passado ao on/off. */
    const handlerDe = (espia: { mock: { calls: unknown[][] } }) =>
        espia.mock.calls.find(chamada => chamada[0] === 'download:progress')?.[1];

    it('solta o listener quando o download termina', async () => {
        const { on, off } = instalarIpc(async () => ({ success: true, filePath: 'C:/x/a.mp4', size: 10 }));

        await downloadService.addDownload('Filme do teste de leak', 'movie', 'http://x/a.mp4', '');
        await vi.waitFor(() => expect(off).toHaveBeenCalled());

        // O que sai tem que ser exatamente o que entrou: o `off` do preload
        // casa por identidade da função (electron/preload.ts:273-281), então
        // soltar um handler equivalente-mas-diferente não removeria nada.
        expect(handlerDe(off)).toBe(handlerDe(on));
    });

    it('solta o listener também quando o download falha', async () => {
        const { on, off } = instalarIpc(async () => ({ success: false, error: 'provedor caiu' }));

        await downloadService.addDownload('Filme que falha no teste de leak', 'movie', 'http://x/b.mp4', '');
        await vi.waitFor(() => expect(off).toHaveBeenCalled());

        expect(handlerDe(off)).toBe(handlerDe(on));
    });

    it('solta o listener quando o próprio invoke rejeita', async () => {
        const { on, off } = instalarIpc(async () => { throw new Error('IPC morreu'); });

        await downloadService.addDownload('Filme com IPC morto no teste de leak', 'movie', 'http://x/c.mp4', '');
        await vi.waitFor(() => expect(off).toHaveBeenCalled());

        expect(handlerDe(off)).toBe(handlerDe(on));
    });
});
