import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 🍿 Os rails TMDB da ficha (Parecidos, filmografia do ator, franquia) têm que
 * achar o filme que o provedor lista com o nome SUJO (#D169).
 *
 * O provedor pendura ano, idioma e qualidade no nome: "Oppenheimer 2023
 * Dublado", "Extermínio 4K". A busca por ator da Ctrl+K já casava isso
 * (`matchCatalogByTitles`: igualdade OU prefixo), mas a ficha fazia
 * `index.get(normalizeTitle(titulo))` — igualdade exata. Resultado: o rail
 * "Parecidos" vinha curto ou nem aparecia, a filmografia do ator idem, e a
 * parte da franquia que EXISTE no app saía apagada como "não está no seu
 * catálogo".
 *
 * Mas o prefixo cru não serve pra ficha: um card aqui é um CLIQUE que abre um
 * id. "Toy Story" não pode abrir "Toy Story 2", e a parte de 2007 da franquia
 * não pode abrir a listagem "... 2012". Por isso a sobra depois do título tem
 * que ser ruído de provedor (ano compatível, idioma, qualidade). E o ano do
 * TMDB vai junto nos TRÊS rails: o remake "RoboCop" de 2014 não abre a
 * listagem "RoboCop 1987 Dublado".
 *
 * A ficha é montada DE VERDADE (react-dom/client + act, mesmo padrão de
 * franquiaDaFichaAbreOFilme.test.tsx); só o I/O e os serviços de estado são
 * dublês. O índice do catálogo é o formato real (chave = normalizeTitle do
 * nome do provedor).
 */

// ---------------------------------------------------------------------------
// Dublês
// ---------------------------------------------------------------------------
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('../services/tmdb', () => ({
    resolveSeriesDetails: vi.fn(async () => null),
    resolveMovieDetails: vi.fn(async () => ({ id: 10, title: 'Interestelar' })),
    fetchMovieTrailer: vi.fn(async () => null),
    fetchSeriesTrailer: vi.fn(async () => null),
    fetchCollection: vi.fn(async () => null),
    fetchSimilarByTmdbId: vi.fn(async () => []),
    fetchCastByTmdbId: vi.fn(async () => []),
    fetchPersonFilmography: vi.fn(async () => []),
}));

// Chaves no formato REAL do índice: normalizeTitle(nome do provedor).
const getCatalogTitleIndex = vi.fn(async () => ({
    vod: new Map([
        ['oppenheimer 2023 dublado', '71'], // normalizeTitle('Oppenheimer - 2023 - Dublado')
        ['toy story 2', '72'],              // SÓ a sequência existe no app
        ['duna', '73'],                     // nome limpo: igualdade exata
        ['exterminio 4k', '74'],            // normalizeTitle('Extermínio 4K')
        ['robocop 1987 dublado', '75'],     // SÓ o original de 1987 existe no app
    ]),
    series: new Map<string, string>(),
}));
vi.mock('../services/catalogTitleIndex', () => ({
    getCatalogTitleIndex: () => getCatalogTitleIndex(),
}));

vi.mock('../services/watchProgressService', () => ({
    watchProgressService: {
        getSeriesProgress: () => null,
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
        isMovieInQueue: () => false,
        isEpisodeInQueue: () => false,
        isDownloaded: () => false,
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
import { GLOBAL_SEARCH_OPEN_KEY } from './GlobalSearch';
import {
    resolveMovieDetails,
    fetchCollection,
    fetchSimilarByTmdbId,
    fetchCastByTmdbId,
    fetchPersonFilmography,
} from '../services/tmdb';

/** Espera uma CONDIÇÃO (nunca um número fixo de voltas) dentro do act. */
async function esperar(condicao: () => boolean, oQue: string) {
    const prazo = Date.now() + 2500;
    while (Date.now() < prazo) {
        if (condicao()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    }
    if (!condicao()) throw new Error(`nao aconteceu: ${oQue}`);
}

/** Promessa do índice já entregue à ficha (o .then dela roda antes deste). */
async function esperarIndiceEntregue() {
    await esperar(() => getCatalogTitleIndex.mock.results.length > 0, 'pedido do índice do catálogo');
    let entregue = false;
    void (getCatalogTitleIndex.mock.results[0].value as Promise<unknown>).then(() => { entregue = true; });
    await esperar(() => entregue, 'índice entregue à ficha');
}

const poster = (n: number) => `/p${n}.jpg`;

describe('rails TMDB da ficha casam o nome sujo do provedor (#D169)', () => {
    let container: HTMLDivElement;
    let root: Root;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        // Só a propriedade — não trocamos o window do jsdom.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: { invoke: vi.fn(async () => null), send: vi.fn(), on: vi.fn(), off: vi.fn() },
        });
        navigate.mockClear();
        getCatalogTitleIndex.mockClear();
        onClose = vi.fn<() => void>();
        try { sessionStorage.clear(); } catch { /* sem storage */ }
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        container.remove();
    });

    async function montarFicha(nome = 'Interestelar (2014)') {
        await act(async () => {
            root.render(
                <ContentDetailModal
                    isOpen
                    onClose={onClose}
                    contentId="1"
                    contentType="movie"
                    contentData={{ name: nome, cover: 'https://exemplo.invalido/capa.jpg' }}
                    onPlay={() => { }}
                />
            );
        });
    }

    const card = (titulo: string) => container.querySelector<HTMLButtonElement>(`button[title="${titulo}"]`);
    const pedidoDeAbertura = () =>
        JSON.parse(sessionStorage.getItem(GLOBAL_SEARCH_OPEN_KEY) ?? 'null') as { kind: string; id: string } | null;

    it('"Parecidos": o filme listado como "Oppenheimer 2023 Dublado" aparece e abre a ficha dele', async () => {
        vi.mocked(fetchSimilarByTmdbId).mockResolvedValueOnce([
            { id: 1, title: 'Oppenheimer', poster_path: poster(1), release_date: '2023-07-19' },
            { id: 3, title: 'Duna', poster_path: poster(3) },
        ]);
        await montarFicha();
        await esperar(() => !!card('Duna'), 'rail Parecidos com o título de nome limpo');
        await esperarIndiceEntregue();

        const oppenheimer = card('Oppenheimer');
        expect(oppenheimer).not.toBeNull();
        await act(async () => { oppenheimer!.click(); });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/dashboard/vod');
        expect(pedidoDeAbertura()).toEqual({ kind: 'vod', id: '71' });
    });

    it('"Parecidos": o rail aparece mesmo quando TODOS os títulos só existem com sufixo', async () => {
        // Antes: igualdade exata não achava nada e o rail inteiro sumia.
        vi.mocked(fetchSimilarByTmdbId).mockResolvedValueOnce([
            { id: 1, title: 'Oppenheimer', poster_path: poster(1) },
            { id: 4, title: 'Extermínio', poster_path: poster(4) },
        ]);
        await montarFicha();
        await esperar(() => !!card('Oppenheimer') && !!card('Extermínio'), 'rail Parecidos com os dois títulos sujos');
        expect(container.textContent?.includes('Parecidos com este')).toBe(true);
    });

    it('"Parecidos": sequência e remake NÃO viram card que abre a outra obra', async () => {
        vi.mocked(fetchSimilarByTmdbId).mockResolvedValueOnce([
            { id: 2, title: 'Toy Story', poster_path: poster(2), release_date: '1995-11-22' },
            { id: 5, title: 'RoboCop', poster_path: poster(5), release_date: '2014-02-07' },
            { id: 3, title: 'Duna', poster_path: poster(3) },
        ]);
        await montarFicha();
        await esperar(() => !!card('Duna'), 'rail Parecidos');
        await esperarIndiceEntregue();
        expect(card('Toy Story')).toBeNull(); // só "Toy Story 2" existe no app
        expect(card('RoboCop')).toBeNull();   // só o de 1987 existe no app
    });

    it('filmografia do ator: os filmes com nome sujo aparecem e abrem a ficha certa; o remake não', async () => {
        vi.mocked(fetchCastByTmdbId).mockResolvedValueOnce([
            { id: 900, name: 'Cillian Murphy', character: 'J. Robert Oppenheimer', profile_path: null },
        ]);
        vi.mocked(fetchPersonFilmography).mockResolvedValueOnce([
            { id: 1, title: 'Oppenheimer', poster_path: poster(1), release_date: '2023-07-19' },
            { id: 4, title: 'Extermínio', poster_path: poster(4), release_date: '2002-11-01' },
            { id: 5, title: 'RoboCop', poster_path: poster(5), release_date: '2014-02-07' },
        ]);
        await montarFicha();
        await esperar(() => !!container.querySelector('button[title^="Cillian Murphy"]'), 'elenco na tela');
        await act(async () => { container.querySelector<HTMLButtonElement>('button[title^="Cillian Murphy"]')!.click(); });
        await esperar(() => !!card('Extermínio'), 'filmografia com o título sujo');

        expect(container.textContent?.includes('Filmes de Cillian Murphy')).toBe(true);
        await act(async () => { card('Extermínio')!.click(); });
        expect(pedidoDeAbertura()).toEqual({ kind: 'vod', id: '74' });
        expect(card('Oppenheimer')).not.toBeNull();
        expect(card('RoboCop')).toBeNull(); // remake de 2014 ≠ listagem de 1987
    });

    it('franquia: a parte listada com ano e idioma abre; a de ano DIFERENTE continua fora', async () => {
        vi.mocked(resolveMovieDetails).mockResolvedValueOnce({
            id: 10,
            title: 'Homem-Aranha',
            belongs_to_collection: { id: 99, name: 'Homem-Aranha: Coleção' },
        } as never);
        vi.mocked(fetchCollection).mockResolvedValueOnce({
            id: 99,
            name: 'Homem-Aranha: Coleção',
            parts: [
                { id: 10, title: 'Homem-Aranha', poster_path: '/a.jpg', release_date: '2002-05-01' },
                { id: 11, title: 'Homem-Aranha 2', poster_path: '/b.jpg', release_date: '2004-06-30' },
                { id: 12, title: 'Homem-Aranha 3', poster_path: null, release_date: '2007-05-04' },
            ],
        } as never);
        getCatalogTitleIndex.mockImplementationOnce(async () => ({
            vod: new Map([
                ['homem aranha', '1'],
                ['homem aranha 2 2004 dublado', '555'],
                // Mesmo título, ano que NÃO é o da parte de 2007: outra obra.
                ['homem aranha 3 2012 dublado', '666'],
            ]),
            series: new Map<string, string>(),
        }));
        await montarFicha('Homem-Aranha (2002)');
        await esperar(() => !!container.textContent?.includes('Homem-Aranha 3 (2007)'), 'rail da franquia');
        await esperarIndiceEntregue();

        const parte2 = card('Homem-Aranha 2');
        expect(parte2).not.toBeNull();
        await act(async () => { parte2!.click(); });
        expect(pedidoDeAbertura()).toEqual({ kind: 'vod', id: '555' });
        expect(card('Homem-Aranha 3')).toBeNull();
    });
});
