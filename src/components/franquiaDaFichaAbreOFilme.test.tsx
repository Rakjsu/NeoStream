import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 🎬 A franquia na ficha do filme tem que ABRIR os outros filmes que existem
 * no app (#D046).
 *
 * O rail da coleção TMDB desenhava cada parte como um `<div>` com capa e
 * título — sem clique e sem dizer quais existem no catálogo. Logo abaixo, o
 * rail "Parecidos" já fazia o certo: cruzava com o índice do catálogo e abria
 * a ficha pelo canal `pedirAberturaDeFicha`. Quem via "Homem-Aranha 2" na
 * franquia clicava e nada acontecia.
 *
 * Havia uma segunda trava, escondida: o índice do catálogo só era carregado
 * quando a ficha JÁ tinha "Parecidos" ou filmografia aberta. Numa ficha com
 * coleção e sem nenhum parecido, o índice nunca vinha — então o caso central
 * aqui é justamente esse: `/similar` volta VAZIO.
 *
 * A ficha é montada DE VERDADE (react-dom/client + act, o padrão de
 * textosDaFichaDeSerieTraduzidos.test.tsx); só o I/O (TMDB, índice, IPC) e os
 * serviços de estado são dublês. O que se afirma é o que a pessoa vê e o que
 * o clique faz.
 *
 * As pontas do invariante:
 *   1. a parte que existe no catálogo vira botão e o clique fecha esta ficha e
 *      pede a abertura da outra (rota de filmes + id do catálogo no pedido);
 *   2. a parte que NÃO existe continua visível, mas não é clicável e sai
 *      apagada;
 *   3. o próprio filme aberto não vira botão (abrir a si mesmo é só piscar);
 *   4. o índice é pedido mesmo sem nenhum "Parecido";
 *   5. provedor fora do ar (índice VAZIO, sem erro — é o que o
 *      catalogTitleIndex devolve) não apaga a franquia inteira nem diz que
 *      nada dela está no catálogo;
 *   6. remake de mesmo título na mesma franquia ("Halloween" 1978 × 2018)
 *      cai no MESMO id do catálogo que a ficha aberta: não vira botão que
 *      reabre a própria ficha.
 */

// ---------------------------------------------------------------------------
// Dublês
// ---------------------------------------------------------------------------
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const ID_NO_CATALOGO = '555';

vi.mock('../services/tmdb', () => ({
    resolveSeriesDetails: vi.fn(async () => null),
    resolveMovieDetails: vi.fn(async () => ({
        id: 10,
        title: 'Homem-Aranha',
        belongs_to_collection: { id: 99, name: 'Homem-Aranha: Coleção' },
    })),
    fetchMovieTrailer: vi.fn(async () => null),
    fetchSeriesTrailer: vi.fn(async () => null),
    fetchCollection: vi.fn(async () => ({
        id: 99,
        name: 'Homem-Aranha: Coleção',
        parts: [
            { id: 10, title: 'Homem-Aranha', poster_path: '/a.jpg', release_date: '2002-05-01' },
            { id: 11, title: 'Homem-Aranha 2', poster_path: '/b.jpg', release_date: '2004-06-30' },
            { id: 12, title: 'Homem-Aranha 3', poster_path: null, release_date: '2007-05-04' },
        ],
    })),
    // Ficha com coleção e SEM nenhum parecido: é o caso que o índice não cobria.
    fetchSimilarByTmdbId: vi.fn(async () => []),
    fetchCastByTmdbId: vi.fn(async () => []),
    fetchPersonFilmography: vi.fn(async () => []),
}));

const getCatalogTitleIndex = vi.fn(async () => ({
    // Chave já normalizada (normalizeTitle('Homem-Aranha 2') === 'homem aranha 2').
    // 'homem aranha' aponta pra OUTRA listagem do mesmo filme ('2', o provedor
    // repete com [DUB]/4K e o primeiro id vence): o que impede o filme aberto
    // de virar botão tem que ser o id TMDB, não a coincidência com contentId.
    vod: new Map([['homem aranha 2', '555'], ['homem aranha', '2']]),
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
import { resolveMovieDetails, fetchCollection } from '../services/tmdb';

/** Espera uma CONDIÇÃO (nunca um número fixo de voltas) dentro do act. */
async function esperar(condicao: () => boolean, oQue: string) {
    // Prazo em tempo de relógio, bem abaixo do timeout do caso: se a condição
    // não vier, o caso falha COM a mensagem, e o laço não sobra rodando act()
    // por cima do caso seguinte.
    const prazo = Date.now() + 2500;
    while (Date.now() < prazo) {
        if (condicao()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    }
    if (!condicao()) throw new Error(`nao aconteceu: ${oQue}`);
}

describe('franquia na ficha do filme abre os filmes que existem no app (#D046)', () => {
    let container: HTMLDivElement;
    let root: Root;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        // Só a propriedade — não trocamos o window do jsdom.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: {
                invoke: vi.fn(async () => null),
                send: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            },
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

    async function montarFichaDoFilme(nome = 'Homem-Aranha (2002)', legendaNoRail = 'Homem-Aranha 3 (2007)') {
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
        // O rail da coleção aparece quando a coleção chega do TMDB.
        await esperar(() => !!container.textContent?.includes(legendaNoRail), 'rail da coleção na tela');
    }

    /**
     * O cartão de uma parte, achado pelo que a pessoa LÊ: a legenda
     * "Título (ano)" debaixo da capa. O cartão é o pai da legenda.
     */
    const parte = (titulo: string, ano?: string): HTMLElement | null => {
        const legenda = Array.from(container.querySelectorAll('p'))
            .find(p => {
                const m = /^(.*) \((\d{4})\)$/.exec(p.textContent ?? '');
                return !!m && m[1] === titulo && (ano === undefined || m[2] === ano);
            });
        return legenda?.parentElement ?? null;
    };

    /** Cartão apagado = opacidade EXPLÍCITA abaixo de 1 (Number('') é 0 — não conta). */
    const apagada = (card: HTMLElement | null) => !!card && card.style.opacity !== '' && Number(card.style.opacity) < 1;

    /** Nenhum cartão do rail apagado nem marcado "fora do catálogo". */
    const nadaApagado = () => Array.from(container.querySelectorAll('p'))
        .filter(p => /\(\d{4}\)$/.test(p.textContent ?? ''))
        .map(p => p.parentElement as HTMLElement)
        .every(card => !apagada(card)
            && !card.title.includes('Não está no seu catálogo'));

    it('a parte que existe no catalogo vira botao e o clique abre a ficha dela', async () => {
        await montarFichaDoFilme();
        await esperar(() => parte('Homem-Aranha 2')?.tagName === 'BUTTON', 'parte do catálogo virar botão');

        const botao = parte('Homem-Aranha 2') as HTMLButtonElement;
        await act(async () => { botao.click(); });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/dashboard/vod');
        const pedido = JSON.parse(sessionStorage.getItem(GLOBAL_SEARCH_OPEN_KEY) ?? 'null') as { kind: string; id: string } | null;
        expect(pedido).toEqual({ kind: 'vod', id: ID_NO_CATALOGO });
    });

    it('o indice do catalogo e pedido mesmo sem nenhum "Parecido"', async () => {
        await montarFichaDoFilme();
        await esperar(() => getCatalogTitleIndex.mock.calls.length > 0, 'pedido do índice do catálogo');
        expect(getCatalogTitleIndex).toHaveBeenCalled();
    });

    it('a parte que NAO existe continua visivel, mas nao e clicavel e sai apagada', async () => {
        await montarFichaDoFilme();
        // Espera o índice assentar (a parte do catálogo virou botão) antes de olhar a de fora.
        await esperar(() => parte('Homem-Aranha 2')?.tagName === 'BUTTON', 'índice aplicado ao rail');

        const fora = parte('Homem-Aranha 3');
        expect(fora).not.toBeNull();
        expect(fora?.tagName).not.toBe('BUTTON');
        expect(fora?.querySelector('button')).toBeNull();
        expect(apagada(fora)).toBe(true);
        // E diz por quê, no idioma do app (pt por padrão).
        expect(fora?.title.includes('Não está no seu catálogo')).toBe(true);
        expect(container.textContent?.includes('Homem-Aranha 3')).toBe(true);
    });

    it('o proprio filme aberto nao vira botao', async () => {
        await montarFichaDoFilme();
        await esperar(() => parte('Homem-Aranha 2')?.tagName === 'BUTTON', 'índice aplicado ao rail');

        const atual = parte('Homem-Aranha');
        expect(atual).not.toBeNull();
        expect(atual?.tagName).not.toBe('BUTTON');
        // Destacado, não apagado: está no catálogo — é o que está aberto.
        expect(apagada(atual)).toBe(false);
    });

    it('o filme aberto nunca sai apagado, mesmo quando o provedor o lista com outro nome', async () => {
        // O provedor chama o filme aberto de outro jeito ("Spider-Man"): o
        // título TMDB em pt-BR não casa com nada no índice. Ele está ABERTO —
        // dizer que "não está no catálogo" seria mentira.
        getCatalogTitleIndex.mockImplementationOnce(async () => ({
            vod: new Map([['homem aranha 2', ID_NO_CATALOGO], ['spider man', '1']]),
            series: new Map<string, string>(),
        }));
        await montarFichaDoFilme();
        await esperar(() => parte('Homem-Aranha 2')?.tagName === 'BUTTON', 'índice aplicado ao rail');

        const atual = parte('Homem-Aranha');
        expect(atual).not.toBeNull();
        expect(atual?.tagName).not.toBe('BUTTON');
        expect(apagada(atual)).toBe(false);
        expect(atual?.title.includes('Não está no seu catálogo')).toBe(false);
        // E a de fora do catálogo continua apagada (o índice é de verdade).
        expect(apagada(parte('Homem-Aranha 3'))).toBe(true);
    });

    it('provedor fora do ar: indice VAZIO nao apaga a franquia nem diz que ela esta fora do catalogo', async () => {
        // É o que getCatalogTitleIndex devolve com o provedor fora do ar: os
        // invokes caem no .catch(() => null) e o índice volta com os dois Maps
        // vazios — resolvido, não rejeitado.
        getCatalogTitleIndex.mockImplementationOnce(async () => ({ vod: new Map<string, string>(), series: new Map<string, string>() }));
        await montarFichaDoFilme();
        await esperar(() => getCatalogTitleIndex.mock.results.length > 0, 'pedido do índice do catálogo');
        // Registrado DEPOIS do .then da ficha na mesma promessa: quando este
        // roda, a ficha já recebeu o índice vazio.
        let entregue = false;
        void (getCatalogTitleIndex.mock.results[0].value as Promise<unknown>).then(() => { entregue = true; });
        await esperar(() => entregue, 'índice vazio entregue à ficha');

        expect(container.textContent?.includes('Homem-Aranha 3 (2007)')).toBe(true);
        expect(nadaApagado()).toBe(true);
        expect(parte('Homem-Aranha 2')?.tagName).not.toBe('BUTTON');
    });

    it('remake de mesmo titulo que cai no id da propria ficha nao vira botao que reabre a ficha', async () => {
        // Aberta: "Halloween (2018)", id 1 no catálogo. A franquia TMDB tem
        // "Halloween" 1978 e "Halloween" 2018 — os dois normalizam pra
        // 'halloween', que no índice aponta pra ESTA ficha.
        vi.mocked(resolveMovieDetails).mockResolvedValueOnce({
            id: 20,
            title: 'Halloween',
            belongs_to_collection: { id: 77, name: 'Halloween: Coleção' },
        } as never);
        vi.mocked(fetchCollection).mockResolvedValueOnce({
            id: 77,
            name: 'Halloween: Coleção',
            parts: [
                { id: 21, title: 'Halloween', poster_path: '/h1.jpg', release_date: '1978-10-25' },
                { id: 20, title: 'Halloween', poster_path: '/h2.jpg', release_date: '2018-10-19' },
                { id: 22, title: 'Halloween Kills', poster_path: '/h3.jpg', release_date: '2021-10-15' },
            ],
        } as never);
        getCatalogTitleIndex.mockImplementationOnce(async () => ({
            vod: new Map([['halloween', '1'], ['halloween kills', '7']]),
            series: new Map<string, string>(),
        }));

        await montarFichaDoFilme('Halloween (2018)', 'Halloween Kills (2021)');
        await esperar(() => parte('Halloween Kills')?.tagName === 'BUTTON', 'índice aplicado ao rail');

        const de1978 = parte('Halloween', '1978');
        expect(de1978).not.toBeNull();
        expect(de1978?.tagName).not.toBe('BUTTON');
        expect(de1978?.querySelector('button')).toBeNull();
        // A parte que existe de fato continua abrindo a ficha dela.
        await act(async () => { (parte('Halloween Kills') as HTMLButtonElement).click(); });
        const pedido = JSON.parse(sessionStorage.getItem(GLOBAL_SEARCH_OPEN_KEY) ?? 'null') as { kind: string; id: string } | null;
        expect(pedido).toEqual({ kind: 'vod', id: '7' });
    });
});
