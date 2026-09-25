import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 📺 Abrir a ficha de uma série montava DUAS telas (#D047).
 *
 * A página de Séries tinha `{selectedSeries && <SeriesDetailPanel …/>}` e
 * `{selectedSeries && <ContentDetailModal …/>}` com a MESMA condição. O painel
 * antigo nascia com `display: 'none'` e o modal cobre a tela inteira — ninguém
 * via o painel, mas ele era montado e TRABALHAVA:
 *   - o `useSeriesMetadata` da página resolvia a série no TMDB de novo (a
 *     ficha já faz isso sozinha);
 *   - a lista de episódios escondida chamava `getEpisodeTitle` pra CADA
 *     episódio da temporada, e cada título genérico do provedor ("S01E03")
 *     virava um GET em /tv/{id}/season/N/episode/M — uma temporada inteira de
 *     requisições pra uma lista que nunca aparece.
 *
 * O que a página ainda precisa de verdade é o nome do episódio que está
 * TOCANDO (título do player) — e o do PRÓXIMO: o player amarra a sessão de
 * Estatísticas (base do limite diário do perfil) e o scrobble do Trakt ao
 * título, então um título que muda depois de o episódio começar encerra a
 * sessão. O painel escondido, de quebra, deixava a temporada pré-carregada; o
 * conserto não pode trocar um defeito pelo outro.
 *
 * Os casos montam a página de verdade (react-dom/client + act), abrem a ficha
 * pelo mesmo caminho da busca global e contam o que sai pro TMDB. Os
 * componentes pesados que não decidem nada disso (ficha, player, cards,
 * menus) são dublês finos.
 */

// ---------------------------------------------------------------------------
// Dublês
// ---------------------------------------------------------------------------
const tmdb = vi.hoisted(() => ({
    resolveSeriesDetails: vi.fn(async () => ({ id: 1399, name: 'Série', backdrop_path: '/fundo.jpg' })),
    fetchEpisodeDetails: vi.fn(async (_id: string, temporada: number, episodio: number) => ({
        name: `Nome TMDB ${temporada}x${episodio}`,
    })),
}));

vi.mock('../services/tmdb', () => ({
    getBackdropUrl: (p: string) => `https://img.invalido${p}`,
    resolveSeriesDetails: tmdb.resolveSeriesDetails,
    fetchEpisodeDetails: tmdb.fetchEpisodeDetails,
}));

vi.mock('../services/traktService', () => ({ syncTraktEpisodeWatched: vi.fn(async () => undefined) }));

vi.mock('../components/GlobalSearch', () => ({
    GLOBAL_SEARCH_TERM_KEY: 'neostream_global_search_term',
    GLOBAL_SEARCH_OPEN_KEY: 'neostream_global_search_open',
    GLOBAL_SEARCH_EVENT: 'neostream-global-search',
}));

vi.mock('../hooks/useContentFiltering', () => ({
    useContentFiltering: () => ({
        checkingItem: null,
        blockMessage: null,
        isItemVisible: () => true,
        handleItemClick: () => { },
    }),
}));

vi.mock('../hooks/useWindowedGrid', () => ({
    useWindowedGrid: () => ({ ready: false, start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 }),
}));

/** O episódio que o botão de tocar da ficha (dublê) manda pra página. */
const fichaToca = vi.hoisted(() => ({ temporada: 1, episodio: 1 }));

vi.mock('../components/ContentDetailModal', () => ({
    ContentDetailModal: (props: { onPlay: (s?: number, e?: number) => void }) => (
        <div data-ficha="sim">
            <button data-acao="tocar" onClick={() => props.onPlay(fichaToca.temporada, fichaToca.episodio)}>tocar</button>
        </div>
    ),
}));

/** Todo título que o player recebeu, na ordem — o que a sessão de Estatísticas "vê". */
const titulosDoPlayer = vi.hoisted(() => [] as string[]);

vi.mock('../components/AsyncVideoPlayer', () => ({
    default: (props: { customTitle?: string; onNextEpisode?: () => void }) => {
        titulosDoPlayer.push(props.customTitle ?? '');
        return (
            <div>
                <div data-player="sim">{props.customTitle}</div>
                <button data-acao="proximo" onClick={() => props.onNextEpisode?.()}>próximo</button>
            </div>
        );
    },
}));

vi.mock('../components/HoverPreviewCard', () => ({ HoverPreviewCard: () => null }));
vi.mock('../components/hoverPreviewActions', () => ({ closeAllPreviews: () => { } }));
vi.mock('../components/CategoryMenu', () => ({ CategoryMenu: () => null }));
vi.mock('../components/AnimatedSearchBar', () => ({ AnimatedSearchBar: () => null }));
vi.mock('../components/CatalogFilters', () => ({ CatalogFilters: () => null }));
vi.mock('../components/SortSelect', () => ({ SortSelect: () => null }));
vi.mock('../components/ResumeModal', () => ({ ResumeModal: () => null }));

import { Series } from './Series';
import { watchProgressService } from '../services/watchProgressService';

const SERIE = {
    num: 1, name: 'Série de Teste (2020)', series_id: 7, stream_icon: '', cover: 'https://capa.invalido/c.jpg',
    plot: '', cast: '', director: '', genre: '', release_date: '2020-01-01', last_modified: '0', rating: '8',
    rating_5based: 4, backdrop_path: [], youtube_trailer: '', episode_run_time: '', category_id: '1', tmdb_id: '1399',
};

/**
 * Espera a CONDIÇÃO (nunca um número fixo de voltas). O teto é de relógio e
 * fica bem abaixo do timeout do caso, pra falha dizer O QUE não aconteceu.
 */
async function esperar(condicao: () => boolean, oQue: string) {
    const limite = Date.now() + 2000;
    while (!condicao()) {
        if (Date.now() > limite) throw new Error(`nao aconteceu: ${oQue}`);
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
}

const pedidosAoTmdb = () =>
    [...new Set(tmdb.fetchEpisodeDetails.mock.calls.map(([id, t, e]) => `${id}:${t}x${e}`))].sort();

describe('página de Séries: abrir a ficha não monta uma segunda tela escondida (#D047)', () => {
    let container: HTMLDivElement;
    let root: Root;
    let serie: typeof SERIE;
    let episodios: Array<{ id: number; episode_num: number; title: string }>;
    let outrasTemporadas: Record<string, Array<{ id: number; episode_num: number; title: string }>>;
    let ultimoEpisodio: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        sessionStorage.clear();
        tmdb.resolveSeriesDetails.mockClear();
        tmdb.fetchEpisodeDetails.mockClear();
        titulosDoPlayer.length = 0;
        serie = { ...SERIE };
        fichaToca.temporada = 1;
        fichaToca.episodio = 1;
        outrasTemporadas = {};
        // Títulos genéricos do provedor: é o que manda buscar o nome no TMDB.
        episodios = [
            { id: 101, episode_num: 1, title: 'S01E01' },
            { id: 102, episode_num: 2, title: 'S01E02' },
            { id: 103, episode_num: 3, title: 'S01E03' },
            { id: 104, episode_num: 4, title: 'S01E04' },
        ];
        ultimoEpisodio = vi.spyOn(watchProgressService, 'getLastWatchedEpisode');
        // Só a propriedade — o window do jsdom continua o mesmo.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: {
                invoke: vi.fn(async (canal: string) => {
                    if (canal === 'streams:get-series') return { success: true, data: [serie] };
                    if (canal === 'series:get-info') return { success: true, info: { episodes: { '1': episodios, ...outrasTemporadas } } };
                    return { success: false };
                }),
                send: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        container.remove();
        ultimoEpisodio.mockRestore();
    });

    /** Abre a ficha pelo caminho da busca global e espera os episódios chegarem à página. */
    async function abrirFicha() {
        sessionStorage.setItem('neostream_global_search_open', JSON.stringify({ kind: 'series', id: 7 }));
        await act(async () => { root.render(<Series />); });
        await esperar(() => !!container.querySelector('[data-ficha]'), 'a ficha abrir');
        // O `series:get-info` da página respondeu e foi aplicado: é nesse
        // `.then` que ela restaura o último episódio visto.
        await esperar(() => ultimoEpisodio.mock.calls.length > 0, 'os episódios chegarem à página');
    }

    async function tocar() {
        await act(async () => {
            (container.querySelector('[data-acao="tocar"]') as HTMLButtonElement).click();
        });
        await esperar(() => !!container.querySelector('[data-player]'), 'o player abrir');
    }

    /** Espera cada GET já disparado ao TMDB responder e a página aplicar a resposta. */
    async function tmdbResponder() {
        await act(async () => {
            await Promise.all(tmdb.fetchEpisodeDetails.mock.results.map(r => r.value));
        });
    }

    const tituloDoPlayer = () => container.querySelector('[data-player]')?.textContent;

    it('com a ficha aberta, o painel antigo (invisível) não existe na tela', async () => {
        await abrirFicha();

        expect(container.querySelector('[data-ficha]')).not.toBeNull();
        expect(container.querySelector('.series-details-panel')).toBeNull();
        expect(container.querySelector('.episode-card')).toBeNull();
    });

    it('abrir a ficha não faz a PÁGINA ir ao TMDB — a ficha já resolve a série sozinha', async () => {
        await abrirFicha();
        await tmdbResponder();

        expect(tmdb.resolveSeriesDetails).not.toHaveBeenCalled();
        expect(tmdb.fetchEpisodeDetails).not.toHaveBeenCalled();
    });

    it('tocando um episódio de título genérico, o player mostra o nome do TMDB — e só vão o episódio e o próximo', async () => {
        await abrirFicha();
        await tocar();
        await esperar(
            () => !!tituloDoPlayer()?.includes('Episódio 1 - Nome TMDB 1x1'),
            'o título do TMDB chegar ao player',
        );
        await tmdbResponder();

        expect(tituloDoPlayer()).toBe('Série de Teste (2020) - Episódio 1 - Nome TMDB 1x1');
        // Nem a temporada inteira (1x3, 1x4), nem a série de novo.
        expect(pedidosAoTmdb()).toEqual(['1399:1x1', '1399:1x2']);
        expect(tmdb.resolveSeriesDetails).not.toHaveBeenCalled();
    });

    it('o próximo episódio já entra com o nome final — o título não muda depois que ele começa', async () => {
        await abrirFicha();
        await tocar();
        await esperar(() => !!tituloDoPlayer()?.includes('Nome TMDB 1x1'), 'o título do episódio 1');
        await tmdbResponder();
        titulosDoPlayer.length = 0;

        await act(async () => {
            (container.querySelector('[data-acao="proximo"]') as HTMLButtonElement).click();
        });

        // Todo render do episódio 2 já traz o nome: nenhum "Episódio 2" cru
        // que depois vira outro título (e derruba a sessão de Estatísticas).
        const doEpisodio2 = titulosDoPlayer.filter(t => t.includes('Episódio 2'));
        expect(doEpisodio2.length).toBeGreaterThan(0);
        expect(doEpisodio2.every(t => t === 'Série de Teste (2020) - Episódio 2 - Nome TMDB 1x2')).toBe(true);
        // E o pré-carregamento anda junto: agora vai o 1x3, não a temporada toda.
        await tmdbResponder();
        expect(pedidosAoTmdb()).toEqual(['1399:1x1', '1399:1x2', '1399:1x3']);
    });

    it('na temporada 2, o pedido ao TMDB leva a temporada que está tocando', async () => {
        outrasTemporadas = {
            '2': [
                { id: 201, episode_num: 1, title: 'S02E01' },
                { id: 202, episode_num: 2, title: 'S02E02' },
                { id: 203, episode_num: 3, title: 'S02E03' },
            ],
        };
        fichaToca.temporada = 2;
        await abrirFicha();
        await tocar();
        await esperar(() => !!tituloDoPlayer()?.includes('Nome TMDB 2x1'), 'o título da temporada 2');
        await tmdbResponder();

        expect(tituloDoPlayer()).toBe('Série de Teste (2020) - Episódio 1 - Nome TMDB 2x1');
        expect(pedidosAoTmdb()).toEqual(['1399:2x1', '1399:2x2']);
    });

    it('título de verdade do provedor vai direto pro player, sem TMDB', async () => {
        episodios = [{ id: 101, episode_num: 1, title: 'O Começo' }];
        await abrirFicha();
        await tocar();
        await tmdbResponder();

        expect(tituloDoPlayer()).toBe('Série de Teste (2020) - Episódio 1 - O Começo');
        expect(tmdb.fetchEpisodeDetails).not.toHaveBeenCalled();
    });

    it('o título do player é limpo igual à lista da ficha ("Pilot [S01E01]" vira "Pilot")', async () => {
        // A limpeza antiga do player comia "Pilot [" e deixava só "]".
        episodios = [{ id: 101, episode_num: 1, title: 'Pilot [S01E01]' }];
        await abrirFicha();
        await tocar();
        await tmdbResponder();

        expect(tituloDoPlayer()).toBe('Série de Teste (2020) - Episódio 1 - Pilot');
        expect(tmdb.fetchEpisodeDetails).not.toHaveBeenCalled();
    });

    it('série sem tmdb_id: título neutro e nenhum pedido ao TMDB', async () => {
        serie = { ...SERIE, tmdb_id: '' };
        await abrirFicha();
        await tocar();
        await tmdbResponder();

        expect(tituloDoPlayer()).toBe('Série de Teste (2020) - Episódio 1');
        expect(tmdb.fetchEpisodeDetails).not.toHaveBeenCalled();
    });
});
