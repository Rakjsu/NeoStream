import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 🔒 O aviso de bloqueio do perfil infantil tem que sair NO IDIOMA DO APP.
 *
 * A frase "<título> não está disponível para este perfil" existia em duas
 * cópias: a da Home, montada por `t('home','notAvailableForProfile')`, e a do
 * `useContentFiltering` — o gate de clique das grades de Filmes e Séries —,
 * cravada em português dentro da template string. Quem usa o app em inglês ou
 * espanhol clicava num título bloqueado e recebia a frase em português, embora
 * a MESMA frase já estivesse traduzida nos três dicionários.
 *
 * Estes casos montam o hook DE VERDADE (react-dom/client + act, o padrão de
 * src/hooks/useHls.test.tsx), põem o app em inglês/espanhol, clicam num título
 * que a TMDB classificou como adulto e leem a mensagem que o hook devolve.
 * Não há casamento de string sobre o código-fonte: o que se afirma é o texto
 * que a pessoa lê na tela.
 *
 * As três pontas do invariante:
 *   1. em inglês/espanhol sai o texto daquele idioma;
 *   2. em português o texto continua o mesmo de antes (sem regressão);
 *   3. a frase é montada com a MESMA chave que a Home usa — trocar a chave (ou
 *      a seção) de um dos lados faz as duas telas divergirem, e derruba o caso.
 */

const CERTIFICACAO_ADULTA = '18';

// ---------------------------------------------------------------------------
// Dublês só das dependências de I/O do hook (IndexedDB, TMDB, parental).
// `isKidsFriendly` fica REAL: é ela quem decide o bloqueio.
// ---------------------------------------------------------------------------
vi.mock('../services/indexedDBCache', () => ({
    indexedDBCache: {
        getHiddenItems: vi.fn(async () => [] as string[]),
        getAllCachedMovies: vi.fn(async () => new Map<string, string | null>()),
        getAllCachedSeries: vi.fn(async () => new Map<string, string | null>()),
        getCachedMovie: vi.fn(async () => ({ certification: CERTIFICACAO_ADULTA, genres: [] })),
        getCachedSeries: vi.fn(async () => ({ certification: CERTIFICACAO_ADULTA, genres: [] })),
        setCacheMovie: vi.fn(async () => undefined),
        setCacheSeries: vi.fn(async () => undefined),
        hideItem: vi.fn(async () => undefined),
    },
}));

vi.mock('../services/parentalService', () => ({
    parentalService: {
        getConfig: () => ({ enabled: false, blockAdultCategories: false }),
        isSessionUnlocked: () => false,
        isContentBlocked: () => false,
    },
}));

vi.mock('../services/tmdb', async (importOriginal) => {
    const real = await importOriginal<typeof import('../services/tmdb')>();
    return { ...real, searchMovieByName: vi.fn(async () => null), searchSeriesByName: vi.fn(async () => null) };
});

import { useContentFiltering } from './useContentFiltering';
import { languageService } from '../services/languageService';

interface Filme { name: string }
const FILME: Filme = { name: 'Filme Proibido (2020)' };
// Referência estável: o hook recarrega as classificações a cada `items` novo
// (as páginas passam uma lista memoizada); um literal no render realimentaria
// o efeito para sempre.
const ITENS: Filme[] = [FILME];

type ApiDoHook = ReturnType<typeof useContentFiltering<Filme>>;
/** Vitrine do que o hook devolveu no último render (publicada num efeito). */
const vitrine: { api: ApiDoHook | null } = { api: null };
let liberou = false;

function Grade() {
    const api = useContentFiltering<Filme>({
        contentType: 'movie',
        isKidsProfile: true,
        items: ITENS,
        getItemName: f => f.name,
        getItemCategoryIds: () => [],
        onAllowed: () => { liberou = true; },
    });
    // Publicar num efeito (e não no corpo do render) mantém o render puro; o
    // act() esvazia os efeitos antes de devolver o controle ao teste.
    useEffect(() => { vitrine.api = api; });
    return null;
}

/** Espera o dicionário lazy (en/es) terminar de carregar. */
async function esperarIdioma(secao: string, chave: string, esperado: string) {
    for (let i = 0; i < 200; i++) {
        if (languageService.t(secao, chave) === esperado) return;
        await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`dicionario nao carregou: ${secao}.${chave}`);
}

/** Monta a grade, clica no título bloqueado e devolve a mensagem exibida. */
async function mensagemDoCliqueBloqueado(root: Root): Promise<string | null> {
    liberou = false;
    await act(async () => { root.render(<Grade />); });
    await act(async () => { await vitrine.api!.handleItemClick(FILME); });
    expect(liberou).toBe(false); // o clique de fato foi bloqueado
    return vitrine.api!.blockMessage;
}

describe('aviso de bloqueio do perfil infantil nas grades de catalogo', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        // O hook chama window.ipcRenderer.invoke sem optional chaining. Definimos
        // SÓ a propriedade — não trocamos o window do jsdom.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: { invoke: vi.fn(async () => ({ success: false })), send: vi.fn() },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        vitrine.api = null;
        languageService.setLanguage('pt');
    });

    it('com o app em INGLES, sai a frase inglesa (e nao a portuguesa)', async () => {
        languageService.setLanguage('en');
        await esperarIdioma('home', 'notAvailableForProfile', 'is not available for this profile');

        const mensagem = await mensagemDoCliqueBloqueado(root);

        expect(mensagem).toBe(`"${FILME.name}" is not available for this profile`);
        expect(mensagem?.includes('não está disponível')).toBe(false);
    });

    it('com o app em ESPANHOL, sai a frase espanhola', async () => {
        languageService.setLanguage('es');
        await esperarIdioma('home', 'notAvailableForProfile', 'no está disponible para este perfil');

        const mensagem = await mensagemDoCliqueBloqueado(root);

        expect(mensagem).toBe(`"${FILME.name}" no está disponible para este perfil`);
    });

    it('em PORTUGUES o texto continua exatamente o mesmo (sem regressao)', async () => {
        const mensagem = await mensagemDoCliqueBloqueado(root);

        expect(mensagem).toBe(`"${FILME.name}" não está disponível para este perfil`);
    });

    it('a frase vem da MESMA chave que a Home usa — as duas telas nunca divergem', async () => {
        // Segunda ponta: a Home monta `"nome" + t('home','notAvailableForProfile')`
        // (src/pages/Home.tsx). Trocar a seção ou a chave num dos lados derruba
        // este caso — inclusive quando a troca cai num fallback que "parece" certo.
        languageService.setLanguage('en');
        await esperarIdioma('home', 'notAvailableForProfile', 'is not available for this profile');

        const mensagem = await mensagemDoCliqueBloqueado(root);
        const comoAHomeMonta = `"${FILME.name}" ${languageService.t('home', 'notAvailableForProfile')}`;

        expect(mensagem).toBe(comoAHomeMonta);
    });
});
