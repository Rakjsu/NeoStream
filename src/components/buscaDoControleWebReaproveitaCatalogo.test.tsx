import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 🔎 D106: a busca do topo do controle web, a cada pausa da digitação (300 ms
 * de debounce na página do celular), manda TRÊS comandos juntos —
 * `requestCatalog`, `requestSeries` e `requestLiveSearch`. Cada um trazia a
 * lista INTEIRA do provedor pelo IPC (`streams:get-vod`/`-series`/`-live`,
 * clonagem estrutural do acervo todo) e refazia `toLowerCase()` em cada nome.
 *
 * O `WebRemoteBridge` é montado de verdade e os comandos chegam como o
 * webRemoteServer os repassa. O que se prova:
 *   - buscas seguidas reusam as listas (uma ida ao IPC por catálogo);
 *   - o GATE continua relido a cada busca (trancar o parental vale na hora,
 *     mesmo com a lista guardada);
 *   - a lista guardada vence e volta a ser buscada;
 *   - falha do IPC não fica guardada — e a falha de um pedido VELHO não
 *     derruba o pedido novo do mesmo canal;
 *   - desmontar solta o prazo armado (nenhum timer sobra).
 */

vi.mock('../services/tmdbKey', () => ({ espelharChaveTmdbNoMain: vi.fn() }));

import { WebRemoteBridge } from './WebRemoteBridge';
import { parentalService } from '../services/parentalService';

const FILMES = [
    { stream_id: 42, name: 'Matrix', stream_icon: 'm.jpg', category_id: '1' },
    { stream_id: 43, name: 'Matrix Reloaded', stream_icon: '', category_id: '1' },
    { stream_id: 50, name: 'Filme Adulto da Matrix', stream_icon: '', category_id: '9' },
    { stream_id: 99, name: 'Outro filme', stream_icon: '', category_id: '1' },
];
const CATEGORIAS_VOD = [
    { category_id: '1', category_name: 'Ação' },
    { category_id: '9', category_name: 'Adultos XXX' },
];
const SERIES = [
    { series_id: 7, name: 'The Matrix Animatrix', cover: 'a.jpg', category_id: '2' },
    { series_id: 8, name: 'Dark', cover: '', category_id: '2' },
];
const CANAIS = [
    { stream_id: 1, name: 'MATRIX TV HD', stream_icon: 'l.png', category_id: '3' },
    { stream_id: 2, name: 'Globo', stream_icon: '', category_id: '3' },
];

const TTL_MS = 30_000;

type Handler = (e: unknown, action: string, arg?: unknown, target?: unknown) => void;

let container: HTMLDivElement;
let root: Root | null;
let send: ReturnType<typeof vi.fn>;
let invoke: ReturnType<typeof vi.fn>;
let ouvintes: Map<string, Handler>;
/** Respostas do main por canal; a função permite simular uma falha pontual. */
let respostas: Record<string, () => unknown>;

function chamadasDe(canal: string): number {
    return invoke.mock.calls.filter(c => c[0] === canal).length;
}

function enviosDe<T>(canal: string): T[] {
    return send.mock.calls.filter(c => c[0] === canal).map(c => c[1] as T);
}

function doCelular(action: string, arg?: unknown): void {
    const handler = ouvintes.get('media:control');
    expect(handler, 'o bridge escuta media:control').toBeTruthy();
    act(() => { (handler as Handler)(null, action, arg); });
}

interface Envio { query?: string; items: { id: string; name: string }[] }

/** A busca do topo: os três comandos da mesma rajada, como a página manda. */
async function buscaDoTopo(texto: string): Promise<{ filmes: Envio; series: Envio; canais: Envio }> {
    const antes = {
        filmes: enviosDe('web-remote:catalog').length,
        series: enviosDe('web-remote:series').length,
        canais: enviosDe('web-remote:live-results').length,
    };
    doCelular('requestCatalog', texto);
    doCelular('requestSeries', texto);
    doCelular('requestLiveSearch', texto);
    // Espera a CONDIÇÃO: as três respostas desta rajada chegaram.
    await vi.waitFor(() => {
        expect(enviosDe('web-remote:catalog').length).toBe(antes.filmes + 1);
        expect(enviosDe('web-remote:series').length).toBe(antes.series + 1);
        expect(enviosDe('web-remote:live-results').length).toBe(antes.canais + 1);
    });
    return {
        filmes: enviosDe<Envio>('web-remote:catalog').at(-1)!,
        series: enviosDe<Envio>('web-remote:series').at(-1)!,
        canais: enviosDe<Envio>('web-remote:live-results').at(-1)!,
    };
}

