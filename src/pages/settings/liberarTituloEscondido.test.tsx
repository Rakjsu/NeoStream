import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fonteDaPonteWeb from '../../components/WebRemoteBridge.tsx?raw';
import fonteDaVitrine from '../../components/ShowcaseScreensaver.tsx?raw';

/**
 * 🙈 D115 — um título escondido POR ENGANO no perfil infantil tem de poder
 * voltar, e voltar de verdade.
 *
 * O filtro infantil pergunta à TMDB por NOME (com o ano entre parênteses).
 * Quando a busca casa o título errado, a classificação adulta do outro título
 * vai para o cache de certificação (30 dias) e o nome vai para `hidden_items`.
 * O #457 deu ao responsável o "Mostrar todos", que zera `hidden_items` — mas o
 * cache de certificação continua dizendo "18": no primeiro clique da criança
 * o título é barrado e escondido DE NOVO. Não havia como dizer "este título eu
 * conferi, pode passar".
 *
 * Aqui tudo é de verdade — IndexedDB (fake-indexeddb), a seção de Controle
 * Parental montada com react-dom/client, o hook das grades de Filmes/Séries, o
 * portão das fileiras da Home e `isKidsFriendly`. Só a busca na TMDB é dublê
 * (e nem é chamada: o título já tem classificação em cache, que é justamente o
 * caso do engano). O clique da Home tem arquivo próprio
 * (pages/liberacaoInfantilNaHome.test.tsx).
 *
 * O que se afirma:
 *   1. a seção lista CADA título escondido e o responsável libera um só;
 *   2. liberado, a criança clica e ABRE — o cache "18" não o esconde de novo,
 *      nem o caminho de fundo que roda no perfil adulto;
 *   3. com a seção trancada por PIN, a criança não se libera sozinha;
 *   4. "voltar a esconder" desfaz a liberação;
 *   5. "Mostrar todos" não apaga as liberações do responsável;
 *   6. com o Controle Parental LIGADO, o filtro de classificação não esconde
 *      da grade infantil (Filmes/Séries e Home) o que o responsável liberou —
 *      e continua escondendo tudo o mais, inclusive no perfil adulto.
 */

vi.mock('../../services/tmdb', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../services/tmdb')>();
    return { ...real, searchMovieByName: vi.fn(async () => null), searchSeriesByName: vi.fn(async () => null) };
});

import { ParentalSection } from './ParentalSection';
import { useContentFiltering } from '../../hooks/useContentFiltering';
import { useHomeContentGate, type ItemDaHome } from '../../hooks/useHomeContentGate';
import { indexedDBCache } from '../../services/indexedDBCache';
import { parentalService } from '../../services/parentalService';
import { languageService } from '../../services/languageService';

const ENGANO = 'Filme Errado (2019)';
const ADULTO = 'Filme Adulto de Verdade';
const CLASSIFICACAO_DO_OUTRO_TITULO = '18';

const PERFIS = {
    profiles: [
        { id: 'pai', name: 'Pai', avatar: '👨', isKids: false, createdAt: 0 },
        { id: 'filho', name: 'Filho', avatar: '👶', isKids: true, createdAt: 0 },
    ],
    activeProfileId: 'pai',
};

const rotulo = (chave: string) => languageService.t('parental', chave);

let container: HTMLDivElement;
let root: Root;

