import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import pt from '../../locales/ui/pt.json';
import en from '../../locales/ui/en.json';
import es from '../../locales/ui/es.json';

/**
 * 🔊 #D009 na PONTA: o `VideoPlayer` de verdade, com o volume mexido pelo
 * atalho de teclado (setas — `useKeyboardShortcuts` → `controls.setVolume`).
 *
 * O hook `useVideoPlayer` removia e readicionava os 12 ouvintes do player a
 * cada passo de volume; segurar a seta disparava isso a cada repetição da
 * tecla, e a limpeza cancelava o debounce do `fullscreenchange` — o botão de
 * tela cheia ficava dizendo "Tela cheia" com o player já em tela cheia.
 *
 * Só o hls.js sai de cena (o jsdom não toca mídia) e a ponte do Electron é
 * pendurada no `window` do jsdom, sem trocá-lo.
 */

vi.mock('../../hooks/useHls', () => ({ useHls: () => ({ current: null }) }));

import { VideoPlayer } from './VideoPlayer';

const EVENTOS_DO_PLAYER = [
    'play', 'pause', 'timeupdate', 'durationchange', 'volumechange', 'waiting',
    'canplay', 'playing', 'loadstart', 'error', 'progress',
];

const SAIR_DA_TELA_CHEIA = new Set([pt.player.exitFullscreen, en.player.exitFullscreen, es.player.exitFullscreen]);
const ENTRAR_NA_TELA_CHEIA = new Set([pt.player.fullscreen, en.player.fullscreen, es.player.fullscreen]);

// O jsdom dispara o `volumechange` numa task (setImmediate do Node).
const proximaTask = (globalThis as unknown as { setImmediate: (cb: () => void) => void }).setImmediate;

/** Espera a CONDIÇÃO, uma task por volta, com prazo — nunca um número fixo de voltas. */
async function esperar(condicao: () => boolean, rotulo: string): Promise<void> {
    const prazo = Date.now() + 2000;
    while (!condicao()) {
        if (Date.now() > prazo) throw new Error(`tempo esgotado esperando: ${rotulo}`);
        await act(async () => {
            await new Promise<void>(resolve => proximaTask(resolve));
        });
    }
}

let container: HTMLDivElement;
let root: Root;
let video: HTMLVideoElement;
let volumechanges = 0;
const contarVolumechange = () => { volumechanges++; };
let penduramosPonte = false;

function montar(): void {
    act(() => { root.render(<VideoPlayer src="http://prov.tv/movie/1.mp4" title="Filme" contentType="movie" />); });
    const el = container.querySelector('video');
    if (!el) throw new Error('<video> não montou');
    video = el;
    video.addEventListener('volumechange', contarVolumechange);
}

function tecla(key: string): void {
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
}

function botaoDeTelaCheia(): HTMLButtonElement {
    const botao = [...container.querySelectorAll('button')].find(b => {
        const rotulo = b.getAttribute('aria-label') ?? '';
        return SAIR_DA_TELA_CHEIA.has(rotulo) || ENTRAR_NA_TELA_CHEIA.has(rotulo);
    });
    if (!botao) throw new Error('botão de tela cheia não achado');
    return botao;
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    volumechanges = 0;
    const w = window as unknown as { ipcRenderer?: unknown };
    penduramosPonte = !w.ipcRenderer;
    if (penduramosPonte) {
        w.ipcRenderer = {
            invoke: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            off: vi.fn(),
            send: vi.fn(),
        };
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as unknown as { fullscreenElement?: Element }).fullscreenElement;
    if (penduramosPonte) delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
    localStorage.clear();
});

describe('VideoPlayer: segurar a seta de volume não remonta os ouvintes do player (#D009)', () => {
    it('5 repetições da seta pra baixo mudam o volume sem tirar nem repor ouvinte do <video>', async () => {
        montar();
        const addVideo = vi.spyOn(video, 'addEventListener');
        const removeVideo = vi.spyOn(video, 'removeEventListener');
        const addDoc = vi.spyOn(document, 'addEventListener');
        const removeDoc = vi.spyOn(document, 'removeEventListener');

        for (let i = 0; i < 5; i++) tecla('ArrowDown');
        await esperar(() => volumechanges >= 5, 'os volumechange das setas');

        const doPlayer = (spy: typeof addVideo) =>
            spy.mock.calls.filter(([tipo]) => EVENTOS_DO_PLAYER.includes(String(tipo)));
        expect(doPlayer(addVideo)).toEqual([]);
        expect(doPlayer(removeVideo)).toEqual([]);
        expect(addDoc.mock.calls.filter(([tipo]) => tipo === 'fullscreenchange')).toEqual([]);
        expect(removeDoc.mock.calls.filter(([tipo]) => tipo === 'fullscreenchange')).toEqual([]);

        // O atalho chegou de verdade no elemento e no volume salvo.
        expect(video.volume).toBeCloseTo(0.5, 5);
        expect(localStorage.getItem('playerVolume')).not.toBeNull();
        expect(Number(localStorage.getItem('playerVolume'))).toBeCloseTo(0.5, 5);
    });

    it('entrar em tela cheia e apertar a seta logo em seguida ainda troca o botão pra "sair da tela cheia"', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        montar();
        expect(ENTRAR_NA_TELA_CHEIA.has(botaoDeTelaCheia().getAttribute('aria-label') ?? '')).toBe(true);

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => container.firstElementChild,
        });
        act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
        act(() => { vi.advanceTimersByTime(10); });
        tecla('ArrowDown');
        act(() => { vi.advanceTimersByTime(100); });

        expect(SAIR_DA_TELA_CHEIA.has(botaoDeTelaCheia().getAttribute('aria-label') ?? '')).toBe(true);
        await esperar(() => volumechanges >= 1, 'o volumechange da seta');
    });
});