const nomes = (envio: Envio) => envio.items.map(i => i.name);

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    localStorage.clear();
    sessionStorage.clear();
    parentalService.setConfig({ enabled: false, blockAdultCategories: true });
    parentalService.lockSession();

    respostas = {
        'streams:get-vod': () => ({ success: true, data: FILMES }),
        'streams:get-series': () => ({ success: true, data: SERIES }),
        'streams:get-live': () => ({ success: true, data: CANAIS }),
        'categories:get-vod': () => ({ success: true, data: CATEGORIAS_VOD }),
        'categories:get-series': () => ({ success: true, data: [] }),
        'categories:get-live': () => ({ success: true, data: [] }),
    };
    ouvintes = new Map();
    send = vi.fn();
    invoke = vi.fn(async (canal: string) => (respostas[canal] ? respostas[canal]() : null));
    // Ponte do Electron: NÃO trocamos o `window` inteiro do jsdom — só
    // penduramos a ponte nele.
    (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke,
        on: vi.fn((canal: string, fn: Handler) => { ouvintes.set(canal, fn); }),
        off: vi.fn(),
        send,
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    const novo = createRoot(container);
    root = novo;
    act(() => { novo.render(<WebRemoteBridge />); });
});

afterEach(() => {
    if (root) { const r = root; act(() => { r.unmount(); }); }
    root = null;
    container.remove();
    vi.useRealTimers();
    parentalService.setConfig({ enabled: false });
    parentalService.lockSession();
    localStorage.clear();
    sessionStorage.clear();
});

