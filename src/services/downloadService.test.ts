import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// O serviço notifica no registro — o módulo real puxa a árvore de UI.
vi.mock('./episodeNotificationService', () => ({
    appNotificationService: { addDownloadNotification: vi.fn() },
}));

import { downloadService, resumoDaSerie } from './downloadService';
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

/**
 * O número que o modal de exclusão mostra. A pessoa decide apagar uma árvore
 * de dezenas de GB olhando só pra ele.
 */
describe('resumoDaSerie', () => {
    const episodio = (id: string, size: number) => ({
        id, name: id, size,
    } as unknown as Parameters<typeof resumoDaSerie>[0]['seasons'][0]['episodes'][0]);

    it('soma as DUAS temporadas, não só a primeira', () => {
        // Pegar `seasons[0]` mostraria um terço do tamanho, e a confirmação
        // seria dada em cima de um número errado.
        const resumo = resumoDaSerie({
            seriesName: 'Dark',
            seasons: [
                { episodes: [episodio('t1e1', 100), episodio('t1e2', 200)] },
                { episodes: [episodio('t2e1', 700)] },
            ],
        });
        expect(resumo).toEqual({ nome: 'Dark', episodios: 3, bytes: 1000 });
    });

    it('episódio sem tamanho não vira NaN', () => {
        // "NaN B" no modal é convite pra confirmar às cegas.
        const resumo = resumoDaSerie({
            seriesName: 'Dark',
            seasons: [{ episodes: [episodio('t1e1', 100), episodio('t1e2', undefined as unknown as number)] }],
        });
        expect(resumo.bytes).toBe(100);
        expect(Number.isNaN(resumo.bytes)).toBe(false);
    });

    it('série sem episódio no disco dá zero, não quebra', () => {
        expect(resumoDaSerie({ seriesName: 'Vazia', seasons: [] })).toEqual({ nome: 'Vazia', episodios: 0, bytes: 0 });
    });
});

/**
 * 🗑️ D066 — excluir/cancelar um download que não terminou deixava os `.partN`
 * no disco. Do lado do renderer o buraco era duplo: `item.filePath` só existe
 * no SUCESSO (então o `download:delete-file` nunca rodava), e o
 * `download:cancel` só ia para o main com status `downloading` — item pausado
 * ou que falhou nem avisava. E o main, sem o descritor, não tinha como achar
 * as partes de um download que ele já esqueceu.
 */
