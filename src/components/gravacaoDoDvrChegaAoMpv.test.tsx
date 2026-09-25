/**
 * A ponta do renderer da gravação do DVR: o `file:///` sai da tela e chega
 * INTEIRO ao `mpv:play`.
 *
 * O conserto do item vive no main (a guarda do `mpv:play`), mas ele só vale
 * alguma coisa se a tela continuar entregando a URL do arquivo ao motor
 * externo. Entre a tela e o main há dois saltos fáceis de quebrar sem
 * ninguém notar — o `buildStreamUrl` da página de Downloads e o
 * `mpvService.play(streamUrl)` do MpvPlayerView — e nenhum teste olhava o
 * VALOR que passa por eles (os que existem só contam as chamadas).
 *
 * Monta o AsyncVideoPlayer DE VERDADE, com as mesmas props que a página de
 * Downloads passa pra tocar uma gravação, e com o MpvPlayerView real por
 * baixo. Só o IPC (mpvService) e a preferência (playbackService) são dublados.
 *
 * O segundo caso prende o outro lado: quando o main recusa, o que aparece é o
 * player interno — que é exatamente onde a gravação `.ts` não toca. É o
 * "hoje" do item, virado teste.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MpvStatus } from '../services/mpvService';

const playMock = vi.fn(async (...args: unknown[]) => { void args; return resultadoDoPlay; });
let resultadoDoPlay: { success: boolean; reason?: string } = { success: true };

const status: MpvStatus = {
    running: true, timePos: 0, duration: null, paused: false, eofReached: false,
    volume: 100, fullscreen: false, tracks: [], audioTrackId: null, subtitleTrackId: null,
};

vi.mock('../services/mpvService', () => ({
    mpvService: {
        play: (...args: unknown[]) => playMock(...args),
        stop: async () => undefined,
        getStatus: async () => ({ ...status }),
        pause: async () => undefined,
        resume: async () => undefined,
        seek: async () => undefined,
        setVolume: async () => undefined,
        setFullscreen: async () => undefined,
        setAudioTrack: async () => undefined,
        setSubtitleTrack: async () => undefined,
        setAspect: async () => undefined,
        adjustSubtitleDelay: async () => undefined,
        addSubtitle: async () => true,
        addSubtitleFile: async () => true,
    },
}));

vi.mock('../services/playbackService', () => ({
    playbackService: {
        getConfig: () => ({ mpvEnabled: true, autoPlayNextEpisode: false }),
    },
}));

// O player interno inteiro (hls.js e companhia) não precisa rodar: basta
// saber QUANDO ele entra em cena.
vi.mock('./VideoPlayer/VideoPlayer', () => ({
    VideoPlayer: () => <div data-testid="player-interno" />,
}));

import AsyncVideoPlayer from './AsyncVideoPlayer';

/** O caminho e a URL que a página de Downloads monta pra uma gravação. */
const CAMINHO = 'C:\\Users\\rak\\Videos\\NeoStream\\Gravacoes\\Canal 5 - 2026-09-17.ts';
const URL_DO_ARQUIVO = 'file:///C:/Users/rak/Videos/NeoStream/Gravacoes/Canal 5 - 2026-09-17.ts';

let container: HTMLDivElement;
let root: Root;

/** Mesma árvore que Downloads.tsx renderiza em `playingRecording`. */
function gravacaoTocando() {
    return (
        <AsyncVideoPlayer
            movie={{ name: 'Canal 5 - 2026-09-17', stream_id: CAMINHO }}
            buildStreamUrl={async () => `file:///${CAMINHO.replace(/\\/g, '/')}`}
            onClose={() => { }}
            customTitle="Canal 5 - 2026-09-17"
            contentId={`rec-${CAMINHO}`}
            contentType="movie"
        />
    );
}

async function montar() {
    await act(async () => { root.render(gravacaoTocando()); });
    // Efeito 1 resolve a URL num microtask; o play() resolve noutro.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
}

describe('gravacao do DVR entregue ao motor externo', () => {
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        localStorage.clear();
        playMock.mockClear();
        resultadoDoPlay = { success: true };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    it('o file:/// da gravacao chega ao mpv:play sem ser mexido', async () => {
        await montar();

        expect(playMock, 'o motor externo nem foi acionado').toHaveBeenCalledTimes(1);
        expect(playMock.mock.calls[0][0]).toBe(URL_DO_ARQUIVO);
        expect(playMock.mock.calls[0][1]).toBe('Canal 5 - 2026-09-17');
        expect(container.querySelector('[data-testid="player-interno"]'),
            'caiu no player interno com o mpv respondendo que abriu').toBeNull();
    });

    it('recusa do main joga a gravacao no player interno — onde o .ts nao toca', async () => {
        resultadoDoPlay = { success: false, reason: 'invalid-url' };

        await montar();

        expect(playMock).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="player-interno"]'),
            'o main recusou e ninguem assumiu a reproducao').not.toBeNull();
    });
});