describe('busca do topo do controle web (D106): não arrasta os catálogos a cada pausa', () => {
    it('duas buscas seguidas trazem cada catálogo UMA vez pelo IPC — e os resultados continuam certos', async () => {
        const primeira = await buscaDoTopo('mat');
        expect(nomes(primeira.filmes)).toEqual(['Matrix', 'Matrix Reloaded', 'Filme Adulto da Matrix']);
        expect(nomes(primeira.series)).toEqual(['The Matrix Animatrix']);
        expect(nomes(primeira.canais)).toEqual(['MATRIX TV HD']);

        const segunda = await buscaDoTopo('  MATRIX r');
        expect(segunda.filmes.query).toBe('  MATRIX r');
        expect(nomes(segunda.filmes)).toEqual(['Matrix Reloaded']);
        expect(nomes(segunda.series)).toEqual([]);
        expect(nomes(segunda.canais)).toEqual([]);

        const terceira = await buscaDoTopo('dark');
        expect(nomes(terceira.series)).toEqual(['Dark']);

        expect(chamadasDe('streams:get-vod')).toBe(1);
        expect(chamadasDe('streams:get-series')).toBe(1);
        expect(chamadasDe('streams:get-live')).toBe(1);
    });

    it('a rajada que chega junta divide a mesma ida ao IPC (pedidos simultâneos)', async () => {
        doCelular('requestCatalog', 'mat');
        doCelular('requestCatalog', 'matr');
        await vi.waitFor(() => expect(enviosDe('web-remote:catalog').length).toBe(2));
        expect(chamadasDe('streams:get-vod')).toBe(1);
    });

    it('o GATE é relido a cada busca: trancar o parental vale na hora, com a lista guardada', async () => {
        parentalService.setConfig({ enabled: true, blockAdultCategories: true });
        parentalService.unlockSession();

        const destravado = await buscaDoTopo('matrix');
        expect(nomes(destravado.filmes)).toContain('Filme Adulto da Matrix');

        parentalService.lockSession();
        const trancado = await buscaDoTopo('matrix');
        expect(nomes(trancado.filmes)).toEqual(['Matrix', 'Matrix Reloaded']);

        // O mapa que o castMovie resolve é o retrato da lista que o celular
        // recebeu: o liberado resolve, o bloqueado não...
        const resultadosDeCast = () => enviosDe('web-remote:cast-result').length;
        doCelular('castMovie', '42');
        await vi.waitFor(() => expect(resultadosDeCast()).toBe(1));
        expect(chamadasDe('streams:get-vod-url')).toBe(1);
        doCelular('castMovie', '50');
        await vi.waitFor(() => expect(resultadosDeCast()).toBe(2));
        expect(chamadasDe('streams:get-vod-url')).toBe(1);
        // ...nem depois de destravar: o id 50 não saiu na última lista enviada.
        parentalService.unlockSession();
        doCelular('castMovie', '50');
        await vi.waitFor(() => expect(resultadosDeCast()).toBe(3));
        expect(chamadasDe('streams:get-vod-url')).toBe(1);

        expect(chamadasDe('streams:get-vod')).toBe(1);
    });

    it(`a lista guardada vence em ${TTL_MS / 1000} s e volta a ser buscada`, async () => {
        await buscaDoTopo('mat');
        act(() => { vi.advanceTimersByTime(TTL_MS / 2); });
        await buscaDoTopo('matr');
        expect(chamadasDe('streams:get-vod')).toBe(1);

        act(() => { vi.advanceTimersByTime(TTL_MS / 2 + 1); });
        const depois = await buscaDoTopo('matri');
        expect(nomes(depois.filmes)).toEqual(['Matrix', 'Matrix Reloaded', 'Filme Adulto da Matrix']);
        expect(chamadasDe('streams:get-vod')).toBe(2);
        expect(chamadasDe('streams:get-series')).toBe(2);
        expect(chamadasDe('streams:get-live')).toBe(2);
    });

    it('falha do IPC não fica guardada: a busca seguinte tenta de novo', async () => {
        const boa = respostas['streams:get-vod'];
        respostas['streams:get-vod'] = () => ({ success: false, error: 'provedor fora' });

        const falhou = await buscaDoTopo('matrix');
        expect(nomes(falhou.filmes)).toEqual([]);

        respostas['streams:get-vod'] = boa;
        const voltou = await buscaDoTopo('matrix');
        expect(nomes(voltou.filmes)).toEqual(['Matrix', 'Matrix Reloaded', 'Filme Adulto da Matrix']);
        expect(chamadasDe('streams:get-vod')).toBe(2);
    });

    it('a ponte do IPC que REJEITA também não fica guardada (nem trava a busca)', async () => {
        const boa = respostas['streams:get-vod'];
        respostas['streams:get-vod'] = () => Promise.reject(new Error('ponte caiu'));

        const falhou = await buscaDoTopo('matrix');
        expect(nomes(falhou.filmes)).toEqual([]);

        respostas['streams:get-vod'] = boa;
        const voltou = await buscaDoTopo('matrix');
        expect(nomes(voltou.filmes)).toEqual(['Matrix', 'Matrix Reloaded', 'Filme Adulto da Matrix']);
        expect(chamadasDe('streams:get-vod')).toBe(2);
    });

    it('a falha de um pedido VELHO (que passou do prazo em voo) não derruba o pedido novo do mesmo canal', async () => {
        // O main pode demorar mais que o prazo (provedor lento + retry). O
        // pedido velho falha DEPOIS que um novo já está em voo: o novo continua
        // valendo pra próxima busca, em vez de a falha apagá-lo.
        const pendentes: ((valor: unknown) => void)[] = [];
        respostas['streams:get-vod'] = () => new Promise(resolve => { pendentes.push(resolve); });

        doCelular('requestCatalog', 'mat');
        await vi.waitFor(() => expect(pendentes.length).toBe(1));
        act(() => { vi.advanceTimersByTime(TTL_MS + 1); });

        doCelular('requestCatalog', 'matr');
        await vi.waitFor(() => expect(pendentes.length).toBe(2));

        pendentes[0]({ success: false, error: 'provedor fora' });
        await vi.waitFor(() => expect(enviosDe('web-remote:catalog').length).toBe(1));

        doCelular('requestCatalog', 'matri');
        pendentes[1]({ success: true, data: FILMES });
        await vi.waitFor(() => expect(enviosDe('web-remote:catalog').length).toBe(3));
        expect(nomes(enviosDe<Envio>('web-remote:catalog').at(-1)!)).toEqual(['Matrix', 'Matrix Reloaded', 'Filme Adulto da Matrix']);
        expect(chamadasDe('streams:get-vod')).toBe(2);
    });

    it('desmontar o bridge solta os prazos da lista guardada (nenhum timer sobra)', async () => {
        await buscaDoTopo('mat');
        expect(vi.getTimerCount()).toBeGreaterThan(1);
        const r = root!;
        act(() => { r.unmount(); });
        root = null;
        expect(vi.getTimerCount()).toBe(0);
    });
});
