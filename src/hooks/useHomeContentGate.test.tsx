import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { indexedDBCache } from '../services/indexedDBCache';
import { parentalService } from '../services/parentalService';
import { descreverItemDaHome, useHomeContentGate, type ItemBrutoDaHome, type ItemDaHome } from './useHomeContentGate';

/**
 * 🔒 O portão parental/infantil da Home, montado de verdade.
 *
 * A Home era a única tela de conteúdo sem portão: as cinco fileiras e a roleta
 * saíam do catálogo cru, então um filme de categoria adulta aparecia com
 * pôster na primeira tela do perfil infantil. Este hook é o portão; aqui ele
 * roda montado (`createRoot` + `act`, como em `useHls.test.tsx`), com o IPC e
 * o IndexedDB dublados.
 *
 * O que se afirma é o RESULTADO do predicado — não que tal função foi chamada.
 */
const CATEGORIAS_VOD = [
    { category_id: '9', category_name: 'FILMES ADULTOS +18' },
    { category_id: '1', category_name: 'AÇÃO' },
];
const CATEGORIAS_SERIES = [
    { category_id: '7', category_name: 'SÉRIES ADULTO' },
    { category_id: '1', category_name: 'DRAMA' },
];

const invoke = vi.fn();

function categoriasOk() {
    invoke.mockImplementation((canal: string) => {
        if (canal === 'categories:get-vod') return Promise.resolve({ success: true, data: CATEGORIAS_VOD });
        if (canal === 'categories:get-series') return Promise.resolve({ success: true, data: CATEGORIAS_SERIES });
        return Promise.resolve({ success: false });
    });
}

function parental(config: { enabled: boolean; blockAdultCategories: boolean }) {
    vi.spyOn(parentalService, 'getConfig').mockReturnValue({
        ...parentalService.getConfig(),
        enabled: config.enabled,
        blockAdultCategories: config.blockAdultCategories,
    });
    vi.spyOn(parentalService, 'isSessionUnlocked').mockReturnValue(false);
}

let container: HTMLDivElement;
let root: Root;

/** Monta o hook e devolve um getter do predicado mais recente. */
async function montar(isKids: boolean): Promise<() => (item: ItemDaHome) => boolean> {
    let atual: (item: ItemDaHome) => boolean = () => false;
    function Sonda({ kids }: { kids: boolean }) {
        atual = useHomeContentGate(kids);
        return null;
    }
    await act(async () => { root.render(<Sonda kids={isKids} />); });
    return () => atual;
}

/** Deixa as promessas do efeito assentarem (o portão carrega em duas ondas). */
async function assentar() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

const filme = (name: string, categoria?: string): ItemDaHome => ({ name, categoryIds: categoria ? [categoria] : [], kind: 'movie' });
const serie = (name: string, categoria?: string): ItemDaHome => ({ name, categoryIds: categoria ? [categoria] : [], kind: 'series' });

