import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 🌐 A coluna de episódios da ficha tinha que sair NO IDIOMA DO APP.
 *
 * Dois textos estavam cravados em português dentro do JSX, no meio de vizinhos
 * que já passavam por `t()`: "Carregando episódios..." e "⚠️ Não foi possível
 * carregar os episódios." — este último colado num botão que JÁ saía
 * traduzido (`t('common','retry')`), então o aviso saía metade em português e
 * metade em inglês na MESMA caixinha.
 *
 * (O botão "Limpar Histórico" do antigo `SeriesDetailPanel` também era coberto
 * aqui; o painel saiu da tela no #D047 — nascia com `display: none` atrás da
 * ficha — e levou o botão junto.)
 *
 * Os casos montam a ficha DE VERDADE (react-dom/client + act, o
 * padrão de src/components/proximoEpisodioNoMpv.test.tsx), põem o app em
 * inglês/espanhol e leem o texto que aparece na tela. Não há casamento de
 * string sobre o código-fonte: o que se afirma é o que a pessoa lê.
 *
 * As pontas do invariante:
 *   1. em inglês/espanhol sai o texto daquele idioma;
 *   2. em português o texto continua o mesmo de antes (sem regressão) — é esta
 *      ponta que pega "cravar o inglês" no lugar de traduzir;
 *   3. o aviso de erro e o botão "Tentar de novo" saem no MESMO idioma — a
 *      mistura era o defeito mais visível.
 */

// ---------------------------------------------------------------------------
// Dublês só do I/O e dos serviços de estado. Nada que decida texto é dublado.
// ---------------------------------------------------------------------------
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
    getCatalogTitleIndex: vi.fn(async () => ({ movies: new Map(), series: new Map() })),
}));

vi.mock('../services/watchProgressService', () => ({
    watchProgressService: {
        getSeriesProgress: () => ({ lastSeason: 1, lastEpisode: 1 }),
        getLastWatchedEpisode: () => null,
        getEpisodeProgress: () => null,
        clearEpisodeProgress: vi.fn(),
        markEpisodeWatched: vi.fn(),
    },
}));

vi.mock('../services/movieProgressService', () => ({
    movieProgressService: { getProgress: () => null, isWatched: () => false, markWatched: vi.fn(), clearProgress: vi.fn() },
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
        on: vi.fn(), off: vi.fn(),
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

const CAPA = 'https://exemplo.invalido/capa.jpg';
const SERIE = { name: 'Série de Teste (2020)', cover: CAPA };

/** Espera o dicionário lazy (en/es) terminar de carregar. */
async function esperarIdioma(secao: string, chave: string, esperado: string) {
    for (let i = 0; i < 200; i++) {
        if (languageService.t(secao, chave) === esperado) return;
        await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`dicionario nao carregou: ${secao}.${chave}`);
}

describe('textos da ficha de série saem no idioma do app', () => {
    let container: HTMLDivElement;
    let root: Root;
    /** Resolve o `series:get-info` do modal — cada caso decide quando e com o quê. */
    let responderEpisodios: (resposta: unknown) => void;

    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        // O modal chama window.ipcRenderer.invoke sem optional chaining. Definimos
        // SÓ a propriedade — não trocamos o window do jsdom.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: {
                invoke: vi.fn(() => new Promise(resolve => { responderEpisodios = resolve; })),
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
        languageService.setLanguage('pt');
    });

    /** Monta a ficha de série aberta; ela começa carregando os episódios. */
    async function montarFicha() {
        await act(async () => {
            root.render(
                <ContentDetailModal
                    isOpen
                    onClose={() => { }}
                    contentId="7"
                    contentType="series"
                    contentData={{ name: SERIE.name, cover: CAPA }}
                    onPlay={() => { }}
                />
            );
        });
        // O setLoading(true) sai num queueMicrotask.
        await act(async () => { await Promise.resolve(); });
    }

    /** Faz o provedor responder "não deu certo" — é o ramo do aviso de erro. */
    async function falharOsEpisodios() {
        await act(async () => {
            responderEpisodios({ success: false });
            await Promise.resolve();
        });
    }

    it('em INGLES, a coluna de episodios carrega em ingles', async () => {
        languageService.setLanguage('en');
        await esperarIdioma('contentModal', 'loadingEpisodes', 'Loading episodes...');

        await montarFicha();

        expect(container.textContent?.includes('Loading episodes...')).toBe(true);
        expect(container.textContent?.includes('Carregando episódios')).toBe(false);
    });

    it('em INGLES, o aviso de falha sai em ingles — junto com o botao de tentar de novo', async () => {
        languageService.setLanguage('en');
        await esperarIdioma('contentModal', 'episodesLoadError', "⚠️ Couldn't load the episodes.");

        await montarFicha();
        await falharOsEpisodios();

        expect(container.textContent?.includes("⚠️ Couldn't load the episodes.")).toBe(true);
        expect(container.textContent?.includes('Não foi possível')).toBe(false);
        // A mistura era o defeito: aviso em português, botão em inglês.
        expect(container.textContent?.includes(languageService.t('common', 'retry'))).toBe(true);
    });

    it('em ESPANHOL, os dois textos da coluna saem em espanhol', async () => {
        languageService.setLanguage('es');
        await esperarIdioma('contentModal', 'loadingEpisodes', 'Cargando episodios...');

        await montarFicha();
        expect(container.textContent?.includes('Cargando episodios...')).toBe(true);

        await falharOsEpisodios();
        expect(container.textContent?.includes('⚠️ No se pudieron cargar los episodios.')).toBe(true);
    });

    it('em PORTUGUES, os dois textos da coluna continuam exatamente os mesmos (sem regressao)', async () => {
        await montarFicha();
        expect(container.textContent?.includes('Carregando episódios...')).toBe(true);

        await falharOsEpisodios();
        expect(container.textContent?.includes('⚠️ Não foi possível carregar os episódios.')).toBe(true);
    });
});
