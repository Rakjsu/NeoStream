/**
 * ⏮/⏭ do controle do celular durante um episódio de série (ou na fila de
 * filmes do VOD).
 *
 * A página do celular mostra os dois botões sempre, e o servidor os repassa
 * ao renderer como `media:control` 'next' / 'previous'. Ao vivo quem escuta é
 * o zap do LiveTV — que só existe com a página de TV montada. Fora dela os
 * DOIS players ignoravam o comando (de propósito: "próximo" é coisa da lista,
 * não do player), e ninguém mais ouvia — o botão do celular ficava morto.
 *
 * Quem conhece a lista é o pai, e o AsyncVideoPlayer é a peça que recebe as
 * callbacks dele e escolhe o motor. Por isso o ouvinte mora LÁ, uma vez só,
 * valendo para o player interno e para o mpv.
 *
 * Invariante: com um episódio aberto, 'next'/'previous' fazem EXATAMENTE o
 * que os botões da barra fazem — chamam o pai UMA vez, e só quando o
 * `canGoNext`/`canGoPrevious` libera. Ao vivo nada disso escuta (o zap do
 * LiveTV é o único consumidor, senão o ⏭ andaria duas vezes). Fechar o
 * player desliga o ouvinte.
 *
 * Monta o AsyncVideoPlayer DE VERDADE nos dois ramos — o VideoPlayer interno e
 * o MpvPlayerView —, então um player que voltasse a tratar o comando por
 * conta própria faria o pai andar DUAS vezes e reprovaria aqui. Dublados: o
 * IPC do mpv (mpvService), a preferência (playbackService) e o hls.js
 * (useHls). O `window.ipcRenderer` ganha só um barramento de mentira; o
 * `window` em si não é trocado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MpvStatus } from '../services/mpvService';

const playbackConfig = { mpvEnabled: false, autoPlayNextEpisode: true };

vi.mock('../services/playbackService', () => ({
    playbackService: { getConfig: () => ({ ...playbackConfig }) },
}));

const statusDoMpv: MpvStatus = {
    running: true, timePos: 10, duration: 2700, paused: false, eofReached: false,
    volume: 100, fullscreen: false, tracks: [], audioTrackId: null, subtitleTrackId: null,
};

const mpvPlay = vi.fn(async () => ({ success: true }));

vi.mock('../services/mpvService', () => ({
    mpvService: {
        play: (...args: unknown[]) => mpvPlay(...(args as [])),
        stop: async () => undefined,
        getStatus: async () => ({ ...statusDoMpv }),
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

// O hls.js não tem o que fazer no jsdom; o <video> fica sem fonte e pronto.
vi.mock('../hooks/useHls', () => ({
    useHls: () => ({ current: null }),
}));

import AsyncVideoPlayer from './AsyncVideoPlayer';

type Ouvinte = (event: unknown, ...args: unknown[]) => void;

/** Barramento de mentira no lugar do preload: guarda quem ouve cada canal. */
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

function quantosOuvem(canal: string): number {
    return ouvintes.get(canal)?.size ?? 0;
}

/** O que o main faz quando o celular aperta ⏮/⏭ sem sessão de cast. */
async function celularAperta(acao: 'next' | 'previous') {
    await act(async () => {
        for (const fn of [...(ouvintes.get('media:control') ?? [])]) fn({}, acao);
    });
}

interface Opcoes {
    /** `undefined` é o que o VOD passa na fila de filmes (vira 'movie' lá dentro). */
    contentType: 'series' | 'live' | undefined;
    canGoNext: boolean;
    canGoPrevious: boolean;
    onNextEpisode: () => void;
    onPreviousEpisode: () => void;
}

let container: HTMLDivElement;
let root: Root;
let ipcOriginal: unknown;

function arvore(o: Opcoes) {
    const serie = o.contentType === 'series';
    return (
        <AsyncVideoPlayer
            movie={serie
                ? { id: 'ep-3', series_id: 'serie-1', name: 'Serie de Teste' }
                : o.contentType === 'live'
                    ? { stream_id: 55, name: 'Canal de Teste' }
                    : { stream_id: 77, name: 'Filme da Fila' }}
            buildStreamUrl={async () => 'http://exemplo/ep3.mkv'}
            contentType={o.contentType}
            seriesId={serie ? 'serie-1' : undefined}
            seasonNumber={serie ? 1 : undefined}
            episodeNumber={serie ? 3 : undefined}
            canGoNext={o.canGoNext}
            canGoPrevious={o.canGoPrevious}
            onNextEpisode={o.onNextEpisode}
            onPreviousEpisode={o.onPreviousEpisode}
            onClose={() => { }}
        />
    );
}

