import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 🎉 D193, lado do app: o `partyAdd` que o celular manda pela BUSCA do topo e
 * pelos RECOMENDADOS resolve de verdade e cai na fila da TV.
 *
 * A página do controle web passou a pôr o 🎉 nessas duas listas
 * (electron/webRemoteFilaDaFesta.test.ts prova o toque → comando). Só que o
 * bridge só enfileira o que acha em `moviesRef` — um id que ele não conhece
 * some em silêncio enquanto o celular mostra ✓. Aqui o `WebRemoteBridge` é
 * montado de verdade: ele próprio monta as listas que o celular recebe, e o
 * id que sai delas volta como `partyAdd`.
 */

const { add, recomendacoes } = vi.hoisted(() => ({
    add: vi.fn(),
    recomendacoes: vi.fn(),
}));

vi.mock('../services/queueService', () => ({ queueService: { add, has: () => false, remove: vi.fn() } }));
vi.mock('../services/recommendationService', () => ({ getHomeRecommendations: recomendacoes }));
vi.mock('../services/tmdbKey', () => ({ espelharChaveTmdbNoMain: vi.fn() }));

import { WebRemoteBridge } from './WebRemoteBridge';

const ACERVO = [
    { stream_id: 7, name: 'Recomendado', stream_icon: 'r.jpg', category_id: '1' },
    { stream_id: 42, name: 'Matrix', stream_icon: 'm.jpg', category_id: '1' },
    { stream_id: 99, name: 'Outro filme', stream_icon: '', category_id: '1' },
];

type Handler = (e: unknown, action: string, arg?: unknown, target?: unknown) => void;

let container: HTMLDivElement;
let root: Root;
let send: ReturnType<typeof vi.fn>;
let ouvintes: Map<string, Handler>;

/** O que o bridge mandou ao celular por um canal (a última vez). */
function ultimoEnvio<T>(canal: string): T | undefined {
    const chamadas = send.mock.calls.filter(c => c[0] === canal);
    return chamadas.length ? chamadas[chamadas.length - 1][1] as T : undefined;
}

/** Um comando do celular chegando, como o webRemoteServer repassa. */
function doCelular(action: string, arg?: unknown): void {
    const handler = ouvintes.get('media:control');
    expect(handler, 'o bridge escuta media:control').toBeTruthy();
    (handler as Handler)(null, action, arg);
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    add.mockReset();
    recomendacoes.mockReset();
    recomendacoes.mockResolvedValue([
        { seedName: 'Algo', items: [{ kind: 'vod', item: ACERVO[0] }] },
    ]);

    ouvintes = new Map();
    send = vi.fn();
    // Ponte do Electron: NÃO trocamos o `window` inteiro do jsdom — só
    // penduramos a ponte nele.
    (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke: vi.fn(async (canal: string) => {
            if (canal === 'streams:get-vod') return { success: true, data: ACERVO };
            if (canal === 'streams:get-series') return { success: true, data: [] };
            return null;
        }),
        on: vi.fn((canal: string, fn: Handler) => { ouvintes.set(canal, fn); }),
        off: vi.fn(),
        send,
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root.render(<WebRemoteBridge />); });
});

afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    localStorage.clear();
});

describe('fila da festa pelo controle web (D193): o app resolve o id', () => {
    it('um filme dos RECOMENDADOS entra na fila da TV — sem o catálogo ter sido aberto', async () => {
        doCelular('requestRecommended');
        await vi.waitFor(() => expect(ultimoEnvio('web-remote:recommended')).toBeTruthy());
        const { groups } = ultimoEnvio<{ groups: { items: { kind: string; id: string }[] }[] }>('web-remote:recommended')!;
        const filme = groups[0].items.find(i => i.kind === 'movie')!;

        doCelular('partyAdd', filme.id);

        await vi.waitFor(() => expect(add).toHaveBeenCalled());
        expect(add).toHaveBeenCalledWith({ id: '7', name: 'Recomendado', cover: 'r.jpg' });
    });

    it('um recomendado continua valendo depois de uma busca do topo (a busca troca o mapa)', async () => {
        doCelular('requestRecommended');
        await vi.waitFor(() => expect(ultimoEnvio('web-remote:recommended')).toBeTruthy());
        doCelular('requestCatalog', 'matrix');
        await vi.waitFor(() => expect(ultimoEnvio('web-remote:catalog')).toBeTruthy());

        doCelular('partyAdd', '7');

        await vi.waitFor(() => expect(add).toHaveBeenCalled());
        expect(add).toHaveBeenCalledWith({ id: '7', name: 'Recomendado', cover: 'r.jpg' });
    });

    it('um filme achado pela BUSCA do topo entra na fila da TV', async () => {
        doCelular('requestCatalog', 'matrix');
        await vi.waitFor(() => expect(ultimoEnvio('web-remote:catalog')).toBeTruthy());
        const { items } = ultimoEnvio<{ items: { id: string }[] }>('web-remote:catalog')!;
        expect(items.map(i => i.id)).toEqual(['42']);

        doCelular('partyAdd', items[0].id);

        await vi.waitFor(() => expect(add).toHaveBeenCalled());
        expect(add).toHaveBeenCalledWith({ id: '42', name: 'Matrix', cover: 'm.jpg' });
    });

    it('id que o app nunca mandou ao celular não vira item fantasma na fila', async () => {
        doCelular('requestCatalog', 'matrix');
        await vi.waitFor(() => expect(ultimoEnvio('web-remote:catalog')).toBeTruthy());

        // O desconhecido sai ANTES; o conhecido serve de marco: quando ele
        // chega à fila, o desconhecido já teve a mesma chance.
        doCelular('partyAdd', 'nao-existe');
        doCelular('partyAdd', '42');

        await vi.waitFor(() => expect(add).toHaveBeenCalled());
        expect(add.mock.calls).toEqual([[{ id: '42', name: 'Matrix', cover: 'm.jpg' }]]);
    });
});
