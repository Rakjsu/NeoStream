import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
    useFavoritesHealthCheck,
    favCheckMessage,
    FAV_CHECK_LIMIT,
    FAV_CHECK_MSG_MS,
    type FavoritesHealthCheck,
} from './useFavoritesHealthCheck';

/**
 * 🩺 D028 — o selo "⚠ FORA DO AR" nunca saía e o botão "Verificar favoritos"
 * ficava congelado no último resultado.
 *
 * A sonda gravava os ids fora do ar num estado da TV ao vivo que ninguém
 * limpava. O selo é desenhado em QUALQUER card cujo id esteja no conjunto,
 * então depois de verificar os favoritos e voltar pra "Todos os canais" o
 * canal seguia marcado fora do ar (mesmo já tendo voltado) até sair da página.
 *
 * Estes casos montam o hook de verdade e observam o que a tela mostraria. O
 * caminho inteiro pela página (⭐ → 🩺 → Todos) está em
 * `src/pages/seloForaDoArDaTv.test.tsx`.
 */

interface Canal { stream_id: number; name: string }

const canais = (n: number): Canal[] =>
    Array.from({ length: n }, (_, i) => ({ stream_id: i + 1, name: `Canal ${i + 1}` }));

/** Canal 98 não tem URL (a montagem lança); canal 99 tem URL que não é http. */
const montarUrl = (c: Canal): string => {
    if (c.stream_id === 98) throw new Error('sem URL');
    if (c.stream_id === 99) return 'rtmp://prov.tv/live/99';
    return `http://prov.tv/live/${c.stream_id}.ts`;
};
/** Preparada UMA vez por verificação (#D175); o caso Stalker está em `src/pages/sondaDeFavoritosSemCreateLink.test.tsx`. */
const prepararSonda = (): Promise<typeof montarUrl> => Promise.resolve(montarUrl);

let container: HTMLDivElement;
let root: Root;
let invoke: ReturnType<typeof vi.fn>;
let atual: FavoritesHealthCheck<Canal>;

function Harness({ resetKey, onValor }: { resetKey: string; onValor: (v: FavoritesHealthCheck<Canal>) => void }) {
    const valor = useFavoritesHealthCheck<Canal>({ resetKey, prepararSonda });
    useEffect(() => { onValor(valor); });
    return null;
}

function montar(resetKey: string): void {
    act(() => { root.render(<Harness resetKey={resetKey} onValor={v => { atual = v; }} />); });
}

/**
 * Espera a CONDIÇÃO (a sonda passa por várias promessas), não um nº fixo de
 * voltas. Aqui tudo é promessa dublada — não há crypto, timer nem stream no
 * caminho —, então girar microtasks até a condição basta; o teto é só pra
 * falhar em vez de travar.
 */
async function esperarAte(cond: () => boolean): Promise<void> {
    for (let i = 0; i < 500; i++) {
        if (cond()) return;
        await act(async () => { await Promise.resolve(); });
    }
    throw new Error('condição não chegou');
}

/** Sonda responde: ids em `mortos` fora do ar, o resto no ar. */
function sondaResponde(mortos: number[]): void {
    invoke.mockImplementation((_canal: string, arg: { targets: { id: string }[] }) => Promise.resolve({
        success: true,
        results: arg.targets.map(t => ({ id: t.id, alive: !mortos.includes(Number(t.id)) })),
    }));
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Ponte do Electron: só penduramos a ponte no window do jsdom.
    invoke = vi.fn();
    (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke,
        on: vi.fn(),
        off: vi.fn(),
        send: vi.fn(),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.useRealTimers();
});

