import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 📂 "Baixar temporada" e "Apenas episódio N" no seletor da ficha (D190).
 *
 * O botão da temporada disparava uma cascata de `setTimeout` — um por
 * episódio, 2 s de distância — e cada volta chamava a MESMA função do clique
 * avulso, com os efeitos de tela dela:
 *   - `setShowDownloadModal(false)` a cada volta: quem reabria o seletor
 *     durante a temporada (para pedir outra, ou só para conferir) via o
 *     seletor fechar sozinho de 2 em 2 s, por até 46 s numa temporada de 24;
 *   - o seletor reaberto no meio oferecia de novo os episódios que ainda não
 *     tinham chegado à fila (só `isEpisodeInQueue` contava) — e o segundo
 *     clique enfileirava o MESMO episódio duas vezes, porque as duas voltas
 *     passavam pela checagem antes de qualquer uma terminar de resolver a
 *     URL. O clique avulso tinha o mesmo buraco.
 *
 * O que NÃO pode mudar: fechar a ficha não cancela o que a pessoa pediu. A
 * temporada inteira continua entrando na fila depois que a ficha fecha. E o
 * episódio cuja URL falhou volta a ser oferecido — não fica "a caminho" para
 * sempre.
 *
 * A ficha é montada DE VERDADE (react-dom/client + act); só o I/O e os
 * serviços de estado são dublês. O relógio é falso (só setTimeout) e o teste
 * AVANÇA ATÉ A CONDIÇÃO, nunca um número fixo de voltas.
 */

const h = vi.hoisted(() => {
    const estado = { episodiosNaFila: new Set<string>() };
    const addDownload = vi.fn(async (
        name: string,
        type: string,
        _url: string,
        _cover: string,
        seriesInfo?: { seriesName: string; season: number; episode: number },
    ) => {
        if (type === 'episode' && seriesInfo) estado.episodiosNaFila.add(`${seriesInfo.seriesName}|${seriesInfo.season}x${seriesInfo.episode}`);
        return { id: `ep-${seriesInfo?.season}-${seriesInfo?.episode}`, name, type, status: 'pending', progress: 0 };
    });
    return { estado, addDownload };
});

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('../services/tmdb', () => ({
    resolveSeriesDetails: vi.fn(async () => null),
    resolveMovieDetails: vi.fn(async () => null),
    fetchMovieTrailer: vi.fn(async () => null),
    fetchSeriesTrailer: vi.fn(async () => null),
    fetchCollection: vi.fn(async () => null),
    fetchSimilarByTmdbId: vi.fn(async () => []),
    fetchCastByTmdbId: vi.fn(async () => []),
    fetchPersonFilmography: vi.fn(async () => []),
}));

vi.mock('../services/catalogTitleIndex', () => ({
    getCatalogTitleIndex: vi.fn(async () => ({ vod: new Map(), series: new Map() })),
}));

vi.mock('../services/watchProgressService', () => ({
    watchProgressService: {
        getSeriesProgress: () => ({ lastSeason: 1, lastEpisode: 1 }),
        getLastWatchedEpisode: () => null,
        getEpisodeProgress: () => null,
        isEpisodeWatched: () => false,
        clearEpisodeProgress: vi.fn(),
        markEpisodeWatched: vi.fn(),
    },
}));

vi.mock('../services/movieProgressService', () => ({
    movieProgressService: {
        getProgress: () => null,
        getMoviePositionById: () => null,
        isWatched: () => false,
        markWatched: vi.fn(),
        clearProgress: vi.fn(),
    },
}));

vi.mock('../services/watchLater', () => ({
    watchLaterService: { has: () => false, add: vi.fn(), remove: vi.fn() },
}));

vi.mock('../services/favoritesService', () => ({
    favoritesService: { has: () => false, toggle: vi.fn() },
}));

vi.mock('../services/queueService', () => ({
    queueService: { has: () => false, add: vi.fn(), remove: vi.fn() },
}));

vi.mock('../services/downloadService', () => ({
    downloadService: {
        getOfflineFilePath: () => null,
        getOfflineEpisodePath: () => null,
        isDownloaded: () => false,
        isMovieInQueue: () => false,
        isEpisodeInQueue: (serie: string, season: number, episode: number) =>
            h.estado.episodiosNaFila.has(`${serie}|${season}x${episode}`),
        addDownload: h.addDownload,
        on: vi.fn(),
        off: vi.fn(),
        isDownloading: () => false,
        getProgress: () => null,
    },
}));

vi.mock('../services/traktService', () => ({
    isTraktConnected: () => false,
    traktRate: vi.fn(async () => undefined),
}));