async function esperarAte(cond: () => boolean, oQue: string) {
    for (let i = 0; i < 400; i++) {
        if (cond()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error(`esperei demais: ${oQue} | tela: ${(container.textContent ?? '').slice(0, 400)}`);
}

async function clicar(elemento: HTMLElement) {
    await act(async () => { elemento.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

/** O botão da linha do título `titulo` na lista de escondidos. */
function botaoDoTitulo(titulo: string): HTMLButtonElement | null {
    const botoes = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    return botoes.find(b => b.closest('[data-titulo-oculto]')?.getAttribute('data-titulo-oculto') === titulo) ?? null;
}

async function abrirSecao() {
    await act(async () => { root.render(<ParentalSection />); });
    await esperarAte(() => botaoDoTitulo(ENGANO) !== null, `a seção listar "${ENGANO}" com um botão próprio`);
}

async function fecharSecao() {
    await act(async () => { root.render(<></>); });
}

/** Esconde um título do jeito que o filtro faz: certificação em cache + oculto. */
async function esconderComoOFiltro(nome: string) {
    await indexedDBCache.setCacheMovie(nome, CLASSIFICACAO_DO_OUTRO_TITULO, []);
    await indexedDBCache.hideItem('movie', nome);
}

/** Controle Parental ligado, até 12 anos: um "18" em cache esconde da grade. */
function ligarParental() {
    parentalService.setConfig({ enabled: true, maxRating: '12', blockAdultCategories: true });
}

// ---------------------------------------------------------------------------
// A grade de Filmes (o hook real).
// ---------------------------------------------------------------------------
interface Filme { name: string }
const ITENS: Filme[] = [{ name: ENGANO }, { name: ADULTO }];
const vitrine: { api: ReturnType<typeof useContentFiltering<Filme>> | null } = { api: null };
const abertos: string[] = [];

function Grade({ infantil }: { infantil: boolean }) {
    const api = useContentFiltering<Filme>({
        contentType: 'movie',
        isKidsProfile: infantil,
        items: ITENS,
        getItemName: f => f.name,
        getItemCategoryIds: () => [],
        onAllowed: f => { abertos.push(f.name); },
    });
    useEffect(() => { vitrine.api = api; });
    return null;
}

/** Monta a grade do zero e espera as classificações em cache chegarem. */
async function montarGrade(infantil: boolean) {
    vitrine.api = null;
    await act(async () => { root.render(<Grade key={Math.random()} infantil={infantil} />); });
    await esperarAte(() => vitrine.api?.cachedRatings.has('filme adulto de verdade') === true,
        'a grade carregar as classificações em cache');
}

/** Monta a grade infantil do zero e clica no título. Devolve se abriu. */
async function criancaClica(nome: string): Promise<boolean> {
    abertos.length = 0;
    await montarGrade(true);
    await act(async () => { await vitrine.api!.handleItemClick({ name: nome }); });
    return abertos.includes(nome);
}

// ---------------------------------------------------------------------------
// O portão das fileiras da Home (o hook real).
// ---------------------------------------------------------------------------
const portaoDaHome: { ver: ((item: ItemDaHome) => boolean) | null } = { ver: null };

function FileirasDaHome({ infantil }: { infantil: boolean }) {
    const ver = useHomeContentGate(infantil);
    useEffect(() => { portaoDaHome.ver = ver; });
    return null;
}

const naHome = (name: string): ItemDaHome => ({ name, categoryIds: [], kind: 'movie' });

describe('D115 — liberar um título escondido por engano no perfil infantil', () => {
    beforeEach(async () => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('neostream_profiles', JSON.stringify(PERFIS));
        // O parentalService guarda a config em memória: sem isto o PIN de um
        // caso vazaria para o seguinte e trancaria a seção.
        parentalService.setConfig({ enabled: false, pinHash: null, pinSalt: null, maxRating: '18', blockAdultCategories: true });
        languageService.setLanguage('pt');
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            // Categorias respondem (sem nenhuma adulta): o portão da Home só
            // abre com a lista de categorias em mãos.
            value: { invoke: vi.fn(async () => ({ success: true, data: [] })), send: vi.fn(), on: vi.fn(), off: vi.fn() },
        });
        await indexedDBCache.clearAll();
        await esconderComoOFiltro(ENGANO);
        await esconderComoOFiltro(ADULTO);
        vitrine.api = null;
        portaoDaHome.ver = null;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        parentalService.setConfig({ enabled: false, pinHash: null, pinSalt: null, maxRating: '18', blockAdultCategories: true });
    });

    it('a seção lista cada título escondido, com o nome como o provedor mostra', async () => {
        await abrirSecao();

        expect(botaoDoTitulo(ENGANO)!.textContent).toContain(rotulo('releaseTitle'));
        expect(botaoDoTitulo(ADULTO)).not.toBeNull();
    });

    it('liberado pelo responsável, a criança clica e o título ABRE (o cache "18" não o esconde de novo)', async () => {
        // Antes: barrado.
        expect(await criancaClica(ENGANO)).toBe(false);

        await abrirSecao();
        await clicar(botaoDoTitulo(ENGANO)!);
        await esperarAte(() => botaoDoTitulo(ENGANO)?.textContent?.includes(rotulo('undoRelease')) === true,
            'o botão virar "voltar a esconder"');
        await fecharSecao();

        expect(await criancaClica(ENGANO)).toBe(true);
        expect(vitrine.api!.blockMessage).toBeNull();
        expect(vitrine.api!.isItemVisible({ name: ENGANO })).toBe(true);
        // Não voltou para a lista de escondidos — nem depois do clique.
        expect(await indexedDBCache.getHiddenItems('movie')).toEqual(['filme adulto de verdade']);
        expect(await indexedDBCache.isItemHidden('movie', ENGANO)).toBe(false);

        // O outro, que ninguém liberou, continua barrado.
        expect(await criancaClica(ADULTO)).toBe(false);
    });

    it('a classificação automática não passa por cima da liberação (caminho de fundo do perfil adulto)', async () => {
        await indexedDBCache.liberarItem('movie', ENGANO);

        // É o que o clique no perfil adulto e a Home fazem com um "18".
        await indexedDBCache.hideItem('movie', ENGANO);

        expect(await indexedDBCache.isItemHidden('movie', ENGANO)).toBe(false);
        expect(await indexedDBCache.isItemLiberado('movie', ENGANO)).toBe(true);
        expect(await criancaClica(ENGANO)).toBe(true);
    });

    it('com a seção trancada por PIN, o botão de liberar não libera nada', async () => {
        parentalService.setConfig({ enabled: true, maxRating: 'L' });
        await parentalService.setPin('1234');
        parentalService.lockParentalSettings();
        sessionStorage.clear();

        await abrirSecao();
        const botao = botaoDoTitulo(ENGANO)!;
        expect(botao.disabled).toBe(true);
        await clicar(botao);

        expect(await indexedDBCache.isItemLiberado('movie', ENGANO)).toBe(false);
        expect(await criancaClica(ENGANO)).toBe(false);
    });

    it('"voltar a esconder" desfaz a liberação', async () => {
        await indexedDBCache.liberarItem('movie', ENGANO);

        await abrirSecao();
        expect(botaoDoTitulo(ENGANO)!.textContent).toContain(rotulo('undoRelease'));
        await clicar(botaoDoTitulo(ENGANO)!);
        await esperarAte(() => botaoDoTitulo(ENGANO)?.textContent?.includes(rotulo('releaseTitle')) === true,
            'o botão voltar a oferecer "liberar"');
        await fecharSecao();

        expect(await indexedDBCache.isItemHidden('movie', ENGANO)).toBe(true);
        expect(await criancaClica(ENGANO)).toBe(false);
    });

    it('"Mostrar todos" zera os escondidos automáticos e preserva o que o responsável liberou', async () => {
        await indexedDBCache.liberarItem('movie', ENGANO);

        await indexedDBCache.clearHiddenItems();

        expect(await indexedDBCache.getHiddenItems('movie')).toEqual([]);
        expect(await indexedDBCache.isItemLiberado('movie', ENGANO)).toBe(true);
        const entradas = await indexedDBCache.listHiddenEntries();
        expect(entradas.map(e => [e.titulo, e.liberado])).toEqual([[ENGANO, true]]);
    });

    it('parental LIGADO: a grade infantil de Filmes mostra o liberado e esconde o resto pela classificação', async () => {
        ligarParental();
        await indexedDBCache.liberarItem('movie', ENGANO);
        // Sem o oculto, sobra SÓ a classificação "18" para esconder o ADULTO.
        await indexedDBCache.unhideItem('movie', ADULTO);

        await montarGrade(true);
        expect(vitrine.api!.isItemVisible({ name: ENGANO })).toBe(true);
        expect(vitrine.api!.isItemVisible({ name: ADULTO })).toBe(false);

        // No perfil adulto a liberação infantil não afrouxa o parental.
        await montarGrade(false);
        await esperarAte(() => vitrine.api?.cachedRatings.has('filme errado 2019') === true,
            'a grade adulta carregar a classificação do liberado');
        expect(vitrine.api!.isItemVisible({ name: ENGANO })).toBe(false);
    });

    it('parental LIGADO: as fileiras da Home do perfil infantil mostram o liberado e escondem o resto', async () => {
        ligarParental();
        await indexedDBCache.liberarItem('movie', ENGANO);
        await indexedDBCache.unhideItem('movie', ADULTO);

        await act(async () => { root.render(<FileirasDaHome infantil={true} />); });
        // O portão nasce fechado (tudo false) e abre quando carrega.
        await esperarAte(() => portaoDaHome.ver?.(naHome(ENGANO)) === true, 'o portão da Home mostrar o liberado');
        expect(portaoDaHome.ver!(naHome(ADULTO))).toBe(false);
    });

    it('a leitura em lote só tira do mapa os LIBERADOS, do tipo pedido, e só quando pedido', async () => {
        await indexedDBCache.setCacheSeries(ENGANO, CLASSIFICACAO_DO_OUTRO_TITULO, []);
        await indexedDBCache.liberarItem('movie', ENGANO);

        const filmesInfantil = await indexedDBCache.getAllCachedMovies({ ignorarLiberados: true });
        expect([...filmesInfantil.keys()]).toEqual(['filme adulto de verdade']);

        const filmesAdulto = await indexedDBCache.getAllCachedMovies();
        expect([...filmesAdulto.keys()].sort()).toEqual(['filme adulto de verdade', 'filme errado 2019']);

        // A série de mesmo nome não foi liberada: a classificação dela fica.
        const series = await indexedDBCache.getAllCachedSeries({ ignorarLiberados: true });
        expect(series.get('filme errado 2019')).toBe(CLASSIFICACAO_DO_OUTRO_TITULO);
    });

    it('o controle web e a vitrine pedem a leitura em lote do mesmo jeito que as grades', () => {
        // Os dois montam o portão com as mesmas peças; montá-los inteiros para
        // um parâmetro seria bem mais caro que o que se protege.
        const ponte = fonteDaPonteWeb.replace(/\r\n/g, '\n');
        expect(ponte.includes('const opcoes = { ignorarLiberados: state.isKidsProfile };')).toBe(true);
        expect(ponte.includes('indexedDBCache.getAllCachedSeries(opcoes)')).toBe(true);
        expect(ponte.includes('indexedDBCache.getAllCachedMovies(opcoes)')).toBe(true);

        const vitrineFonte = fonteDaVitrine.replace(/\r\n/g, '\n');
        expect(vitrineFonte.includes('indexedDBCache.getAllCachedMovies({ ignorarLiberados: isKidsProfile })')).toBe(true);
    });
});
