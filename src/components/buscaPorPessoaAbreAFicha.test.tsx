import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 🎭 Na busca global (Ctrl+K), clicar num resultado NORMAL abre a ficha do
 * item: o `activate` grava o termo E o pedido `{kind, id}` em
 * GLOBAL_SEARCH_OPEN_KEY, que VOD.tsx / Series.tsx consomem e abrem a ficha.
 * Já o resultado da seção "Com <pessoa>" ("@nome") gravava SÓ o termo: o
 * usuário caía na grade filtrada pelo nome e tinha de clicar de novo — duas
 * listas visualmente iguais, dois comportamentos (#D056).
 *
 * O caso monta a busca global DE VERDADE (react-dom/client + act), com o
 * `searchPersonCredits` real do tmdb.ts — só a rede (fetch), o IPC, o perfil
 * e o `navigate` são dublados — e clica no item da seção 🎭 como o usuário.
 *
 * O ouvinte do GLOBAL_SEARCH_EVENT faz o papel da página que JÁ está montada
 * (o caso "já estou em Filmes": navegar pra mesma rota não remonta nada): ele
 * lê o storage NA HORA do evento, como VOD.tsx / Series.tsx fazem. Um pedido
 * gravado depois do evento ficaria esquecido no storage e a ficha não abriria.
 */

const navegar = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => navegar }));
vi.mock('../services/profileService', () => ({
    profileService: { getActiveProfile: () => null },
}));

import {
    GlobalSearch,
    GLOBAL_SEARCH_OPEN_EVENT,
    GLOBAL_SEARCH_OPEN_KEY,
    GLOBAL_SEARCH_TERM_KEY,
    GLOBAL_SEARCH_EVENT,
} from './GlobalSearch';

const CHAVE_TMDB = 'neostream_tmdb_api_key';
const IGNORAR_ENV = 'neostream_tmdb_ignore_env';

type Pedido = { kind: string; id: number | string } | null;

