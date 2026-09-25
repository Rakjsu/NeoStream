import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * 📣 O selo "Novo Ep!" no card do "Continuar assistindo" (#D055).
 *
 * O card tinha o selo desenhado e traduzido nos três idiomas, mas a condição
 * dele lia um campo (`hasNewEpisode`) que NINGUÉM escrevia: a lista do
 * continuar era montada sem ele, e as séries com episódio novo moravam em
 * outro estado (o da fileira "Novos episódios") que nunca era cruzado com o
 * continuar. Resultado: a série que a pessoa está assistindo ganhava episódio
 * novo e o card dela continuava mudo.
 *
 * Aqui a Home é montada DE VERDADE (react-dom/client + act). A detecção de
 * episódio novo roda pelo serviço real (`newEpisodesService` + perfil real no
 * localStorage): a série tem uma linha de base "visto em T" e o provedor
 * devolve `last_modified` > T. Só são dublês os componentes pesados (player,
 * ficha, próximos episódios), o portão parental (aberto) e o IPC do catálogo.
 *
 * O que se afirma é o que aparece NA FILEIRA do continuar:
 *   1. série seguida com episódio novo → o card dela mostra o selo;
 *   2. série seguida SEM episódio novo → sem selo (não é enfeite fixo), e o
 *      FILME em andamento cujo stream_id é IGUAL ao series_id da série
 *      atualizada também fica sem selo (ids de filme e de série são espaços
 *      diferentes no Xtream; o selo é de série);
 *   3. a fileira "Novos episódios" mostra só as 20 mais recentes, mas o selo
 *      não pode herdar esse corte: a série em andamento que é a 21ª da lista
 *      de atualizadas continua com o selo no próprio card — e a fileira e a
 *      notificação nativa seguem com as MESMAS 20 de antes (o corte não
 *      some por tabela).
 */

// ---------------------------------------------------------------------------
// Dublês: componentes pesados e I/O. A lógica de "episódio novo" fica REAL.
// ---------------------------------------------------------------------------
vi.mock('../components/ContentDetailModal', () => ({ ContentDetailModal: () => null }));
vi.mock('../components/AsyncVideoPlayer', () => ({ default: () => null }));
vi.mock('../components/NextEpisodes', () => ({ NextEpisodes: () => null }));
vi.mock('../components/ResumeModal', () => ({ ResumeModal: () => null }));
vi.mock('../components/ContinueFramePreview', () => ({ ContinueFramePreview: () => null }));
vi.mock('../services/recommendationService', () => ({
    getHomeRecommendations: vi.fn(async () => []),
}));
vi.mock('../services/traktBackfillService', () => ({ runTraktBackfill: vi.fn() }));
vi.mock('../services/indexedDBCache', () => ({
    indexedDBCache: {
        getHiddenItems: vi.fn(async () => [] as string[]),
        isItemHidden: vi.fn(async () => false),
        getCachedMovie: vi.fn(async () => null),
        getCachedSeries: vi.fn(async () => null),
        setCacheMovie: vi.fn(async () => undefined),
        setCacheSeries: vi.fn(async () => undefined),
        hideItem: vi.fn(async () => undefined),
        getAllCachedMovies: vi.fn(async () => new Map()),
        getAllCachedSeries: vi.fn(async () => new Map()),
    },
}));
// Portão aberto: este teste é sobre o selo, não sobre o parental. O
// `descreverItemDaHome` continua o real.
vi.mock('../hooks/useHomeContentGate', async (importOriginal) => {
    const real = await importOriginal<typeof import('../hooks/useHomeContentGate')>();
    return { ...real, useHomeContentGate: () => () => true };
});

import { Home } from './Home';
import { watchProgressService, type SeriesProgress } from '../services/watchProgressService';
import { movieProgressService } from '../services/movieProgressService';
import { playlistScopedKey } from '../services/activePlaylistService';
import { languageService } from '../services/languageService';
import { newEpisodeNotifier } from '../services/newEpisodeNotifier';

const PERFIL = 'perfil-selo';
const VISTO_EM = 1_700_000_000; // epoch em SEGUNDOS, como o last_modified

interface SerieFake { series_id: number; name: string; cover: string; category_id: string; last_modified: string }

const SERIE_COM_NOVO: SerieFake = { series_id: 101, name: 'Serie Com Episodio Novo', cover: '', category_id: '1', last_modified: String(VISTO_EM + 3600) };
const SERIE_SEM_NOVO: SerieFake = { series_id: 202, name: 'Serie Em Dia', cover: '', category_id: '1', last_modified: String(VISTO_EM) };
// Mesmo número que o series_id da série atualizada, de propósito.
const FILME = { stream_id: 101, name: 'Filme Pela Metade', stream_icon: '', category_id: '2' };

/**
 * 20 séries seguidas que também ganharam episódio — TODAS mais recentes que a
 * SERIE_COM_NOVO, que assim vira a 21ª da lista de atualizadas.
 */
const VINTE_MAIS_RECENTES: SerieFake[] = Array.from({ length: 20 }, (_, i) => ({
    series_id: 1000 + i,
    name: `Outra Serie Atualizada ${String(i).padStart(2, '0')}`,
    cover: '',
    category_id: '1',
    last_modified: String(VISTO_EM + 7200 + i),
}));

function progressoDe(serie: SerieFake, quando: number): SeriesProgress {
    return {
        seriesId: String(serie.series_id),
        seriesName: serie.name,
        lastWatchedSeason: 1,
        lastWatchedEpisode: 3,
        lastWatchedAt: quando,
        episodeCount: 3,
        completedCount: 2,
    };
}

const rotuloDoSelo = () => languageService.t('home', 'newEpisode');
const tituloDoContinuar = () => languageService.t('home', 'continueWatching');
const tituloDosNovos = () => languageService.t('home', 'newEpisodes');

let container: HTMLDivElement;
let root: Root;

/** Espera uma CONDIÇÃO (nunca um número fixo de voltas). */
async function esperar(condicao: () => boolean, oQue: string) {
    const limite = Date.now() + 4000;
    while (Date.now() < limite) {
        if (condicao()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    }
    throw new Error(`nao aconteceu: ${oQue} | tela: ${(container.textContent ?? '').slice(0, 600)}`);
}

/** A seção (carrossel) cujo título contém `titulo`. */
function secao(titulo: string): HTMLElement | null {
    const secoes = Array.from(container.querySelectorAll<HTMLElement>('[data-carousel-section]'));
    return secoes.find(s => (s.textContent ?? '').includes(titulo)) ?? null;
}

/** O card (dentro da fileira do continuar) que exibe `nome`. */
function cardDoContinuar(nome: string): HTMLElement | null {
    const fileira = secao(tituloDoContinuar());
    if (!fileira) return null;
    const cards = Array.from(fileira.querySelectorAll<HTMLElement>('.content-card'));
    return cards.find(c => (c.textContent ?? '').includes(nome)) ?? null;
}

const temSelo = (card: HTMLElement | null) => (card?.textContent ?? '').includes(rotuloDoSelo());

/**
 * A detecção de episódio novo JÁ RODOU: a fileira "Novos episódios" lista
 * `nome`. Esperar por ela separa "a detecção ainda não terminou" de "o card
 * do continuar não mostra o selo".
 */
async function esperarDeteccao(nome: string) {
    await esperar(
        () => (secao(tituloDosNovos())?.textContent ?? '').includes(nome),
        `a fileira Novos episodios listar ${nome}`
    );
}

/**
 * Semeia o catálogo e o progresso. `series` são todas seguidas (em andamento)
 * e já têm linha de base em VISTO_EM; a ordem do continuar segue a do array.
 */
function semear(series: SerieFake[]) {
    localStorage.setItem(
        playlistScopedKey('neostream_series_seen', PERFIL),
        JSON.stringify(Object.fromEntries(series.map(s => [String(s.series_id), VISTO_EM])))
    );
    vi.spyOn(watchProgressService, 'getContinueWatching').mockReturnValue(new Map(
        series.map((s, i) => [String(s.series_id), progressoDe(s, 10_000 - i)])
    ));
    vi.spyOn(watchProgressService, 'isSeriesCompleted').mockReturnValue(false);
    vi.spyOn(movieProgressService, 'getMoviesInProgress').mockReturnValue([String(FILME.stream_id)]);
    vi.spyOn(movieProgressService, 'getMoviePositionById').mockReturnValue({
        currentTime: 600, duration: 6000, progress: 10, watchedAt: 1_000,
    } as ReturnType<typeof movieProgressService.getMoviePositionById>);

    // Só a PROPRIEDADE ipcRenderer — o window do jsdom continua o mesmo.
    Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        writable: true,
        value: {
            invoke: vi.fn(async (canal: string) => {
                if (canal === 'content:get-counts') return { success: true, counts: { live: 0, vod: 1, series: series.length } };
                if (canal === 'streams:get-series') return { success: true, data: series };
                if (canal === 'streams:get-vod') return { success: true, data: [FILME] };
                return { success: false };
            }),
            send: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            removeListener: vi.fn(),
        },
    });
}

