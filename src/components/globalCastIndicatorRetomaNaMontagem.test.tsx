import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GlobalCastIndicator } from './GlobalCastIndicator';

/**
 * 📡 A retomada do cast depois de reiniciar o app nasce AQUI (D097).
 *
 * O indicador global é quem pede ao processo principal pra readotar um cast
 * que sobreviveu ao reinício — uma vez, na montagem, SEM deviceId. Quem
 * escolhe o aparelho é o main (`cast:reconnect` varre todos e espera o mDNS
 * quando o mapa ainda está vazio). Se esta chamada some ou passa a mandar um
 * aparelho fixo, a retomada morre em silêncio: nada mais a dispara.
 */

let container: HTMLDivElement;
let root: Root;
let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Ponte do Electron: NÃO trocamos o `window` inteiro do jsdom — só
    // penduramos a ponte nele.
    invoke = vi.fn(async (canal: string) => {
        if (canal === 'cast:reconnect') return { success: false, error: 'Nenhum dispositivo' };
        return { success: true, active: false };
    });
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
});

describe('GlobalCastIndicator — retomada do cast na montagem', () => {
    it('pede cast:reconnect uma vez, sem deviceId (o main escolhe entre todos os aparelhos)', async () => {
        await act(async () => { root.render(<GlobalCastIndicator />); });
        // O poll de status também sai na montagem: espera por ele, não por voltas.
        await vi.waitFor(() => {
            expect(invoke.mock.calls.some(([canal]) => canal === 'cast:get-status')).toBe(true);
        });

        const retomadas = invoke.mock.calls.filter(([canal]) => canal === 'cast:reconnect');
        expect(retomadas).toEqual([['cast:reconnect']]);
    });
});