vi.mock('../services/personalMarksService', () => ({
    allTags: () => [],
    getMark: () => ({}),
    setRating: vi.fn(),
    toggleTag: vi.fn(),
}));

vi.mock('../services/profileService', () => ({
    profileService: { getActiveProfile: () => null },
}));

vi.mock('./CastDeviceSelector', () => ({ CastDeviceSelector: () => null }));

import { ContentDetailModal } from './ContentDetailModal';
import { languageService } from '../services/languageService';
import pt from '../locales/ui/pt.json';

const EPISODIOS = {
    success: true,
    info: {
        episodes: {
            '1': [
                { id: '101', episode_num: 1, title: 'Primeiro Capitulo' },
                { id: '102', episode_num: 2, title: 'Segundo Capitulo' },
                { id: '103', episode_num: 3, title: 'Terceiro Capitulo' },
            ],
        },
    },
};

const TXT = pt.contentModal as Record<string, string>;
const SERIE = 'Serie de Teste (2020)';
const OUTRA_SERIE = 'Outra Serie (2021)';

/**
 * Avança o relógio falso em passos curtos até a CONDIÇÃO valer. O teto é de
 * passos (tempo simulado), não de voltas de microtask.
 */
async function avancarAte(condicao: () => boolean, oQue: string) {
    for (let passo = 0; passo < 600; passo++) {
        if (condicao()) return;
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    if (!condicao()) throw new Error(`nao aconteceu: ${oQue}`);
}

describe('"Baixar temporada" e "Apenas episodio" da ficha (D190)', () => {
    let container: HTMLDivElement;
    let root: Root;
    let montada: boolean;
    /** Quanto o main demora pra devolver a URL do episódio (tempo simulado). */
    let atrasoDaUrlMs: number;
    /** streamIds cuja URL o main NÃO resolve (success:false). */
    let urlsQueFalham: Set<string>;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        languageService.setLanguage('pt');
        h.estado.episodiosNaFila.clear();
        h.addDownload.mockClear();
        atrasoDaUrlMs = 0;
        urlsQueFalham = new Set();
        // Só a propriedade — não trocamos o window do jsdom.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: {
                invoke: vi.fn(async (canal: string, args?: { streamId?: string }) => {
                    if (canal === 'streams:get-series-url') {
                        const resposta = urlsQueFalham.has(String(args?.streamId))
                            ? { success: false, error: 'provedor recusou' }
                            : { success: true, url: `http://provedor.invalido/${args?.streamId}.mp4` };
                        if (atrasoDaUrlMs <= 0) return resposta;
                        return new Promise(resolve => setTimeout(() => resolve(resposta), atrasoDaUrlMs));
                    }
                    return EPISODIOS;
                }),
                send: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        montada = false;
    });

    afterEach(async () => {
        // Deixa terminar o que ficou pendurado, pra nada vazar pro próximo
        // teste (inclusive o "a caminho", que vive no módulo da ficha).
        await avancarAte(() => vi.getTimerCount() === 0, 'relogio sem timers pendentes');
        if (montada) await act(async () => { root.unmount(); });
        container.remove();
        vi.useRealTimers();
    });

    const naTela = (texto: string) => !!container.textContent?.includes(texto);
    const seletorAberto = () => naTela(TXT.whatToDownload);
    const jaEmDownload = (ep: number) => naTela(TXT.episodeAlreadyDownloading.replace('{episode}', String(ep)));

    const botaoBaixar = (): HTMLButtonElement => {
        const botao = Array.from(container.querySelectorAll('button'))
            .find(b => b.title === TXT.downloadTooltip || b.title === TXT.downloaded);
        if (!botao) throw new Error('botao Baixar nao encontrado');
        return botao;
    };

    /** O botão da temporada no seletor ("Temporada N" ou "Baixar N restantes"). */
    const botaoDaTemporada = (): HTMLButtonElement | undefined =>
        Array.from(container.querySelectorAll('button')).find(b => b.textContent?.startsWith('📂'));
    /** O botão "Apenas Episódio N" no seletor. */
    const botaoDoEpisodio = (): HTMLButtonElement | undefined =>
        Array.from(container.querySelectorAll('button')).find(b => b.textContent?.startsWith('📺'));

    /** Quantas vezes cada episódio da série foi posto na fila. */
    const pedidosPorEpisodio = (serie = SERIE) => {
        const contagem = new Map<number, number>();
        for (const chamada of h.addDownload.mock.calls) {
            if (chamada[0] !== serie) continue;
            const ep = (chamada[4] as { episode: number }).episode;
            contagem.set(ep, (contagem.get(ep) ?? 0) + 1);
        }
        return Object.fromEntries(contagem);
    };
    const naFila = (ep: number, serie = SERIE) => h.estado.episodiosNaFila.has(`${serie}|1x${ep}`);
    const todosNaFila = () => [1, 2, 3].every(ep => naFila(ep));
    const nadaPendente = () => vi.getTimerCount() === 0;

    async function montarSerie(serie = SERIE) {
        await act(async () => {
            root.render(
                <ContentDetailModal
                    isOpen
                    onClose={() => { }}
                    contentId={serie === SERIE ? '7' : '8'}
                    contentType="series"
                    contentData={{ name: serie, cover: 'https://exemplo.invalido/capa.jpg' }}
                    onPlay={() => { }}
                />
            );
        });
        montada = true;
        await avancarAte(() => naTela('Terceiro Capitulo'), 'lista de episodios na tela');
    }

    async function abrirSeletor() {
        await act(async () => { botaoBaixar().click(); });
        await avancarAte(seletorAberto, 'seletor de download aberto');
    }

    async function clicar(botao: HTMLButtonElement | undefined, qual: string) {
        if (!botao) throw new Error(`botao nao encontrado: ${qual}`);
        await act(async () => { botao.click(); });
    }

    it('reabrir o seletor enquanto a temporada entra na fila: ele NAO fecha sozinho', async () => {
        await montarSerie();
        await abrirSeletor();
        await clicar(botaoDaTemporada(), 'temporada');
        await avancarAte(() => naFila(1), 'episodio 1 na fila');
        await avancarAte(() => !seletorAberto(), 'seletor fechar depois do clique');
        // O primeiro episódio que entra avisa.
        expect(naTela(TXT.downloadQueued)).toBe(true);

        // A pessoa reabre o seletor com a temporada ainda entrando.
        await abrirSeletor();
        await avancarAte(todosNaFila, 'temporada inteira na fila');

        expect(seletorAberto()).toBe(true);
        expect(pedidosPorEpisodio()).toEqual({ 1: 1, 2: 1, 3: 1 });
    });

    it('pedir a temporada de novo no meio do caminho nao enfileira episodio duas vezes', async () => {
        // O main demora pra resolver a URL (Stalker faz rede por episódio).
        atrasoDaUrlMs = 3000;
        await montarSerie();
        await abrirSeletor();
        await clicar(botaoDaTemporada(), 'temporada');
        await avancarAte(() => !seletorAberto(), 'seletor fechar depois do clique');

        // Reabre antes de o primeiro episódio chegar à fila. Se o seletor
        // ainda oferecer a temporada, a pessoa clica de novo.
        await abrirSeletor();
        const deNovo = botaoDaTemporada();
        if (deNovo) await act(async () => { deNovo.click(); });

        await avancarAte(() => todosNaFila() && nadaPendente(), 'temporada na fila e nada pendente');

        expect(pedidosPorEpisodio()).toEqual({ 1: 1, 2: 1, 3: 1 });
    });

    it('fechar a ficha NAO cancela a temporada pedida (o pedido sobrevive a ficha)', async () => {
        await montarSerie();
        await abrirSeletor();
        await clicar(botaoDaTemporada(), 'temporada');

        await act(async () => { root.unmount(); });
        montada = false;

        await avancarAte(todosNaFila, 'temporada inteira na fila depois de fechar a ficha');
        expect(pedidosPorEpisodio()).toEqual({ 1: 1, 2: 1, 3: 1 });
    });

    it('o seletor reaberto no meio conta o que ja foi pedido, e o episodio pendente nao e oferecido de novo', async () => {
        atrasoDaUrlMs = 3000;
        await montarSerie();
        await abrirSeletor();
        await clicar(botaoDaTemporada(), 'temporada');
        await avancarAte(() => !seletorAberto(), 'seletor fechar depois do clique');

        await abrirSeletor();

        // Nenhum episódio chegou à fila ainda, mas os três já foram pedidos.
        expect(h.estado.episodiosNaFila.size).toBe(0);
        expect(botaoDaTemporada()).toBeUndefined();
        expect(naTela(TXT.seasonComplete.replace('{season}', '1').replace('{count}', '3'))).toBe(true);
        expect(jaEmDownload(1)).toBe(true);
        expect(botaoDoEpisodio()).toBeUndefined();
    });

    it('episodio que entra na fila por outro caminho durante a espera (retomado em Downloads) nao e pedido de novo', async () => {
        await montarSerie();
        await abrirSeletor();
        await clicar(botaoDaTemporada(), 'temporada');
        await avancarAte(() => naFila(1), 'episodio 1 na fila');

        // Enquanto a temporada espera a folga, o episódio 2 (que tinha
        // falhado antes) é retomado na tela de Downloads.
        h.estado.episodiosNaFila.add(`${SERIE}|1x2`);

        await avancarAte(() => naFila(3) && nadaPendente(), 'episodio 3 na fila e nada pendente');
        expect(pedidosPorEpisodio()).toEqual({ 1: 1, 3: 1 });
    });

    it('episodio da temporada cuja URL falhou volta a ser oferecido, sem esperar o resto da temporada, e avisa a falha', async () => {
        urlsQueFalham.add('101');
        await montarSerie();
        await abrirSeletor();
        await clicar(botaoDaTemporada(), 'temporada');
        await avancarAte(() => naFila(2), 'episodio 2 na fila');
        expect(naFila(3)).toBe(false); // a temporada ainda está entrando

        await abrirSeletor();
        // O 1 falhou: é oferecido de novo, e só ele falta.
        expect(jaEmDownload(1)).toBe(false);
        expect(botaoDoEpisodio()).toBeDefined();
        expect(botaoDaTemporada()?.textContent).toContain(
            TXT.downloadRemaining.replace('{count}', '1').replace('{downloaded}', '2'));

        await avancarAte(() => naFila(3), 'episodio 3 na fila');
        await avancarAte(() => naTela(TXT.downloadFailed), 'aviso de falha no fim da temporada');
        expect(pedidosPorEpisodio()).toEqual({ 2: 1, 3: 1 });
    });

    it('"Apenas episodio": reabrir o seletor enquanto a URL resolve nao oferece o mesmo episodio de novo', async () => {
        atrasoDaUrlMs = 3000;
        await montarSerie();
        await abrirSeletor();
        await clicar(botaoDoEpisodio(), 'apenas episodio');
        await avancarAte(() => !seletorAberto(), 'seletor fechar depois do clique');

        await abrirSeletor();
        expect(naFila(1)).toBe(false); // a URL ainda está resolvendo
        expect(jaEmDownload(1)).toBe(true);
        // Se ainda assim oferecer, a pessoa clica de novo.
        const deNovo = botaoDoEpisodio();
        if (deNovo) await act(async () => { deNovo.click(); });

        await avancarAte(() => naFila(1) && nadaPendente(), 'episodio na fila e nada pendente');
        expect(pedidosPorEpisodio()).toEqual({ 1: 1 });
    });

    it('a temporada a caminho de uma serie nao tira os episodios do seletor de OUTRA serie', async () => {
        atrasoDaUrlMs = 3000;
        await montarSerie();
        await abrirSeletor();
        await clicar(botaoDaTemporada(), 'temporada');

        // Fecha a ficha com a temporada ainda entrando e abre outra série.
        await act(async () => { root.unmount(); });
        root = createRoot(container);
        await montarSerie(OUTRA_SERIE);
        await abrirSeletor();

        expect(naFila(1)).toBe(false); // a primeira série ainda está a caminho
        expect(botaoDaTemporada()?.textContent).toContain(
            TXT.downloadSeason.replace('{season}', '1').replace('{count}', '3'));
        expect(jaEmDownload(1)).toBe(false);
        expect(botaoDoEpisodio()).toBeDefined();

        await avancarAte(() => todosNaFila() && nadaPendente(), 'primeira serie na fila e nada pendente');
        expect(pedidosPorEpisodio()).toEqual({ 1: 1, 2: 1, 3: 1 });
        expect(pedidosPorEpisodio(OUTRA_SERIE)).toEqual({});
    });

    it('"Apenas episodio" cuja URL falhou avisa e volta a ser oferecido', async () => {
        urlsQueFalham.add('101');
        await montarSerie();
        await abrirSeletor();
        await clicar(botaoDoEpisodio(), 'apenas episodio');
        await avancarAte(() => naTela(TXT.downloadFailed), 'aviso de falha');
        expect(naTela(TXT.downloadQueued)).toBe(false);

        await abrirSeletor();
        expect(jaEmDownload(1)).toBe(false);
        expect(botaoDoEpisodio()).toBeDefined();

        // E o que dá certo avisa "na fila".
        urlsQueFalham.clear();
        await clicar(botaoDoEpisodio(), 'apenas episodio de novo');
        await avancarAte(() => naFila(1), 'episodio na fila');
        expect(naTela(TXT.downloadQueued)).toBe(true);
        expect(pedidosPorEpisodio()).toEqual({ 1: 1 });
    });
});
