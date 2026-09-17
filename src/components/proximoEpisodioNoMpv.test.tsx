/**
 * Fim do episódio com o motor externo (mpv) ligado.
 *
 * Invariante: "o arquivo chegou ao fim + existe próximo + a preferência do
 * perfil está ligada" ⇒ o pai é avisado e o player NÃO fecha. O contrário
 * (parou no meio, último episódio, preferência desligada) fecha, como sempre.
 *
 * Monta o AsyncVideoPlayer DE VERDADE no ramo do mpv, com o MpvPlayerView real
 * por baixo: assim as duas pontas ficam ancoradas de uma vez — o pai tem que
 * repassar as props e o fim de arquivo tem que agir sobre elas. Só o que é IPC
 * puro (mpvService) e a preferência (playbackService) são dublados.
 *
 * Por que o gatilho NÃO é o `eofReached`: o main descarta a sessão no 'exit' do
 * processo (teardownSession zera `session`, e `mpv:status` volta a
 * `createInitialStatus(false)`), então na vida real o poll de 500 ms quase
 * sempre encontra `eofReached: false`. E o main marca `eofReached` em QUALQUER
 * end-file — inclusive o que o mpv emite quando o usuário fecha a janela ou o
 * stream cai no meio. Os casos 1 e 4 prendem exatamente esses dois enganos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MpvStatus } from '../services/mpvService';

const getStatusMock = vi.fn<() => Promise<MpvStatus | null>>();
const playMock = vi.fn(async () => ({ success: true }));
const stopMock = vi.fn(async () => { });

vi.mock('../services/mpvService', () => ({
    mpvService: {
        play: (...args: unknown[]) => playMock(...(args as [])),
        stop: () => stopMock(),
        getStatus: () => getStatusMock(),
        pause: async () => { },
        resume: async () => { },
        seek: async () => { },
        setVolume: async () => { },
        setFullscreen: async () => { },
        setAudioTrack: async () => { },
        setSubtitleTrack: async () => { },
        setAspect: async () => { },
        adjustSubtitleDelay: async () => { },
        addSubtitle: async () => true,
        addSubtitleFile: async () => true,
    },
}));

let autoPlayNextEpisode = true;
vi.mock('../services/playbackService', () => ({
    playbackService: {
        getConfig: () => ({ mpvEnabled: true, autoPlayNextEpisode }),
    },
}));

// No ramo do mpv o player interno nunca é renderizado; o stub só evita
// arrastar o hls.js (e todo o resto do VideoPlayer) pra dentro do teste.
vi.mock('./VideoPlayer/VideoPlayer', () => ({
    VideoPlayer: () => null,
}));

import AsyncVideoPlayer from './AsyncVideoPlayer';

function status(patch: Partial<MpvStatus>): MpvStatus {
    return {
        running: true, timePos: null, duration: null, paused: false, eofReached: false,
        volume: 100, fullscreen: false, tracks: [], audioTrackId: null, subtitleTrackId: null,
        ...patch,
    };
}

const DURACAO = 2700; // 45 min

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    autoPlayNextEpisode = true;
    getStatusMock.mockReset();
    playMock.mockClear();
    stopMock.mockClear();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
});

interface Opcoes { canGoNext: boolean; onNextEpisode: () => void; onClose: () => void }

function arvore(opcoes: Opcoes) {
    return (
        <AsyncVideoPlayer
            movie={{ id: 'serie-1', series_id: 'serie-1', name: 'Serie de Teste' }}
            buildStreamUrl={async () => 'http://exemplo/ep1.mkv'}
            contentType="series"
            seriesId="serie-1"
            seasonNumber={1}
            episodeNumber={3}
            canGoNext={opcoes.canGoNext}
            onNextEpisode={opcoes.onNextEpisode}
            onClose={opcoes.onClose}
        />
    );
}

/** Monta o player no ramo do mpv e espera a URL do stream ficar pronta. */
async function montar(opcoes: Opcoes) {
    await act(async () => { root.render(arvore(opcoes)); });
    // Efeito 1 resolve a URL num microtask; o mpvService.play resolve noutro.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(playMock).toHaveBeenCalledTimes(1);
    return async (novas: Opcoes) => { await act(async () => { root.render(arvore(novas)); }); };
}