describe('useFavoritesHealthCheck: o resultado da sonda vale só pro filtro em que foi feita', () => {
    it('manda pra ponte os canais da lista, com o id e a URL de cada um', async () => {
        sondaResponde([]);
        montar('FAVORITES|');
        await act(async () => { await atual.check(canais(2)); });
        await esperarAte(() => !atual.busy && atual.msg !== '');

        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke.mock.calls[0][0]).toBe('diagnostics:probe-urls');
        expect(invoke.mock.calls[0][1]).toEqual({
            targets: [
                { id: '1', url: 'http://prov.tv/live/1.ts' },
                { id: '2', url: 'http://prov.tv/live/2.ts' },
            ],
        });
        expect(atual.msg).toBe('✓ 2 no ar');
        expect(atual.deadIds.size).toBe(0);
    });

    it('canal sem URL (ou com URL que não é http) fica de fora da sonda', async () => {
        sondaResponde([]);
        montar('FAVORITES|');
        const lista = [{ stream_id: 98, name: 'Sem URL' }, { stream_id: 99, name: 'RTMP' }, ...canais(1)];
        await act(async () => { await atual.check(lista); });
        await esperarAte(() => atual.msg !== '');

        expect(invoke.mock.calls[0][1]).toEqual({ targets: [{ id: '1', url: 'http://prov.tv/live/1.ts' }] });
        expect(atual.msg).toBe('✓ 1 no ar');
    });

    it('trocar de categoria tira o selo e devolve o botão', async () => {
        sondaResponde([2]);
        montar('FAVORITES|');
        await act(async () => { await atual.check(canais(3)); });
        await esperarAte(() => !atual.busy);

        expect(atual.deadIds.has('2')).toBe(true);
        expect(atual.msg).toBe('⚠ 1 de 3 fora do ar');

        // Volta pra "Todos os canais": o canal 2 NÃO pode seguir marcado.
        montar('all|');
        expect(atual.deadIds.size).toBe(0);
        expect(atual.msg).toBe('');
    });

    it('re-render com o MESMO filtro mantém o resultado', async () => {
        sondaResponde([2]);
        montar('FAVORITES|');
        await act(async () => { await atual.check(canais(3)); });
        await esperarAte(() => atual.deadIds.size > 0);

        montar('FAVORITES|');
        expect(atual.deadIds.has('2')).toBe(true);
        expect(atual.msg).toBe('⚠ 1 de 3 fora do ar');
    });

    it('refazer a busca também descarta o resultado', async () => {
        sondaResponde([1]);
        montar('FAVORITES|');
        await act(async () => { await atual.check(canais(2)); });
        await esperarAte(() => atual.deadIds.size > 0);

        montar('FAVORITES|globo');
        expect(atual.deadIds.size).toBe(0);
        expect(atual.msg).toBe('');
    });

    it('voltar pro mesmo filtro depois de sair NÃO ressuscita o selo velho', async () => {
        sondaResponde([1]);
        montar('FAVORITES|');
        await act(async () => { await atual.check(canais(2)); });
        await esperarAte(() => atual.deadIds.size > 0);

        montar('all|');
        montar('FAVORITES|');
        expect(atual.deadIds.size).toBe(0);
        expect(atual.msg).toBe('');
    });

    it('sonda que termina DEPOIS da troca de filtro não marca a grade nova', async () => {
        let responder: (v: unknown) => void = () => {};
        invoke.mockImplementation(() => new Promise(r => { responder = r; }));
        montar('FAVORITES|');
        let emAndamento: Promise<void> = Promise.resolve();
        act(() => { emAndamento = atual.check(canais(2)); });
        await esperarAte(() => invoke.mock.calls.length === 1);
        expect(atual.busy).toBe(true);

        montar('all|');
        expect(atual.busy).toBe(false);

        await act(async () => {
            responder({ success: true, results: [{ id: '1', alive: false }, { id: '2', alive: false }] });
            await emAndamento;
        });
        expect(atual.deadIds.size).toBe(0);
        expect(atual.msg).toBe('');
        expect(atual.busy).toBe(false);
    });

    it('sonda velha que termina depois de uma nova não encurta o rótulo da nova', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        // 1ª sonda fica pendurada; as seguintes respondem na hora (canal 1 fora).
        let responderVelha: (v: unknown) => void = () => {};
        invoke.mockImplementationOnce(() => new Promise(r => { responderVelha = r; }));
        invoke.mockImplementation((_c: string, arg: { targets: { id: string }[] }) => Promise.resolve({
            success: true,
            results: arg.targets.map(t => ({ id: t.id, alive: t.id !== '1' })),
        }));

        montar('FAVORITES|');
        let velha: Promise<void> = Promise.resolve();
        act(() => { velha = atual.check(canais(2)); });
        await esperarAte(() => invoke.mock.calls.length === 1);

        // A pessoa busca algo e verifica de novo: sonda nova, resultado na hora.
        montar('FAVORITES|x');
        await act(async () => { await atual.check(canais(2)); });
        await esperarAte(() => atual.msg !== '');
        expect(atual.msg).toBe('⚠ 1 de 2 fora do ar');

        // Metade do tempo do rótulo depois, a velha responde...
        act(() => { vi.advanceTimersByTime(FAV_CHECK_MSG_MS / 2); });
        await act(async () => {
            responderVelha({ success: true, results: [{ id: '2', alive: false }] });
            await velha;
        });
        expect(atual.deadIds.has('1')).toBe(true);
        expect(atual.deadIds.has('2')).toBe(false);

        // ...e a pessoa verifica mais uma vez, com o mesmo resultado.
        await act(async () => { await atual.check(canais(2)); });
        await esperarAte(() => atual.msg !== '');
        expect(atual.msg).toBe('⚠ 1 de 2 fora do ar');

        // O relógio da 2ª sonda não pode apagar o rótulo da 3ª antes da hora.
        act(() => { vi.advanceTimersByTime(FAV_CHECK_MSG_MS / 2); });
        expect(atual.msg).toBe('⚠ 1 de 2 fora do ar');
        act(() => { vi.advanceTimersByTime(FAV_CHECK_MSG_MS / 2); });
        expect(atual.msg).toBe('');
    });

    it('o rótulo do botão volta sozinho depois de alguns segundos; o selo fica', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        sondaResponde([3]);
        montar('FAVORITES|');
        await act(async () => { await atual.check(canais(3)); });
        await esperarAte(() => atual.msg !== '');
        expect(atual.msg).toBe('⚠ 1 de 3 fora do ar');

        act(() => { vi.advanceTimersByTime(FAV_CHECK_MSG_MS - 1); });
        expect(atual.msg).not.toBe('');

        act(() => { vi.advanceTimersByTime(1); });
        expect(atual.msg).toBe('');
        expect(atual.deadIds.has('3')).toBe(true);
    });

    it('com mais favoritos que o limite, sonda só o limite e diz isso no botão', async () => {
        sondaResponde([]);
        montar('FAVORITES|');
        await act(async () => { await atual.check(canais(45)); });
        await esperarAte(() => atual.msg !== '');

        const alvos = (invoke.mock.calls[0][1] as { targets: unknown[] }).targets;
        expect(alvos).toHaveLength(FAV_CHECK_LIMIT);
        expect(atual.msg).toBe(`✓ ${FAV_CHECK_LIMIT} no ar · ${FAV_CHECK_LIMIT} dos 45 verificados`);
    });

    it('ponte que rejeita não deixa o botão preso em "Verificando…"', async () => {
        invoke.mockRejectedValue(new Error('ipc caiu'));
        montar('FAVORITES|');
        await act(async () => { await atual.check(canais(2)); });
        await esperarAte(() => !atual.busy);
        expect(atual.msg).toBe('✖ sonda falhou');
        expect(atual.deadIds.size).toBe(0);
    });

    it('sonda que falha mantém os selos da verificação anterior do mesmo filtro', async () => {
        sondaResponde([2]);
        montar('FAVORITES|');
        await act(async () => { await atual.check(canais(2)); });
        await esperarAte(() => atual.deadIds.size > 0);

        invoke.mockRejectedValue(new Error('ipc caiu'));
        await act(async () => { await atual.check(canais(2)); });
        await esperarAte(() => !atual.busy);
        expect(atual.msg).toBe('✖ sonda falhou');
        expect(atual.deadIds.has('2')).toBe(true);
    });

    it('handler que responde sem sucesso também vira "sonda falhou"', async () => {
        invoke.mockResolvedValue({ success: false, results: [{ id: '1', alive: false }] });
        montar('FAVORITES|');
        await act(async () => { await atual.check(canais(2)); });
        await esperarAte(() => !atual.busy);
        expect(atual.msg).toBe('✖ sonda falhou');
        expect(atual.deadIds.size).toBe(0);
    });
});

describe('favCheckMessage', () => {
    it('lista dentro do limite não fala em "verificados"', () => {
        expect(favCheckMessage(0, 12, 12)).toBe('✓ 12 no ar');
        expect(favCheckMessage(2, 12, 12)).toBe('⚠ 2 de 12 fora do ar');
        expect(favCheckMessage(0, FAV_CHECK_LIMIT, FAV_CHECK_LIMIT)).toBe(`✓ ${FAV_CHECK_LIMIT} no ar`);
    });
    it('lista maior que o limite diz quantos da lista (já filtrada) foram verificados', () => {
        expect(favCheckMessage(1, 29, 80)).toBe(`⚠ 1 de 29 fora do ar · ${FAV_CHECK_LIMIT} dos 80 verificados`);
    });
});