describe('downloadService: excluir/cancelar manda o main limpar as sobras', () => {
    function instalarIpc(inicioDoDownload: () => Promise<unknown>) {
        const invoke = vi.fn(async (canal: string) => {
            if (canal === 'download:start') return inicioDoDownload();
            if (canal === 'download:cache-image') return { success: false };
            return { success: true };
        });
        (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { on: vi.fn(), off: vi.fn(), invoke, send: vi.fn() };
        return invoke;
    }

    const statusDe = (id: string) => downloadService.getDownloads().find(d => d.id === id)?.status;
    const canais = (invoke: { mock: { calls: unknown[][] } }) => invoke.mock.calls.map(chamada => chamada[0]);

    it('excluir um download que FALHOU manda o main apagar as partes', async () => {
        const invoke = instalarIpc(async () => ({ success: false, error: 'provedor caiu' }));
        const item = await downloadService.addDownload('Filme D066 que falhou', 'movie', 'http://x/d066.mp4', '');
        await vi.waitFor(() => expect(statusDe(item.id)).toBe('failed'));
        invoke.mockClear();

        await downloadService.deleteDownload(item.id);

        expect(invoke).toHaveBeenCalledWith('download:cancel', expect.objectContaining({
            id: item.id, name: 'Filme D066 que falhou', type: 'movie',
        }));
        expect(statusDe(item.id)).toBeUndefined();
    });

    it('excluir um episódio PAUSADO manda série, temporada e episódio', async () => {
        // O start fica pendurado até a pausa e aí é solto como falha, só para
        // a fila deste serviço (singleton) não ficar com a vaga presa.
        let soltarStart: (r: unknown) => void = () => undefined;
        const invoke = instalarIpc(() => new Promise(resolve => { soltarStart = resolve; }));
        const item = await downloadService.addDownload('Dark D066', 'episode', 'http://x/dark.mp4', '', {
            seriesName: 'Dark D066', season: 2, episode: 5,
        });
        await vi.waitFor(() => expect(statusDe(item.id)).toBe('downloading'));
        await downloadService.pauseDownload(item.id);
        soltarStart({ success: false, error: 'conexão destruída' });
        await vi.waitFor(() => expect(statusDe(item.id)).toBe('paused'));
        invoke.mockClear();

        await downloadService.deleteDownload(item.id);

        expect(invoke).toHaveBeenCalledWith('download:cancel', expect.objectContaining({
            id: item.id, name: 'Dark D066', type: 'episode', seriesName: 'Dark D066', season: 2, episode: 5,
        }));
        expect(statusDe(item.id)).toBeUndefined();
    });

    it('cancelDownload de um item que FALHOU também avisa o main', async () => {
        const invoke = instalarIpc(async () => ({ success: false, error: 'provedor caiu' }));
        const item = await downloadService.addDownload('Filme D066 cancelado', 'movie', 'http://x/d066c.mp4', '');
        await vi.waitFor(() => expect(statusDe(item.id)).toBe('failed'));
        invoke.mockClear();

        await downloadService.cancelDownload(item.id);

        expect(invoke).toHaveBeenCalledWith('download:cancel', expect.objectContaining({
            id: item.id, name: 'Filme D066 cancelado', type: 'movie',
        }));
        expect(statusDe(item.id)).toBeUndefined();
    });

    it('excluir um CONCLUÍDO só apaga o arquivo: não pede limpeza de partes ao main', async () => {
        const invoke = instalarIpc(async () => ({ success: true, filePath: 'C:/d/movies/Pronto D066.mp4', size: 10 }));
        const item = await downloadService.addDownload('Pronto D066', 'movie', 'http://x/pronto.mp4', '');
        await vi.waitFor(() => expect(statusDe(item.id)).toBe('completed'));
        invoke.mockClear();

        await downloadService.deleteDownload(item.id);

        expect(invoke).toHaveBeenCalledWith('download:delete-file', { filePath: 'C:/d/movies/Pronto D066.mp4' });
        expect(canais(invoke).includes('download:cancel')).toBe(false);
    });

    /**
     * Com o conserto, o cancel do main DERRUBA o `download:start` (antes, no
     * Node de verdade, o start de um paralelo cancelado ficava pendurado). O
     * catch do processQueue não pode tratar isso como falha: notificaria
     * "download falhou" e o `saveDownload` poria de volta no IndexedDB o
     * item que a pessoa acabou de excluir — ele reaparece no próximo boot.
     *
     * As duas ordens de chegada existem: a resposta do start pode vir antes
     * ou depois da resposta do cancel.
     */
    async function registroNoBanco(id: string): Promise<unknown> {
        const db = await new Promise<IDBDatabase>((ok, erro) => {
            const pedido = indexedDB.open('neostream_downloads', 1);
            pedido.onsuccess = () => ok(pedido.result);
            pedido.onerror = () => erro(pedido.error);
        });
        try {
            return await new Promise((ok, erro) => {
                const pedido = db.transaction('downloads', 'readonly').objectStore('downloads').get(id);
                pedido.onsuccess = () => ok(pedido.result);
                pedido.onerror = () => erro(pedido.error);
            });
        } finally {
            db.close();
        }
    }

    async function excluirNoMeio(
        nome: string,
        startCaiAntesDoCancel: boolean,
        descartar: (id: string) => Promise<void> = id => downloadService.deleteDownload(id),
    ) {
        vi.mocked(appNotificationService.addDownloadNotification).mockClear();
        // Uma vaga só: o SEGUNDO download só começa quando o catch do
        // primeiro soltar a vaga — é a condição que o teste espera.
        downloadService.setMaxConcurrent(1);
        let soltarStart: (r: unknown) => void = () => undefined;
        const startsDoSegundo: string[] = [];
        let soltarSegundo: (r: unknown) => void = () => undefined;
        const invoke = vi.fn(async (canal: string, dados?: { name?: string }) => {
            if (canal === 'download:start') {
                if (dados?.name === nome) return new Promise(resolve => { soltarStart = resolve; });
                startsDoSegundo.push(String(dados?.name));
                return new Promise(resolve => { soltarSegundo = resolve; });
            }
            if (canal === 'download:cancel' && startCaiAntesDoCancel) {
                soltarStart({ success: false, error: 'Download cancelado' });
                await vi.waitFor(() => expect(startsDoSegundo).toHaveLength(1));
            }
            if (canal === 'download:cache-image') return { success: false };
            return { success: true };
        });
        (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { on: vi.fn(), off: vi.fn(), invoke, send: vi.fn() };
        try {
            const item = await downloadService.addDownload(nome, 'movie', 'http://x/meio.mp4', '');
            await vi.waitFor(() => expect(statusDe(item.id)).toBe('downloading'));
            await downloadService.addDownload(`${nome} (o próximo da fila)`, 'movie', 'http://x/prox.mp4', '');

            await descartar(item.id);
            if (!startCaiAntesDoCancel) soltarStart({ success: false, error: 'Download cancelado' });
            await vi.waitFor(() => expect(startsDoSegundo).toHaveLength(1));

            const falhas = vi.mocked(appNotificationService.addDownloadNotification).mock.calls
                .filter(chamada => chamada[0] === 'failed' && chamada[1] === nome);
            expect(falhas).toEqual([]);
            expect(statusDe(item.id)).toBeUndefined();
            expect(await registroNoBanco(item.id)).toBeUndefined();
        } finally {
            // Solta a vaga do segundo para o próximo teste (o serviço é singleton).
            soltarSegundo({ success: true, filePath: 'C:/d/movies/prox.mp4', size: 1 });
            downloadService.setMaxConcurrent(2);
        }
    }

    it('excluir no meio: start derrubado DEPOIS do cancel não vira "falhou" nem volta do banco', async () => {
        await excluirNoMeio('Filme D066 excluído (start depois)', false);
    });

    it('excluir no meio: start derrubado ANTES da resposta do cancel também não', async () => {
        await excluirNoMeio('Filme D066 excluído (start antes)', true);
    });

    it('cancelDownload no meio segue a mesma regra', async () => {
        await excluirNoMeio('Filme D066 cancelado no meio', true, id => downloadService.cancelDownload(id));
    });
});

/**
 * O `file://` do download offline é o que a ficha entrega ao player (e ao
 * `mpv:play`). Fora do Windows o caminho JÁ começa com `/`: o serviço
 * montava `file:///${caminho}` e saía `file:////home/...`, que a guarda do
 * mpv lê como UNC e recusa — o MPV não tocava download offline no Linux nem
 * no macOS. Strings puras: vale igual no Windows e no ubuntu-latest da CI.
 */
describe('downloadService: URL do arquivo offline', () => {
    it('filme baixado: três barras no POSIX e no Windows', async () => {
        await downloadService.registerReceived({
            title: 'Filme Offline POSIX', kind: 'movie', size: 1,
            filePath: '/home/rak/.config/NeoStream/downloads/movies/Filme Offline 50%.mp4',
        });
        await downloadService.registerReceived({
            title: 'Filme Offline Windows', kind: 'movie', size: 1,
            filePath: 'C:\\Users\\rak\\NeoStream\\downloads\\movies\\Filme Offline.mp4',
        });

        expect(downloadService.getOfflineFilePath('Filme Offline POSIX', 'movie'))
            .toBe('file:///home/rak/.config/NeoStream/downloads/movies/Filme Offline 50%.mp4');
        expect(downloadService.getOfflineFilePath('Filme Offline Windows', 'movie'))
            .toBe('file:///C:/Users/rak/NeoStream/downloads/movies/Filme Offline.mp4');
    });

    it('episódio baixado: três barras no POSIX e no Windows', async () => {
        await downloadService.registerReceived({
            title: 'Série Offline · T2E7', kind: 'episode', size: 1, seriesName: 'Série Offline', season: 2, episode: 7,
            filePath: '/Users/rak/Library/Application Support/NeoStream/downloads/series/Série Offline/T2E7.mkv',
        });
        await downloadService.registerReceived({
            title: 'Série Offline · T2E8', kind: 'episode', size: 1, seriesName: 'Série Offline', season: 2, episode: 8,
            filePath: 'D:\\NeoStream\\downloads\\series\\Série Offline\\T2E8.mkv',
        });

        expect(downloadService.getOfflineEpisodePath('Série Offline', 2, 7))
            .toBe('file:///Users/rak/Library/Application Support/NeoStream/downloads/series/Série Offline/T2E7.mkv');
        expect(downloadService.getOfflineEpisodePath('Série Offline', 2, 8))
            .toBe('file:///D:/NeoStream/downloads/series/Série Offline/T2E8.mkv');
    });
});
