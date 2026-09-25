import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * 📺 O cartão "Canais" da Home no perfil infantil (#D058).
 *
 * O cartão mostrava o total do provedor. Havia um "desconto" que subtraía as
 * chaves `live_` do conjunto de itens ocultos — mas esse conjunto só recebe
 * `movie_` e `series_` (o indexedDBCache só oculta filme e série), então a
 * conta era sempre `total - 0`. A criança lia "10 canais" e, ao clicar, a
 * grade da TV ao vivo mostrava só os das categorias infantis.
 *
 * Aqui a Home é montada DE VERDADE (react-dom/client + act). Só são dublês os
 * componentes pesados, o portão das fileiras (aberto — não é o assunto) e o
 * IPC do catálogo. Perfil, parental e `contentGate` são os reais.
 *
 * O que se afirma é o número NO CARTÃO:
 *   1. infantil → só os canais que a grade da TV ao vivo mostraria;
 *   2. infantil com canais marcados 👶 → só esses;
 *   3. infantil com o provedor fora do ar (canais OU categorias) → "—",
 *      nunca o total do provedor;
 *   4. adulto → o total do provedor, sem baixar a lista de canais;
 *   5. infantil com parental valendo → a categoria adulta fica de fora (e
 *      volta com a sessão destravada pelo PIN ou com o bloqueio de
 *      categoria desligado), como na grade;
 *   6. catálogo atualizado → a conta é refeita, e a resposta VELHA que
 *      chega atrasada não pisa na nova;
 *   7. enquanto a conta não chega → "...", e não "—" (que quer dizer falha).
 */

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
vi.mock('../hooks/useHomeContentGate', async (importOriginal) => {
    const real = await importOriginal<typeof import('../hooks/useHomeContentGate')>();
    return { ...real, useHomeContentGate: () => () => true };
});

import { Home } from './Home';
import { languageService } from '../services/languageService';
import { parentalService } from '../services/parentalService';

const PERFIL = 'perfil-contagem';

// 10 canais no provedor: 3 numa categoria infantil, 7 fora dela.
const CATEGORIAS = [
    { category_id: '1', category_name: 'Infantil' },
    { category_id: '2', category_name: 'Esportes' },
];
const CANAIS = [
    ...[101, 102, 103].map(id => ({ stream_id: id, name: `Canal Infantil ${id}`, category_id: '1' })),
    ...[201, 202, 203, 204, 205, 206, 207].map(id => ({ stream_id: id, name: `Canal Esporte ${id}`, category_id: '2' })),
];
const TOTAL_DO_PROVEDOR = CANAIS.length;

let container: HTMLDivElement;
let root: Root;
let invoke: ReturnType<typeof vi.fn>;

async function esperar(condicao: () => boolean, oQue: string) {
    const limite = Date.now() + 4000;
    while (Date.now() < limite) {
        if (condicao()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    }
    throw new Error(`nao aconteceu: ${oQue} | tela: ${(container.textContent ?? '').slice(0, 600)}`);
}

/** O número exibido num cartão de contagem (o primeiro link para a rota). */
function numeroDoCartao(rota: string): string | null {
    const cartao = container.querySelector<HTMLAnchorElement>(`a[href="${rota}"]`);
    if (!cartao) return null;
    const divs = cartao.querySelectorAll('div');
    return (divs[1]?.textContent ?? '').trim();
}

/** O número exibido no cartão "Canais" (link para a TV ao vivo). */
const numeroDoCartaoDeCanais = () => numeroDoCartao('#/dashboard/live');

function ativarPerfil(perfil: { isKids: boolean; allowedChannelIds?: string[] }) {
    localStorage.setItem('neostream_profiles', JSON.stringify({
        profiles: [{ id: PERFIL, name: 'Perfil', avatar: '🙂', createdAt: 0, ...perfil }],
        activeProfileId: PERFIL,
    }));
}

function semearIpc(opts: {
    canaisOk: boolean;
    categoriasOk?: boolean;
    canais?: typeof CANAIS;
    categorias?: typeof CATEGORIAS;
}) {
    const canais = opts.canais ?? CANAIS;
    const categorias = opts.categorias ?? CATEGORIAS;
    invoke = vi.fn(async (canal: string) => {
        if (canal === 'content:get-counts') return { success: true, counts: { live: TOTAL_DO_PROVEDOR, vod: 0, series: 0 } };
        if (canal === 'streams:get-series') return { success: true, data: [] };
        if (canal === 'streams:get-vod') return { success: true, data: [] };
        if (canal === 'streams:get-live') return opts.canaisOk ? { success: true, data: canais } : { success: false, error: 'offline' };
        if (canal === 'categories:get-live') {
            return opts.categoriasOk === false ? { success: false, error: 'offline' } : { success: true, data: categorias };
        }
        return { success: false };
    });
    // Só a PROPRIEDADE ipcRenderer — o window do jsdom continua o mesmo.
    Object.defineProperty(window, 'ipcRenderer', {
        configurable: true,
        writable: true,
        value: { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn(), removeListener: vi.fn() },
    });
}

/** Troca a resposta de UM canal do IPC, mantendo as demais. */
function sobrescreverCanal(alvo: string, resposta: () => unknown) {
    const base = invoke.getMockImplementation() as ((canal: string, ...resto: unknown[]) => unknown) | undefined;
    invoke.mockImplementation(async (canal: string, ...resto: unknown[]) =>
        (canal === alvo ? resposta() : base?.(canal, ...resto)));
}

/** Monta a Home e espera o cartão sair do "..." (contagem assentada). */
async function montarEsperandoCartao(): Promise<string | null> {
    await act(async () => {
        root.render(<MemoryRouter><Home /></MemoryRouter>);
    });
    await esperar(() => {
        const n = numeroDoCartaoDeCanais();
        return n !== null && n !== '' && n !== '...';
    }, 'o cartao de canais mostrar um valor');
    return numeroDoCartaoDeCanais();
}

describe('cartao "Canais" da Home no perfil infantil', () => {
    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.stubGlobal('__APP_VERSION__', '0.0.0-teste');
        localStorage.clear();
        sessionStorage.clear();
        languageService.setLanguage('pt');
        localStorage.setItem('neostream_resume_on_open', '0');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        // A Home guarda o catálogo (e as contagens) num cache de MÓDULO.
        act(() => {
            window.dispatchEvent(new Event('neostream-catalog-refresh'));
            root.unmount();
        });
        container.remove();
        // O parentalService é um singleton que guarda a config em memória:
        // limpar o localStorage não basta.
        parentalService.setConfig({ enabled: false, blockAdultCategories: true });
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('infantil: mostra so os canais das categorias infantis, nao o total do provedor', async () => {
        ativarPerfil({ isKids: true });
        semearIpc({ canaisOk: true });
        expect(await montarEsperandoCartao()).toBe('3');
    }, 15000);

    it('infantil com canais marcados: mostra so os marcados', async () => {
        ativarPerfil({ isKids: true, allowedChannelIds: ['101'] });
        semearIpc({ canaisOk: true });
        expect(await montarEsperandoCartao()).toBe('1');
    }, 15000);

    it('infantil com o provedor fora do ar: mostra "—", nunca o total do provedor', async () => {
        ativarPerfil({ isKids: true });
        semearIpc({ canaisOk: false });
        const valor = await montarEsperandoCartao();
        expect(valor).not.toBe(String(TOTAL_DO_PROVEDOR));
        expect(valor).toBe('—');
    }, 15000);

    it('infantil com a chamada dos canais estourando: mostra "—", nao fica em "..." pra sempre', async () => {
        ativarPerfil({ isKids: true });
        semearIpc({ canaisOk: true });
        sobrescreverCanal('streams:get-live', () => Promise.reject(new Error('ipc caiu')));
        expect(await montarEsperandoCartao()).toBe('—');
    }, 15000);

    it('infantil com as categorias fora do ar: mostra "—", nunca o total do provedor', async () => {
        // Sem categorias a whitelist infantil fica vazia — e vazia não filtra
        // nada. A grade da TV ao vivo cai na tela de erro nesse caso; o
        // cartão não pode contar os 10.
        ativarPerfil({ isKids: true });
        semearIpc({ canaisOk: true, categoriasOk: false });
        expect(await montarEsperandoCartao()).toBe('—');
    }, 15000);

    // Conta sem nenhuma categoria infantil: a whitelist fica vazia e não
    // filtra (o mesmo fallback da grade) — então quem segura o adulto é o
    // parental, como na TV ao vivo.
    const SEM_INFANTIL = [
        { category_id: '2', category_name: 'Esportes' },
        { category_id: '3', category_name: 'Adultos' },
    ];
    const CANAIS_SEM_INFANTIL = [
        ...[201, 202, 203, 204].map(id => ({ stream_id: id, name: `Canal Esporte ${id}`, category_id: '2' })),
        ...[301, 302].map(id => ({ stream_id: id, name: `Canal Adulto ${id}`, category_id: '3' })),
    ];

    it('infantil com parental valendo: a categoria adulta fica fora da conta', async () => {
        parentalService.setConfig({ enabled: true, blockAdultCategories: true });
        ativarPerfil({ isKids: true });
        semearIpc({ canaisOk: true, canais: CANAIS_SEM_INFANTIL, categorias: SEM_INFANTIL });
        expect(await montarEsperandoCartao()).toBe('4');
    }, 15000);

    it('infantil com a sessao destravada pelo PIN: a categoria adulta volta a contar', async () => {
        parentalService.setConfig({ enabled: true, blockAdultCategories: true });
        parentalService.unlockSession();
        ativarPerfil({ isKids: true });
        semearIpc({ canaisOk: true, canais: CANAIS_SEM_INFANTIL, categorias: SEM_INFANTIL });
        expect(await montarEsperandoCartao()).toBe('6');
    }, 15000);

    it('infantil com parental ligado mas sem bloqueio de categoria: a adulta conta', async () => {
        parentalService.setConfig({ enabled: true, blockAdultCategories: false });
        ativarPerfil({ isKids: true });
        semearIpc({ canaisOk: true, canais: CANAIS_SEM_INFANTIL, categorias: SEM_INFANTIL });
        expect(await montarEsperandoCartao()).toBe('6');
    }, 15000);

    it('infantil: enquanto a conta nao chega o cartao mostra "...", nao "—"', async () => {
        ativarPerfil({ isKids: true });
        semearIpc({ canaisOk: true });
        let soltar: (v: unknown) => void = () => {};
        const pendente = new Promise(resolve => { soltar = resolve; });
        sobrescreverCanal('streams:get-live', () => pendente);
        await act(async () => {
            root.render(<MemoryRouter><Home /></MemoryRouter>);
        });
        // O cartão de filmes sair do "..." = a Home terminou de carregar.
        await esperar(() => numeroDoCartao('#/dashboard/vod') === '0', 'a Home terminar de carregar');
        expect(numeroDoCartaoDeCanais()).toBe('...');
        soltar({ success: true, data: CANAIS });
        await esperar(() => numeroDoCartaoDeCanais() === '3', 'a conta chegar');
    }, 15000);

    it('infantil: quando o catalogo e atualizado, a conta e refeita', async () => {
        ativarPerfil({ isKids: true });
        semearIpc({ canaisOk: true });
        expect(await montarEsperandoCartao()).toBe('3');
        // Um canal infantil novo chega na atualização periódica do catálogo.
        semearIpc({
            canaisOk: true,
            canais: [...CANAIS, { stream_id: 104, name: 'Canal Infantil 104', category_id: '1' }],
        });
        act(() => { window.dispatchEvent(new Event('neostream-catalog-refresh')); });
        await esperar(() => numeroDoCartaoDeCanais() === '4', 'o cartao refazer a conta depois da atualizacao');
        expect(numeroDoCartaoDeCanais()).toBe('4');
    }, 15000);

    it('infantil: a resposta velha que chega depois da atualizacao nao pisa na conta nova', async () => {
        ativarPerfil({ isKids: true });
        semearIpc({ canaisOk: true });
        let soltarAVelha: (v: unknown) => void = () => {};
        const velha = new Promise(resolve => { soltarAVelha = resolve; });
        // A resposta velha avisa quando a conta dela for lida: dali até o
        // setState é tudo síncrono, então "lida" = "já tentou gravar".
        let velhaLida = false;
        const respostaVelha = { success: true, get data() { velhaLida = true; return CANAIS; } };
        const novos = [...CANAIS, { stream_id: 104, name: 'Canal Infantil 104', category_id: '1' }];
        let chamadas = 0;
        sobrescreverCanal('streams:get-live', () => {
            chamadas++;
            return chamadas === 1 ? velha : Promise.resolve({ success: true, data: novos });
        });
        await act(async () => {
            root.render(<MemoryRouter><Home /></MemoryRouter>);
        });
        await esperar(() => chamadas === 1, 'a primeira busca de canais sair');
        act(() => { window.dispatchEvent(new Event('neostream-catalog-refresh')); });
        await esperar(() => numeroDoCartaoDeCanais() === '4', 'a conta nova aparecer');
        soltarAVelha(respostaVelha);
        await esperar(() => velhaLida, 'a resposta velha ser processada');
        expect(numeroDoCartaoDeCanais()).toBe('4');
    }, 15000);

    it('adulto: mostra o total do provedor e nao baixa a lista de canais', async () => {
        ativarPerfil({ isKids: false });
        semearIpc({ canaisOk: true });
        expect(await montarEsperandoCartao()).toBe(String(TOTAL_DO_PROVEDOR));
        expect(invoke.mock.calls.some(([canal]) => canal === 'streams:get-live')).toBe(false);
    }, 15000);
});