/** Um tick do poll de 500 ms. */
async function tick() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
    });
}

describe('fim do episodio com o motor externo (mpv) ligado', () => {
    it('avanca para o proximo episodio quando o arquivo chega ao fim', async () => {
        const onNextEpisode = vi.fn();
        const onClose = vi.fn();
        // Assim é a vida real: quando o mpv sai, o main já jogou a sessão fora,
        // então o snapshot volta ZERADO — running false e eofReached FALSE.
        getStatusMock
            .mockResolvedValueOnce(status({ timePos: DURACAO - 2, duration: DURACAO }))
            .mockResolvedValue(status({ running: false, timePos: null, duration: null }));

        await montar({ canGoNext: true, onNextEpisode, onClose });
        await tick(); // enche o latestRef com a posição do fim
        await tick(); // mpv sumiu

        expect(onNextEpisode).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('fecha o player no ultimo episodio, que e quando nao ha proximo', async () => {
        const onNextEpisode = vi.fn();
        const onClose = vi.fn();
        getStatusMock
            .mockResolvedValueOnce(status({ timePos: DURACAO - 2, duration: DURACAO }))
            .mockResolvedValue(status({ running: false, timePos: null, duration: null }));

        await montar({ canGoNext: false, onNextEpisode, onClose });
        await tick();
        await tick();

        expect(onNextEpisode).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('fecha o player quando a preferencia de reproducao automatica esta desligada', async () => {
        autoPlayNextEpisode = false;
        const onNextEpisode = vi.fn();
        const onClose = vi.fn();
        getStatusMock
            .mockResolvedValueOnce(status({ timePos: DURACAO - 2, duration: DURACAO }))
            .mockResolvedValue(status({ running: false, timePos: null, duration: null }));

        await montar({ canGoNext: true, onNextEpisode, onClose });
        await tick();
        await tick();

        expect(onNextEpisode).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('nao pula o episodio quando o mpv morre no meio, mesmo anunciando eofReached', async () => {
        // O mpv emite end-file (e o main marca eofReached) também quando o
        // usuário fecha a janela ou o stream cai. Aos 20 min de 45 isso NÃO é
        // fim de episódio: avançar aqui seria pular o que a pessoa está vendo.
        const onNextEpisode = vi.fn();
        const onClose = vi.fn();
        getStatusMock
            .mockResolvedValueOnce(status({ timePos: 1200, duration: DURACAO }))
            .mockResolvedValue(status({ running: false, eofReached: true, timePos: 1200, duration: DURACAO }));

        await montar({ canGoNext: true, onNextEpisode, onClose });
        await tick();
        await tick();

        expect(onNextEpisode).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('enxerga o proximo que so apareceu depois da montagem', async () => {
        // No Home.tsx o `canGoNext` nasce FALSO e só vira verdadeiro quando a
        // lista de episódios chega pela rede. O efeito do polling é de
        // montagem única, então ler a closure congelaria aquele falso e o
        // avanço nunca aconteceria — por isso o fim do arquivo lê um ref.
        const onNextEpisode = vi.fn();
        const onClose = vi.fn();
        getStatusMock
            .mockResolvedValueOnce(status({ timePos: DURACAO - 2, duration: DURACAO }))
            .mockResolvedValue(status({ running: false, timePos: null, duration: null }));

        const rerender = await montar({ canGoNext: false, onNextEpisode, onClose });
        await tick();
        await rerender({ canGoNext: true, onNextEpisode, onClose });
        await tick();

        expect(onNextEpisode).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });
});