describe('useHomeContentGate', () => {
    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        invoke.mockReset();
        (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
        vi.spyOn(indexedDBCache, 'getHiddenItems').mockResolvedValue([]);
        vi.spyOn(indexedDBCache, 'getAllCachedMovies').mockResolvedValue(new Map());
        vi.spyOn(indexedDBCache, 'getAllCachedSeries').mockResolvedValue(new Map());
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        vi.restoreAllMocks();
    });

    it('portão desligado não toca no IPC nem no IndexedDB, e tudo passa', async () => {
        parental({ enabled: false, blockAdultCategories: false });
        categoriasOk();

        const portao = await montar(false);
        await assentar();

        expect(invoke).not.toHaveBeenCalled();
        expect(indexedDBCache.getAllCachedMovies).not.toHaveBeenCalled();
        expect(portao()(filme('Qualquer', '9'))).toBe(true);
    });

    it('parental trancado: esconde a categoria bloqueada e mantém o resto', async () => {
        parental({ enabled: true, blockAdultCategories: true });
        categoriasOk();

        const portao = await montar(false);
        await assentar();

        expect(portao()(filme('Adulto', '9'))).toBe(false);
        expect(portao()(filme('Ação', '1'))).toBe(true);
    });

    it('as listas de FILME e de SÉRIE não se cruzam', async () => {
        parental({ enabled: true, blockAdultCategories: true });
        categoriasOk();

        const portao = await montar(false);
        await assentar();

        // '9' é adulto só no VOD; '7' só nas séries.
        expect(portao()(filme('X', '9'))).toBe(false);
        expect(portao()(serie('X', '9'))).toBe(true);
        expect(portao()(serie('Y', '7'))).toBe(false);
        expect(portao()(filme('Y', '7'))).toBe(true);
    });

    it('parental trancado: esconde pela classificação já em cache', async () => {
        parental({ enabled: true, blockAdultCategories: true });
        categoriasOk();
        vi.spyOn(indexedDBCache, 'getAllCachedMovies').mockResolvedValue(new Map([['pesado', '18']]));
        vi.spyOn(parentalService, 'isContentBlocked').mockImplementation(r => r === '18');

        const portao = await montar(false);
        await assentar();

        expect(portao()(filme('Pesado', '1'))).toBe(false);
        expect(portao()(filme('Ação', '1'))).toBe(true);
    });

    it('perfil infantil: o oculto some, e oculto de filme não esconde a série homônima', async () => {
        parental({ enabled: false, blockAdultCategories: false });
        categoriasOk();
        // A chave é o nome NORMALIZADO (`normalizeContentName`: minúsculo, sem
        // pontuação — e acento some em vez de virar a letra sem acento).
        vi.spyOn(indexedDBCache, 'getHiddenItems').mockImplementation(async tipo => (tipo === 'movie' ? ['nome repetido'] : []));

        const portao = await montar(true);
        await assentar();

        expect(portao()(filme('Nome Repetido', '1'))).toBe(false);
        expect(portao()(serie('Nome Repetido', '1'))).toBe(true);
    });

    it('falha FECHADA: enquanto as categorias não chegam, nada passa', async () => {
        parental({ enabled: true, blockAdultCategories: true });
        let liberar: (v: unknown) => void = () => undefined;
        const pendente = new Promise(r => { liberar = r; });
        invoke.mockImplementation((canal: string) => {
            if (canal === 'categories:get-vod') return pendente.then(() => ({ success: true, data: CATEGORIAS_VOD }));
            return Promise.resolve({ success: true, data: CATEGORIAS_SERIES });
        });

        const portao = await montar(false);
        await assentar();

        // Categoria limpa também não passa: o portão ainda não sabe nada.
        expect(portao()(filme('Ação', '1'))).toBe(false);

        await act(async () => { liberar(null); await Promise.resolve(); await Promise.resolve(); });
        await assentar();
        expect(portao()(filme('Ação', '1'))).toBe(true);
    });

    it('falha FECHADA: categories sem sucesso mantém a Home vazia', async () => {
        parental({ enabled: true, blockAdultCategories: true });
        invoke.mockResolvedValue({ success: false });

        const portao = await montar(false);
        await assentar();

        expect(portao()(filme('Ação', '1'))).toBe(false);
    });
});

/** Item cru como a Home o tem em mãos (o catálogo traz mais campos). */
const bruto = (o: Record<string, unknown>): ItemBrutoDaHome => o;

describe('descreverItemDaHome: o que a fileira entrega ao portão', () => {
    it('"continuar assistindo" leva o tipo de DENTRO do item e a categoria do catálogo', () => {
        expect(descreverItemDaHome(bruto({ type: 'series', name: 'Série X', category_id: '66' }), 'continue'))
            .toEqual({ name: 'Série X', categoryIds: ['66'], kind: 'series' });
        expect(descreverItemDaHome(bruto({ type: 'movie', name: 'Filme X', category_id: 9 }), 'continue'))
            .toEqual({ name: 'Filme X', categoryIds: ['9'], kind: 'movie' });
    });

    it('as fileiras 🆕/🎬 levam o tipo da PRÓPRIA fileira', () => {
        expect(descreverItemDaHome(bruto({ name: 'S', category_id: '2' }), 'series').kind).toBe('series');
        expect(descreverItemDaHome(bruto({ name: 'F', category_id: '2' }), 'movie').kind).toBe('movie');
    });

    it('a fileira 💡 mistura os dois, então decide pelo series_id', () => {
        expect(descreverItemDaHome(bruto({ name: 'S', series_id: 5, category_id: '2' }), 'recommendations').kind).toBe('series');
        expect(descreverItemDaHome(bruto({ name: 'F', stream_id: 5, category_id: '2' }), 'recommendations').kind).toBe('movie');
    });

    it('categoria em lista vira texto; item SEM categoria vai com lista vazia', () => {
        expect(descreverItemDaHome(bruto({ name: 'S', category_id: ['2', 7] }), 'series').categoryIds).toEqual(['2', '7']);
        expect(descreverItemDaHome(bruto({ name: 'S' }), 'series').categoryIds).toEqual([]);
    });
});