/** Espera uma condição com prazo de relógio (nunca um número fixo de voltas). */
async function esperar(condicao: () => boolean, oQue: string) {
    const prazo = Date.now() + 8000;
    while (Date.now() < prazo) {
        if (condicao()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error(`nao aconteceu: ${oQue}`);
}

/** A TMDB de mentira: "Fulana de Tal" atuou no filme "Filme Um" e na série "Serie Dois". */
const fetchTmdb = vi.fn(async (url: string) => {
    const corpo = url.includes('/search/person')
        ? { results: [{ id: 7, name: 'Fulana de Tal' }] }
        : url.includes('/person/7/combined_credits')
            ? { cast: [{ title: 'Filme Um' }, { name: 'Serie Dois' }], crew: [] }
            : {};
    return { ok: true, json: async () => corpo } as unknown as Response;
});

describe('busca por pessoa ("@nome"): clicar no resultado abre a ficha, igual ao resultado normal', { timeout: 20000 }, () => {
    let container: HTMLDivElement;
    let root: Root;
    /** O que a página já montada leria no instante do evento. */
    let lidoNoEvento: Array<{ termo: string | null; pedido: Pedido }> = [];
    const paginaMontada = () => {
        lidoNoEvento.push({
            termo: sessionStorage.getItem(GLOBAL_SEARCH_TERM_KEY),
            pedido: JSON.parse(sessionStorage.getItem(GLOBAL_SEARCH_OPEN_KEY) ?? 'null') as Pedido,
        });
    };

    beforeEach(async () => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        sessionStorage.clear();
        // Simula o app instalado com a chave TMDB do usuário (sem o .env de dev).
        localStorage.setItem(IGNORAR_ENV, '1');
        localStorage.setItem(CHAVE_TMDB, 'chave-de-teste');
        navegar.mockClear();
        fetchTmdb.mockClear();
        lidoNoEvento = [];
        window.addEventListener(GLOBAL_SEARCH_EVENT, paginaMontada);
        vi.stubGlobal('fetch', fetchTmdb);
        // Só a propriedade — o window do jsdom continua o mesmo.
        Object.defineProperty(window, 'ipcRenderer', {
            configurable: true,
            writable: true,
            value: {
                invoke: vi.fn(async (canal: string) => {
                    if (canal === 'streams:get-vod') {
                        return { success: true, data: [{ stream_id: 41, name: 'Outro Filme' }, { stream_id: 42, name: 'Filme Um' }] };
                    }
                    if (canal === 'streams:get-series') {
                        return { success: true, data: [{ series_id: 77, name: 'Serie Dois' }] };
                    }
                    if (canal.startsWith('streams:') || canal.startsWith('categories:')) return { success: true, data: [] };
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
        await act(async () => { root.render(<GlobalSearch />); });
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await act(async () => { root.unmount(); });
        container.remove();
        window.removeEventListener(GLOBAL_SEARCH_EVENT, paginaMontada);
        vi.unstubAllGlobals();
        localStorage.clear();
        sessionStorage.clear();
    });

    async function abrir() {
        await act(async () => { window.dispatchEvent(new Event(GLOBAL_SEARCH_OPEN_EVENT)); });
        await esperar(() => container.querySelector('.gsearch-input') !== null, 'overlay aberto');
        await esperar(() => !container.textContent?.includes('Carregando catálogo'), 'catalogo carregado');
    }

    async function digitar(texto: string) {
        const input = container.querySelector<HTMLInputElement>('.gsearch-input');
        if (!input) throw new Error('sem campo de busca');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        await act(async () => {
            setter?.call(input, texto);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    /** O botão do item `nome` DENTRO da seção 🎭 "Com <pessoa>". */
    function itemDaPessoa(nome: string): HTMLButtonElement | null {
        const grupos = Array.from(container.querySelectorAll('.gsearch-group'));
        const grupo = grupos.find(g => g.querySelector('.gsearch-group-header')?.textContent?.includes('Fulana de Tal'));
        if (!grupo) return null;
        return Array.from(grupo.querySelectorAll<HTMLButtonElement>('button.gsearch-item'))
            .find(b => b.querySelector('.gsearch-item-name')?.textContent === nome) ?? null;
    }

    async function clicarNaPessoa(nome: string) {
        await abrir();
        await digitar('@Fulana');
        await esperar(() => itemDaPessoa(nome) !== null, `"${nome}" na secao da pessoa`);
        await act(async () => { itemDaPessoa(nome)!.click(); });
        await esperar(() => navegar.mock.calls.length > 0, 'navegar pra pagina do item');
    }

    it('filme achado por "@pessoa": vai pra Filmes E a pagina ja montada recebe o pedido da ficha daquele filme', async () => {
        await clicarNaPessoa('Filme Um');

        expect(navegar).toHaveBeenCalledWith('/dashboard/vod');
        // Um evento só, e no instante dele o storage JÁ tem o termo e o pedido:
        // é o que VOD.tsx lê pra filtrar e abrir a ficha (o id certo, não o do vizinho 41).
        expect(lidoNoEvento).toEqual([{ termo: 'Filme Um', pedido: { kind: 'vod', id: 42 } }]);
        // O overlay fecha.
        await esperar(() => container.querySelector('.gsearch-input') === null, 'overlay fechado');
    });

    it('serie achada por "@pessoa": vai pra Series E a pagina recebe o pedido da ficha daquela serie', async () => {
        await clicarNaPessoa('Serie Dois');

        expect(navegar).toHaveBeenCalledWith('/dashboard/series');
        expect(lidoNoEvento).toEqual([{ termo: 'Serie Dois', pedido: { kind: 'series', id: 77 } }]);
    });

    it('o pedido da pessoa tem o MESMO formato do pedido do resultado normal (mesmo canal, mesmos consumidores)', async () => {
        // Resultado normal: digitar o título e clicar nele.
        await abrir();
        await digitar('Filme Um');
        const normal = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button.gsearch-item'))
            .find(b => b.querySelector('.gsearch-item-name')?.textContent === 'Filme Um') ?? null;
        await esperar(() => normal() !== null, 'resultado normal');
        await act(async () => { normal()!.click(); });
        await esperar(() => navegar.mock.calls.length > 0, 'navegar (normal)');
        const pedidoNormal = lidoNoEvento[0]?.pedido;
        expect(pedidoNormal).not.toBeNull();

        sessionStorage.clear();
        navegar.mockClear();
        lidoNoEvento = [];

        await clicarNaPessoa('Filme Um');
        expect(lidoNoEvento[0]?.pedido).toEqual(pedidoNormal);
    });

    it('se o storage recusar o pedido da ficha, o clique ainda filtra a grade e navega (degrada como hoje)', async () => {
        await abrir();
        await digitar('@Fulana');
        await esperar(() => itemDaPessoa('Filme Um') !== null, '"Filme Um" na secao da pessoa');
        // Só agora (a busca já rodou): a gravação do pedido de ficha estoura.
        const gravar = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, chave: string, valor: string) {
            if (chave === GLOBAL_SEARCH_OPEN_KEY) throw new DOMException('cota', 'QuotaExceededError');
            gravar.call(this, chave, valor);
        });

        await act(async () => { itemDaPessoa('Filme Um')!.click(); });
        await esperar(() => navegar.mock.calls.length > 0, 'navegar mesmo com o storage falhando');

        expect(navegar).toHaveBeenCalledWith('/dashboard/vod');
        expect(lidoNoEvento).toEqual([{ termo: 'Filme Um', pedido: null }]);
        await esperar(() => container.querySelector('.gsearch-input') === null, 'overlay fechado');
    });
});
