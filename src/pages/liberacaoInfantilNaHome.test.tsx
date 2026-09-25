import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * 🙈 D115 na Home — o OUTRO portão de clique do perfil infantil.
 *
 * As grades de Filmes/Séries decidem o clique infantil em `useContentFiltering`
 * (coberto em settings/liberarTituloEscondido.test.tsx). A Home tem o seu
 * próprio `handleContentClick`, com dois ramos que barram a criança: o da
 * classificação em CACHE e o da resposta NOVA da TMDB. Os dois têm de respeitar
 * a liberação do responsável, senão o título liberado abre na grade de Filmes
 * e continua barrado (e escondido de novo) no card da Home.
 *
 * A Home é montada de verdade (react-dom/client + act) com o IndexedDB real
 * (fake-indexeddb). Dublês: os componentes pesados, o portão das fileiras
 * (aberto — o assunto aqui é o CLIQUE), o IPC do catálogo e a busca na TMDB.
 * O modal de detalhes é dublê que anota o título aberto: abrir o modal é o
 * "deixou passar" da Home.
 */

const abertos: string[] = [];

vi.mock('../components/ContentDetailModal', () => ({
    ContentDetailModal: (props: { contentData: { name: string } }) => {
        abertos.push(props.contentData.name);
        return null;
    },
}));
vi.mock('../components/AsyncVideoPlayer', () => ({ default: () => null }));
vi.mock('../components/NextEpisodes', () => ({ NextEpisodes: () => null }));
vi.mock('../components/ResumeModal', () => ({ ResumeModal: () => null }));
vi.mock('../components/ContinueFramePreview', () => ({ ContinueFramePreview: () => null }));
vi.mock('../services/recommendationService', () => ({
    getHomeRecommendations: vi.fn(async () => []),
}));
vi.mock('../services/traktBackfillService', () => ({ runTraktBackfill: vi.fn() }));
vi.mock('../hooks/useHomeContentGate', async (importOriginal) => {
    const real = await importOriginal<typeof import('../hooks/useHomeContentGate')>();
    return { ...real, useHomeContentGate: () => () => true };
});
vi.mock('../services/tmdb', async (importOriginal) => {
    const real = await importOriginal<typeof import('../services/tmdb')>();
    return { ...real, searchMovieByName: vi.fn(async () => null), searchSeriesByName: vi.fn(async () => null) };
});

import { Home } from './Home';
import { indexedDBCache } from '../services/indexedDBCache';
import { languageService } from '../services/languageService';
import { parentalService } from '../services/parentalService';
import { searchMovieByName } from '../services/tmdb';

const ENGANO = 'Filme Errado (2019)';
const CLASSIFICACAO_DO_OUTRO_TITULO = '18';

let container: HTMLDivElement;
let root: Root;

async function esperar(condicao: () => boolean, oQue: string) {
    const limite = Date.now() + 4000;
    while (Date.now() < limite) {
        if (condicao()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    }
    throw new Error(`nao aconteceu: ${oQue} | tela: ${(container.textContent ?? '').slice(0, 400)}`);
}

/** O card do título na fileira de filmes (o elemento que recebe o clique). */
function cardDo(titulo: string): HTMLElement | null {
    const img = Array.from(container.querySelectorAll('img')).find(i => i.getAttribute('alt') === titulo);
    return (img?.closest('div[style*="cursor: pointer"]') as HTMLElement | null) ?? null;
}

async function montarHomeInfantil() {
    localStorage.setItem('neostream_profiles', JSON.stringify({
        profiles: [{ id: 'filho', name: 'Filho', avatar: '👶', isKids: true, createdAt: 0 }],
        activeProfileId: 'filho',
    }));
    await act(async () => { root.render(<MemoryRouter><Home /></MemoryRouter>); });
    await esperar(() => cardDo(ENGANO) !== null, `o card de "${ENGANO}" aparecer na Home`);
}

/** Clica no card e espera a Home DECIDIR (abrir o modal ou mostrar o aviso). */
async function criancaClicaNoCard(): Promise<boolean> {
    abertos.length = 0;
    await act(async () => { cardDo(ENGANO)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await esperar(() => abertos.includes(ENGANO) || (container.textContent ?? '').includes(`"${ENGANO}"`),
        'a Home abrir o título ou barrar com aviso');
    return abertos.includes(ENGANO);
}

describe('D115 — a Home respeita a liberação do responsável no clique infantil', () => {
    beforeEach(async () => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.stubGlobal('__APP_VERSION__', '0.0.0-teste');
        localStorage.clear();
        sessionStorage.clear();
        languageService.setLanguage('pt');
        localStorage.setItem('neostream_resume_on_open', '0');
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: {
                invoke: vi.fn(async (canal: string) => {
                    if (canal === 'content:get-counts') return { success: true, counts: { live: 0, vod: 1, series: 0 } };
                    if (canal === 'streams:get-vod') return { success: true, data: [{ stream_id: 7, name: ENGANO, stream_icon: 'capa.jpg' }] };
                    if (canal === 'streams:get-series') return { success: true, data: [] };
                    return { success: false };
                }),
                send: vi.fn(), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(),
            },
        });
        vi.mocked(searchMovieByName).mockReset().mockResolvedValue(null);
        await indexedDBCache.clearAll();
        abertos.length = 0;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        // A Home guarda o catálogo num cache de MÓDULO.
        act(() => {
            window.dispatchEvent(new Event('neostream-catalog-refresh'));
            root.unmount();
        });
        container.remove();
        parentalService.setConfig({ enabled: false, blockAdultCategories: true });
        vi.unstubAllGlobals();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('classificação errada em CACHE: sem liberação barra e esconde; liberado, abre e não volta a esconder', async () => {
        // Cache "18" sem oculto: é o estado depois do "Mostrar todos".
        await indexedDBCache.setCacheMovie(ENGANO, CLASSIFICACAO_DO_OUTRO_TITULO, []);
        await montarHomeInfantil();

        expect(await criancaClicaNoCard()).toBe(false);
        expect(await indexedDBCache.isItemHidden('movie', ENGANO)).toBe(true);

        await indexedDBCache.liberarItem('movie', ENGANO);
        act(() => { window.dispatchEvent(new Event('neostream-catalog-refresh')); root.unmount(); });
        root = createRoot(container);
        await montarHomeInfantil();

        expect(await criancaClicaNoCard()).toBe(true);
        expect(await indexedDBCache.isItemHidden('movie', ENGANO)).toBe(false);
        expect(searchMovieByName).not.toHaveBeenCalled();
    }, 20000);

    it('resposta NOVA da TMDB: sem liberação barra; liberado, abre e a liberação sobrevive ao "esconder"', async () => {
        vi.mocked(searchMovieByName).mockResolvedValue({ certification: CLASSIFICACAO_DO_OUTRO_TITULO, genres: [] } as never);
        await montarHomeInfantil();

        expect(await criancaClicaNoCard()).toBe(false);

        // O cache "18" some (expirou), o responsável libera e a TMDB responde de novo.
        await indexedDBCache.clearAll();
        await indexedDBCache.liberarItem('movie', ENGANO);
        act(() => { window.dispatchEvent(new Event('neostream-catalog-refresh')); root.unmount(); });
        root = createRoot(container);
        await montarHomeInfantil();

        expect(await criancaClicaNoCard()).toBe(true);
        expect(searchMovieByName).toHaveBeenCalled();
        expect(await indexedDBCache.isItemHidden('movie', ENGANO)).toBe(false);
        expect(await indexedDBCache.isItemLiberado('movie', ENGANO)).toBe(true);
    }, 20000);
});