async function montarHome(nomesNoContinuar: string[]) {
    await act(async () => {
        root.render(<MemoryRouter><Home /></MemoryRouter>);
    });
    await esperar(
        () => nomesNoContinuar.every(n => cardDoContinuar(n) !== null),
        `os cards do continuar assistindo (${nomesNoContinuar.join(', ')})`
    );
}

describe('selo "Novo Ep!" no Continuar assistindo da Home', () => {
    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        // Constante que o Vite injeta no build (rodapé da Home).
        vi.stubGlobal('__APP_VERSION__', '0.0.0-teste');
        localStorage.clear();
        sessionStorage.clear();
        languageService.setLanguage('pt');

        // Perfil real ativo — é por ele que o newEpisodesService acha a sua chave.
        localStorage.setItem('neostream_profiles', JSON.stringify({
            profiles: [{ id: PERFIL, name: 'Adulto', avatar: '🙂', isKids: false, createdAt: 0 }],
            activeProfileId: PERFIL,
        }));
        // Sem o "Retomar ao abrir" disputando a tela com o nome do item.
        localStorage.setItem('neostream_resume_on_open', '0');

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        // A Home guarda o catálogo num cache de MÓDULO (5 min). Sem invalidá-lo,
        // o caso seguinte montaria com as séries do anterior. O próprio evento
        // de "catálogo atualizado" da Home zera o cache; a desmontagem no mesmo
        // act descarta a recarga que ele agendaria.
        act(() => {
            window.dispatchEvent(new Event('neostream-catalog-refresh'));
            root.unmount();
        });
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('a serie em andamento que ganhou episodio novo mostra o selo no proprio card', async () => {
        semear([SERIE_COM_NOVO, SERIE_SEM_NOVO]);
        await montarHome([SERIE_COM_NOVO.name, SERIE_SEM_NOVO.name, FILME.name]);
        await esperarDeteccao(SERIE_COM_NOVO.name);
        expect(temSelo(cardDoContinuar(SERIE_COM_NOVO.name))).toBe(true);
    }, 15000);

    it('a serie em dia e o filme de mesmo id NAO ganham o selo (nao e enfeite fixo)', async () => {
        semear([SERIE_COM_NOVO, SERIE_SEM_NOVO]);
        await montarHome([SERIE_COM_NOVO.name, SERIE_SEM_NOVO.name, FILME.name]);
        // Só afirma AUSÊNCIA depois que a detecção comprovadamente rodou.
        await esperarDeteccao(SERIE_COM_NOVO.name);
        expect(temSelo(cardDoContinuar(SERIE_COM_NOVO.name))).toBe(true);
        expect(temSelo(cardDoContinuar(SERIE_SEM_NOVO.name))).toBe(false);
        expect(temSelo(cardDoContinuar(FILME.name))).toBe(false);
    }, 15000);

    it('a serie que ficou fora do corte de 20 da fileira Novos episodios mantem o selo no continuar', async () => {
        semear([SERIE_COM_NOVO, ...VINTE_MAIS_RECENTES]);
        const avisos = vi.spyOn(newEpisodeNotifier, 'maybeNotify');
        await montarHome([SERIE_COM_NOVO.name, VINTE_MAIS_RECENTES[0].name]);
        // A detecção rodou (a mais recente está na fileira) e o corte existe:
        // a SERIE_COM_NOVO, a 21ª, NÃO aparece na fileira...
        await esperarDeteccao(VINTE_MAIS_RECENTES[19].name);
        expect((secao(tituloDosNovos())?.textContent ?? '').includes(SERIE_COM_NOVO.name)).toBe(false);
        // ...mas o card dela no continuar continua avisando.
        expect(temSelo(cardDoContinuar(SERIE_COM_NOVO.name))).toBe(true);
        // A notificação nativa recebe as mesmas 20 da fileira, não a lista toda.
        const aviso = avisos.mock.calls.at(-1)?.[0] ?? [];
        expect(aviso.length).toBe(20);
        expect(aviso.some(s => s.id === String(SERIE_COM_NOVO.series_id))).toBe(false);
    }, 15000);
});
