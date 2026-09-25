import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useVideoPlayer } from './useVideoPlayer';

/**
 * 🔊 #D009 — o efeito que pendura os 12 ouvintes do player (`play`, `pause`,
 * `timeupdate`, `durationchange`, `volumechange`, `waiting`, `canplay`,
 * `playing`, `loadstart`, `error`, `progress` no `<video>` e o
 * `fullscreenchange` no document) dependia de `state.volume`. Cada passo do
 * slider de volume (step 0.01) e cada seta segurada desmontava e remontava os
 * 12 — e a desmontagem ainda cancelava o debounce de 50 ms do
 * `fullscreenchange`: quem entrava em tela cheia e mexia no volume logo em
 * seguida ficava com o estado dizendo "fora da tela cheia" (ícone e botão de
 * janela errados).
 *
 * Monta o hook de verdade (react-dom/client + act) num `<video>` do jsdom.
 */

type Hook = ReturnType<typeof useVideoPlayer>;

const hookAtual: { valor: Hook | null } = { valor: null };

function Palco() {
    const hook = useVideoPlayer();
    const { videoRef } = hook;
    useLayoutEffect(() => {
        hookAtual.valor = hook;
    });
    return <video ref={videoRef} />;
}

function hook(): Hook {
    if (!hookAtual.valor) throw new Error('hook não montado');
    return hookAtual.valor;
}

// O jsdom dispara o `volumechange` numa task (setImmediate do Node — fora dos
// tipos do tsconfig do app e fora do `toFake` do teste de tela cheia).
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

const EVENTOS_DO_VIDEO = [
    'play', 'pause', 'timeupdate', 'durationchange', 'volumechange', 'waiting',
    'canplay', 'playing', 'loadstart', 'error', 'progress',
];

let container: HTMLDivElement;
let root: Root;
let montado = false;
let video: HTMLVideoElement;
let volumechanges = 0;
const contarVolumechange = () => { volumechanges++; };

function montar(): void {
    act(() => { root.render(<Palco />); });
    montado = true;
    const el = container.querySelector('video');
    if (!el) throw new Error('<video> não montou');
    video = el;
    video.addEventListener('volumechange', contarVolumechange);
}

function desmontar(): void {
    if (!montado) return;
    act(() => { root.unmount(); });
    montado = false;
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    hookAtual.valor = null;
    volumechanges = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    desmontar();
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as unknown as { fullscreenElement?: Element }).fullscreenElement;
    localStorage.clear();
});