/** Monta e espera a CONDIÇÃO: a URL resolveu e o motor da vez está na tela. */
async function montar(o: Opcoes, mpv: boolean) {
    await act(async () => { root.render(arvore(o)); });
    await vi.waitFor(() => {
        expect(container.querySelector('.loading-screen'), 'ainda carregando').toBeNull();
        if (mpv) expect(mpvPlay, 'o mpv nao foi chamado').toHaveBeenCalledTimes(1);
        else expect(container.querySelector('video'), 'o player interno nao montou').not.toBeNull();
        expect(quantosOuvem('media:control'), 'o player nao assinou o canal').toBeGreaterThan(0);
    });
}

function opcoes(patch: Partial<Opcoes> = {}): Opcoes {
    return {
        contentType: 'series',
        canGoNext: true,
        canGoPrevious: true,
        onNextEpisode: vi.fn(),
        onPreviousEpisode: vi.fn(),
        ...patch,
    };
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    ouvintes.clear();
    mpvPlay.mockClear();
    localStorage.clear();
    ipcOriginal = (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
    Object.defineProperty(window, 'ipcRenderer', { value: ipcFalso, configurable: true, writable: true });
    // O jsdom não implementa a mídia: play()/pause()/load() lançariam.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'ipcRenderer', { value: ipcOriginal, configurable: true, writable: true });
});

describe.each([
    { motor: 'player interno', mpv: false },
    { motor: 'motor externo (mpv)', mpv: true },
])('⏮/⏭ do celular com episodio tocando — $motor', ({ mpv }) => {
    beforeEach(() => { playbackConfig.mpvEnabled = mpv; });

    it('⏭ avanca o episodio, uma vez', async () => {
        const o = opcoes();
        await montar(o, mpv);

        await celularAperta('next');

        expect(o.onNextEpisode, 'o ⏭ do celular nao fez nada (ou andou duas vezes)').toHaveBeenCalledTimes(1);
        expect(o.onPreviousEpisode).not.toHaveBeenCalled();
    });

    it('⏮ volta o episodio, uma vez', async () => {
        const o = opcoes();
        await montar(o, mpv);

        await celularAperta('previous');

        expect(o.onPreviousEpisode, 'o ⏮ do celular nao fez nada (ou voltou duas vezes)').toHaveBeenCalledTimes(1);
        expect(o.onNextEpisode).not.toHaveBeenCalled();
    });

    it('ultimo episodio: o ⏭ respeita a mesma guarda da barra', async () => {
        const o = opcoes({ canGoNext: false });
        await montar(o, mpv);

        await celularAperta('next');

        expect(o.onNextEpisode).not.toHaveBeenCalled();
        expect(o.onPreviousEpisode).not.toHaveBeenCalled();
    });

    it('primeiro episodio: o ⏮ respeita a mesma guarda da barra', async () => {
        const o = opcoes({ canGoPrevious: false });
        await montar(o, mpv);

        await celularAperta('previous');

        expect(o.onPreviousEpisode).not.toHaveBeenCalled();
        expect(o.onNextEpisode).not.toHaveBeenCalled();
    });

    it('a guarda vale o valor ATUAL: o canGoNext que chega depois libera o ⏭', async () => {
        // No Home a lista de episódios chega depois da URL: o canGoNext nasce
        // falso e vira verdadeiro com o player já aberto.
        const o = opcoes({ canGoNext: false });
        await montar(o, mpv);
        await act(async () => { root.render(arvore({ ...o, canGoNext: true })); });

        await celularAperta('next');

        expect(o.onNextEpisode).toHaveBeenCalledTimes(1);
    });

    it('fila de filmes do VOD (sem contentType, como o VOD passa): ⏭ vai pro proximo da fila', async () => {
        const o = opcoes({ contentType: undefined });
        await montar(o, mpv);

        await celularAperta('next');

        expect(o.onNextEpisode, 'o ⏭ do celular nao andou a fila').toHaveBeenCalledTimes(1);
    });

    it('ao vivo nada disso escuta: o zap e do LiveTV', async () => {
        const o = opcoes({ contentType: 'live' });
        await montar(o, mpv);

        await celularAperta('next');
        await celularAperta('previous');

        expect(o.onNextEpisode).not.toHaveBeenCalled();
        expect(o.onPreviousEpisode).not.toHaveBeenCalled();
    });

    it('fechar o player desliga o ouvinte', async () => {
        const o = opcoes();
        await montar(o, mpv);

        await act(async () => { root.render(<></>); });

        expect(quantosOuvem('media:control'), 'sobrou ouvinte depois de fechar').toBe(0);
        await celularAperta('next');
        expect(o.onNextEpisode).not.toHaveBeenCalled();
    });
});
