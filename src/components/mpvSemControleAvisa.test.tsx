/**
 * D019 — o mpv toca, mas o pipe de controle nunca conectou.
 *
 * O main ja sabia (esgotou as tentativas do connectPipe), mas so escrevia no
 * log. A tela ficava em "tocando" com o tempo em --:-- e os controles inertes:
 * o ⏸ ate trocava de icone (estado otimista), sem o mpv pausar de fato. O ⏹
 * Parar funcionava — ele mata o processo sem passar pelo pipe.
 *
 * Monta o MpvPlayerView DE VERDADE (react-dom/client + act); so o IPC
 * (mpvService) e dublado, e o `window.ipcRenderer` ganha so o barramento do
 * `media:control` (bandeja e controle do celular). Com `ipcFailed: true`:
 *  - a faixa mostra o aviso (role=alert) no idioma do app;
 *  - nenhum controle que depende do pipe finge agir — nem pelo botao, nem
 *    pelo teclado, nem pela bandeja/celular;
 *  - "Usar o player interno" mata o mpv e SO DEPOIS devolve ao player interno
 *    (sem segunda conexao na fonte), e o mpv morto nao fecha a tela por cima;
 *  - pelo AsyncVideoPlayer, o player interno de fato entra no lugar;
 *  - o ⏹ Parar continua saindo da tela.
 * Sem a falha (conectando, ou status sem o campo), nada disso aparece e os
 * mesmos atalhos agem.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MpvStatus } from '../services/mpvService';
import { languageService } from '../services/languageService';

const estado = vi.hoisted(() => ({
    status: {} as object,
    /** Quando preenchido, o `stop()` so resolve quando o teste mandar. */
    segurarStop: null as null | { soltar: () => void },
}));

const mocks = vi.hoisted(() => ({
    play: vi.fn(async () => ({ success: true })),
    stop: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    setVolume: vi.fn(async () => undefined),
    setFullscreen: vi.fn(async () => undefined),
    setAspect: vi.fn(async () => undefined),
}));

vi.mock('../services/mpvService', () => ({
    mpvService: {
        play: mocks.play,
        stop: mocks.stop,
        getStatus: async () => ({ ...estado.status }),
        pause: mocks.pause,
        resume: mocks.resume,
        seek: async () => undefined,
        setVolume: mocks.setVolume,
        setFullscreen: mocks.setFullscreen,
        setAspect: mocks.setAspect,
        setAudioTrack: async () => undefined,
        setSubtitleTrack: async () => undefined,
        addSubtitle: async () => true,
        addSubtitleFile: async () => true,
        adjustSubtitleDelay: async () => undefined,
    },
}));

vi.mock('../services/playbackService', () => ({
    playbackService: {
        getConfig: () => ({ mpvEnabled: true, autoPlayNextEpisode: false }),
    },
}));

// O player interno inteiro (hls.js e companhia) nao precisa rodar: basta saber
// QUANDO ele entra em cena.
vi.mock('./VideoPlayer/VideoPlayer', () => ({
    VideoPlayer: () => <div data-testid="player-interno" />,
}));

import MpvPlayerView from './MpvPlayerView';
import AsyncVideoPlayer from './AsyncVideoPlayer';

function status(patch: Partial<MpvStatus>): MpvStatus {
    return {
        running: true, timePos: null, duration: null, paused: false, eofReached: false,
        volume: null, fullscreen: false, tracks: [], audioTrackId: null, subtitleTrackId: null,
        ...patch,
    };
}

type Ouvinte = (event: unknown, ...args: unknown[]) => void;
const ouvintes = new Map<string, Set<Ouvinte>>();
const ipcFalso = {
    on: (canal: string, fn: Ouvinte) => {
        if (!ouvintes.has(canal)) ouvintes.set(canal, new Set());
        ouvintes.get(canal)!.add(fn);
    },
    off: (canal: string, fn: Ouvinte) => { ouvintes.get(canal)?.delete(fn); },
    send: () => undefined,
    invoke: async () => null,
};
let ipcOriginal: unknown;