describe('useVideoPlayer: volume sem desmontar os ouvintes (#D009)', () => {
    it('arrastar o volume NÃO remove nem readiciona ouvinte nenhum', async () => {
        montar();
        const addVideo = vi.spyOn(video, 'addEventListener');
        const removeVideo = vi.spyOn(video, 'removeEventListener');
        const addDoc = vi.spyOn(document, 'addEventListener');
        const removeDoc = vi.spyOn(document, 'removeEventListener');

        // Um arrasto curto do slider: 20 passos de 0.01.
        const PASSOS = 20;
        for (let i = 1; i <= PASSOS; i++) {
            act(() => { hook().controls.setVolume(1 - i * 0.01); });
        }
        await esperar(() => volumechanges >= PASSOS, 'os volumechange do arrasto');

        const doPlayer = (spy: typeof addVideo) =>
            spy.mock.calls.filter(([tipo]) => EVENTOS_DO_VIDEO.includes(String(tipo)));
        expect(doPlayer(addVideo)).toEqual([]);
        expect(doPlayer(removeVideo)).toEqual([]);
        expect(addDoc.mock.calls.filter(([tipo]) => tipo === 'fullscreenchange')).toEqual([]);
        expect(removeDoc.mock.calls.filter(([tipo]) => tipo === 'fullscreenchange')).toEqual([]);

        // E o volume andou de verdade, no elemento e no estado.
        expect(video.volume).toBeCloseTo(0.8, 5);
        expect(hook().state.volume).toBeCloseTo(0.8, 5);
    });

    it('entrar em tela cheia e mexer no volume logo em seguida ainda marca a tela cheia', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        montar();
        expect(hook().state.fullscreen).toBe(false);

        // O navegador entra em tela cheia; o hook agenda o debounce de 50 ms.
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => video.parentElement,
        });
        act(() => { document.dispatchEvent(new Event('fullscreenchange')); });

        // 10 ms depois o usuário mexe no volume (seta, slider).
        act(() => { vi.advanceTimersByTime(10); });
        act(() => { hook().controls.setVolume(0.9); });

        act(() => { vi.advanceTimersByTime(100); });
        expect(hook().state.fullscreen).toBe(true);

        await esperar(() => volumechanges >= 1, 'o volumechange do passo');
    });

    it('os ouvintes continuam vivos depois de mexer no volume', async () => {
        montar();
        for (let i = 1; i <= 5; i++) {
            act(() => { hook().controls.setVolume(1 - i * 0.1); });
        }
        await esperar(() => volumechanges >= 5, 'os volumechange dos passos');

        // Volume mudado por fora do slider: o estado acompanha o elemento.
        act(() => { video.volume = 0.2; });
        await esperar(() => Math.abs(hook().state.volume - 0.2) < 1e-9, 'o estado seguir o elemento');

        // E o resto dos ouvintes também: `play`/`pause` viram `playing` no estado.
        act(() => { video.dispatchEvent(new Event('play')); });
        expect(hook().state.playing).toBe(true);
        act(() => { video.dispatchEvent(new Event('pause')); });
        expect(hook().state.playing).toBe(false);
    });

    it('o volume salvo continua sendo aplicado ao <video> na montagem', async () => {
        localStorage.setItem('playerVolume', '0.35');
        montar();
        expect(video.volume).toBeCloseTo(0.35, 5);
        expect(hook().state.volume).toBeCloseTo(0.35, 5);
        // O `volumechange` da aplicação inicial sai numa task: espera ele
        // chegar pra não vazar setState fora do act pro próximo teste.
        await esperar(() => volumechanges >= 1, 'o volumechange da aplicação inicial');
        expect(hook().state.volume).toBeCloseTo(0.35, 5);
    });

    it('setVolume muda o estado na hora e grava o volume pra próxima sessão', async () => {
        montar();
        act(() => { hook().controls.setVolume(0.42); });
        // Na hora — sem esperar o `volumechange` do elemento chegar.
        expect(volumechanges).toBe(0);
        expect(hook().state.volume).toBe(0.42);
        expect(localStorage.getItem('playerVolume')).toBe('0.42');
        await esperar(() => volumechanges >= 1, 'o volumechange do passo');
    });

    it('desmontar tira os ouvintes que a montagem pendurou (o efeito agora só limpa aí)', () => {
        // O React também pendura os ouvintes de mídia dele no <video> (eventos
        // de mídia não borbulham) e não os tira: por isso o teste casa cada
        // ouvinte pendurado com a remoção do MESMO (tipo, função).
        const addVideo = vi.spyOn(HTMLMediaElement.prototype, 'addEventListener');
        const removeVideo = vi.spyOn(HTMLMediaElement.prototype, 'removeEventListener');
        const addDoc = vi.spyOn(document, 'addEventListener');
        const removeDoc = vi.spyOn(document, 'removeEventListener');

        montar();
        const pendurados = addVideo.mock.calls.map(([tipo, fn]) => [tipo, fn] as const);
        const fsAdd = addDoc.mock.calls.filter(([tipo]) => tipo === 'fullscreenchange').map(([tipo, fn]) => [tipo, fn]);
        expect(fsAdd).toHaveLength(1);
        expect(removeVideo).not.toHaveBeenCalled();

        desmontar();
        const tirados = removeVideo.mock.calls.map(([tipo, fn]) => [tipo, fn] as const);
        const tiposLimpos = pendurados
            .filter(([tipo, fn]) => tirados.some(([t, f]) => t === tipo && f === fn))
            .map(([tipo]) => String(tipo));
        expect([...new Set(tiposLimpos)].sort()).toEqual([...EVENTOS_DO_VIDEO].sort());
        const fsRemove = removeDoc.mock.calls.filter(([tipo]) => tipo === 'fullscreenchange').map(([tipo, fn]) => [tipo, fn]);
        expect(fsRemove).toEqual(fsAdd);
    });

    it('desmontar no meio do debounce da tela cheia não deixa timer pendurado', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        montar();
        act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
        expect(vi.getTimerCount()).toBe(1);
        desmontar();
        expect(vi.getTimerCount()).toBe(0);
    });
});
