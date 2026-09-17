import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { lacoSoComControle } from './useGamepadNavigation';

/**
 * 🎮 O laço do controle rodava sem controle nenhum ligado.
 *
 * O `App` montava o hook incondicionalmente e o `requestAnimationFrame` se
 * reagendava ANTES de qualquer checagem — 60 callbacks por segundo só pra se
 * reagendar, mais 11 varreduras por segundo pra descobrir que não há pad. Em
 * toda janela: principal, multi-view e PiP montam o mesmo `App`, e a do PiP
 * nasce `alwaysOnTop`, então o Chromium nunca a congela por estar escondida.
 *
 * O teste não olha o corpo do `poll` nem o handle interno: ele afirma o
 * contrato externo — quantas vezes o quadro é agendado e cancelado em função
 * dos eventos do Gamepad API.
 */

/** Pads que o `navigator.getGamepads()` falso devolve. */
let pads: ({ connected: boolean } | null)[] = [];
let agendados = 0;
let cancelados = 0;

beforeEach(() => {
    pads = [];
    agendados = 0;
    cancelados = 0;
    Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true });
    // Handle começando em 1: o sentinela do laço trata 0 como "parado", e um
    // stub que devolvesse 0 esconderia o bug em vez de provar o conserto.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => { agendados += 1; return agendados; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { cancelados += 1; }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const conectou = () => window.dispatchEvent(new Event('gamepadconnected'));
const desconectou = () => window.dispatchEvent(new Event('gamepaddisconnected'));

describe('lacoSoComControle', () => {
    it('sem controle ligado, nenhum quadro é agendado', () => {
        const parar = lacoSoComControle(() => { /* não deve rodar */ });
        expect(agendados).toBe(0);
        parar();
    });

    it('conectar o controle acende o laço', () => {
        const parar = lacoSoComControle(() => { /* … */ });
        pads = [{ connected: true }];
        conectou();
        expect(agendados).toBe(1);
        parar();
    });

    it('com dois pads, tirar um não para; tirar o último para', () => {
        pads = [{ connected: true }, { connected: true }];
        const parar = lacoSoComControle(() => { /* … */ });
        expect(agendados).toBe(1);

        pads = [{ connected: true }];
        desconectou();
        expect(cancelados).toBe(0);

        pads = [];
        desconectou();
        expect(cancelados).toBe(1);
        parar();
    });

    it('o teardown solta os ouvintes — reconectar depois não reacende', () => {
        const parar = lacoSoComControle(() => { /* … */ });
        parar();

        pads = [{ connected: true }];
        conectou();
        expect(agendados).toBe(0);
    });

    it('pad JÁ ligado na montagem acende o laço na hora', () => {
        // Sem isto o modo sofá morreria em silêncio num remonte (HMR, ou uma
        // janela nova aberta com o controle já em uso): o evento de conexão
        // não acontece de novo, e um laço que só liga no evento nunca ligaria.
        pads = [{ connected: true }];
        const parar = lacoSoComControle(() => { /* … */ });
        expect(agendados).toBe(1);
        parar();
    });
});