let container: HTMLDivElement;
let root: Root;
let onFallback = vi.fn<(reason: string) => void>();
let onClose = vi.fn<() => void>();

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    localStorage.clear();
    ouvintes.clear();
    estado.segurarStop = null;
    Object.values(mocks).forEach(m => m.mockClear());
    mocks.stop.mockImplementation(async () => {
        if (!estado.segurarStop) return;
        await new Promise<void>(resolve => { estado.segurarStop!.soltar = resolve; });
    });
    ipcOriginal = (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
    Object.defineProperty(window, 'ipcRenderer', { value: ipcFalso, configurable: true, writable: true });
    onFallback = vi.fn<(reason: string) => void>();
    onClose = vi.fn<() => void>();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    Object.defineProperty(window, 'ipcRenderer', { value: ipcOriginal, configurable: true, writable: true });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

/** Avanca o relogio falso ate a CONDICAO valer (nunca um numero fixo de voltas). */
async function esperar(condicao: () => boolean, mensagem: string) {
    for (let i = 0; i < 50 && !condicao(); i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    expect(condicao(), mensagem).toBe(true);
}

const aviso = () => container.querySelector('[role="alert"]');
const botaoPlay = () => container.querySelector('.mpv-view-btn-play') as HTMLButtonElement;
const botaoComTitulo = (titulo: string) =>
    container.querySelector(`button[title="${titulo}"]`) as HTMLButtonElement | null;
const botaoComTexto = (texto: string) =>
    Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(texto));

async function montarView() {
    await act(async () => {
        root.render(
            <MpvPlayerView
                streamUrl="http://exemplo/movie/1.mkv"
                title="Filme de Teste"
                movieId="1"
                isLive={false}
                contentId="1"
                contentType="movie"
                onClose={onClose}
                onFallback={onFallback}
            />
        );
    });
    // O play() resolveu e o poll ja entregou um status: a fase 'starting' sai
    // da tela e o botao de pausa existe.
    await esperar(() => !container.querySelector('.mpv-view-loading') && botaoPlay() !== null,
        'o mpv nem saiu do "Abrindo"');
}

/** Espera o poll ENTREGAR o estado de falha (o aviso na faixa). */
async function montarSemPipe() {
    estado.status = status({ ipcFailed: true });
    await montarView();
    await esperar(() => aviso() !== null, 'nenhum aviso na tela');
}

const clicar = async (el: Element) => {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const tecla = async (code: string) => {
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); });
};
/** O que o main entrega quando a bandeja ou o celular aperta um botao. */
const bandeja = async (acao: string) => {
    await act(async () => {
        for (const fn of [...(ouvintes.get('media:control') ?? [])]) fn({}, acao);
    });
};

describe('mpv sem pipe de controle (D019)', () => {
    it('a faixa avisa que os controles estao indisponiveis, no idioma do app', async () => {
        await montarSemPipe();

        const texto = languageService.t('playback', 'mpvNoControl');
        expect(texto, 'a chave de i18n nao existe').not.toBe('mpvNoControl');
        expect(aviso()!.textContent?.includes(texto)).toBe(true);
    });

    it('nada do que depende do pipe finge agir — nem botao, nem teclado, nem bandeja/celular', async () => {
        await montarSemPipe();
        const t = (sec: string, chave: string) => languageService.t(sec, chave);

        // Botoes/controles apagados. O ⏹ Parar nao depende do pipe e fica.
        expect(botaoPlay().disabled, '⏸').toBe(true);
        expect(botaoComTitulo(t('playback', 'mpvVolume'))!.disabled, 'mudo').toBe(true);
        expect((container.querySelector('.mpv-view-volume') as HTMLInputElement).disabled, 'volume').toBe(true);
        expect(botaoComTitulo(t('playback', 'mpvFullscreen'))!.disabled, 'tela cheia').toBe(true);
        expect(botaoComTexto('📐')!.disabled, 'aspecto').toBe(true);
        expect(botaoComTitulo(t('player', 'subtitleLanguage'))!.disabled, 'busca de legenda').toBe(true);
        expect((container.querySelector('.mpv-view-btn-stop') as HTMLButtonElement).disabled, 'parar').toBe(false);

        // Atalhos de teclado e a bandeja/celular tambem nao fingem.
        // A montagem ja manda um volume inicial (o "volume lembrado"), antes de
        // haver status: isso nao e um controle do usuario e fica fora da conta.
        mocks.setVolume.mockClear();
        await clicar(botaoPlay());
        for (const code of ['Space', 'ArrowUp', 'ArrowDown', 'KeyM', 'KeyF']) await tecla(code);
        expect(ouvintes.get('media:control')?.size, 'o player nao assinou o media:control').toBeGreaterThan(0);
        for (const acao of ['togglePlay', 'mute', 'volumeUp', 'volumeDown']) await bandeja(acao);

        expect(botaoPlay().textContent, 'o ⏸ trocou de icone sem o mpv pausar').toBe('⏸');
        expect(mocks.pause).not.toHaveBeenCalled();
        expect(mocks.resume).not.toHaveBeenCalled();
        expect(mocks.setVolume).not.toHaveBeenCalled();
        expect(mocks.setFullscreen).not.toHaveBeenCalled();
        expect(mocks.setAspect).not.toHaveBeenCalled();
        expect(localStorage.getItem('neostream_mpv_volume'), 'gravou um volume que o mpv nunca recebeu').toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('"Usar o player interno" mata o mpv e SO DEPOIS devolve a reproducao — e o mpv morto nao fecha a tela por cima', async () => {
        await montarSemPipe();
        estado.segurarStop = { soltar: () => undefined };

        const rotulo = languageService.t('playback', 'mpvUseInternalPlayer');
        const botao = botaoComTexto(rotulo);
        expect(botao, 'nao ha como sair pro player interno').toBeDefined();
        await clicar(botao!);

        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(onFallback, 'entregou ao player interno com o mpv ainda de pe').not.toHaveBeenCalled();

        await act(async () => { estado.segurarStop!.soltar(); });
        expect(onFallback).toHaveBeenCalledTimes(1);
        expect(onFallback).toHaveBeenCalledWith('ipc-failed');

        // O main matou o processo: o poll passa a ver running:false. Isso nao
        // pode virar um "fechar" por cima do player interno que ja entrou.
        estado.status = status({ running: false, ipcFailed: false });
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(onClose, 'o poll fechou o player depois da troca').not.toHaveBeenCalled();
        await clicar(botao!);
        await act(async () => root.render(null));
        expect(mocks.stop, 'mandou parar o mpv de novo').toHaveBeenCalledTimes(1);
        expect(onFallback).toHaveBeenCalledTimes(1);
    });

    it('pelo AsyncVideoPlayer, o player interno de fato entra no lugar do mpv', async () => {
        estado.status = status({ ipcFailed: true });
        await act(async () => {
            root.render(
                <AsyncVideoPlayer
                    movie={{ name: 'Filme de Teste', stream_id: 1 }}
                    buildStreamUrl={async () => 'http://exemplo/movie/1.mkv'}
                    onClose={onClose}
                    customTitle="Filme de Teste"
                    contentId="1"
                    contentType="movie"
                />
            );
        });
        await esperar(() => aviso() !== null, 'o mpv sem pipe nao avisou');
        expect(container.querySelector('[data-testid="player-interno"]')).toBeNull();

        await clicar(botaoComTexto(languageService.t('playback', 'mpvUseInternalPlayer'))!);
        await esperar(() => container.querySelector('[data-testid="player-interno"]') !== null,
            'o player interno nao entrou');
        expect(container.querySelector('.mpv-view-controls'), 'a faixa do mpv ficou na tela').toBeNull();
        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a ponte do IPC (o mpvService de verdade) entrega o ipcFailed do main a tela', async () => {
        const { mpvService: ponte } = await vi.importActual<typeof import('../services/mpvService')>('../services/mpvService');
        const invoke = vi.fn(async (canal: string) => (canal === 'mpv:status' ? status({ ipcFailed: true }) : null));
        Object.defineProperty(window, 'ipcRenderer', { value: { ...ipcFalso, invoke }, configurable: true, writable: true });

        const recebido = await ponte.getStatus();

        expect(invoke).toHaveBeenCalledWith('mpv:status');
        expect(recebido?.running).toBe(true);
        expect(recebido?.ipcFailed, 'a ponte comeu o campo no caminho').toBe(true);
    });

    it('o ⏹ Parar continua saindo da tela (ele nao depende do pipe)', async () => {
        await montarSemPipe();

        await clicar(container.querySelector('.mpv-view-btn-stop')!);

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mocks.stop).toHaveBeenCalledTimes(1);
    });

    it('enquanto o pipe ainda esta conectando (ou o status nao traz o campo) nao ha aviso e os controles agem', async () => {
        const semCampo: Partial<MpvStatus> = { ...status({}) };
        delete semCampo.ipcFailed;
        for (const s of [status({ ipcFailed: false }), semCampo]) {
            estado.status = s;
            await montarView();
            // Duas voltas do poll (500 ms cada) com o status sem falha.
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

            expect(aviso()).toBeNull();
            expect(botaoPlay().disabled).toBe(false);
            expect((container.querySelector('.mpv-view-volume') as HTMLInputElement).disabled).toBe(false);
            await tecla('Space');
            expect(botaoPlay().textContent).toBe('▶');
            expect(mocks.pause).toHaveBeenCalledTimes(1);
            await tecla('KeyF');
            expect(mocks.setFullscreen).toHaveBeenCalledTimes(1);
            await tecla('KeyM');
            expect(mocks.setVolume).toHaveBeenLastCalledWith(0);
            await bandeja('volumeUp');
            expect(mocks.setVolume).toHaveBeenLastCalledWith(5);
            await clicar(botaoComTexto('📐')!);
            expect(mocks.setAspect).toHaveBeenCalledTimes(1);

            await act(async () => { root.render(null); });
            Object.values(mocks).forEach(m => m.mockClear());
        }
    });
});
