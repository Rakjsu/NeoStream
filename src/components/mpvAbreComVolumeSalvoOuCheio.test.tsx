/**
 * O volume do MPV lembrado entre sessões não pode transformar "nada salvo" em
 * "volume zero".
 *
 * O mpv sobe cada lançamento a 100; o MpvPlayerView reaplica o último volume
 * que a pessoa escolheu (chave `neostream_mpv_volume`). O bug: sem a chave
 * (perfil novo / primeira vez com o MPV), `localStorage.getItem` devolve null
 * e `Number(null) === 0` — passava no filtro 0..100 e o app mandava
 * `setVolume(0)`: o mpv abria MUDO e a faixa mostrava 🔇.
 *
 * O componente é montado DE VERDADE (react-dom/client + act) e o mock do mpv
 * guarda o volume que recebe, como o processo real: o que se confere é o
 * volume em que o mpv ficou e o que a faixa mostra depois do polling.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Volume do "processo" mpv — começa em 100 a cada lançamento, como o real. */
const mpvEstado = { volume: 100 };

vi.mock('../services/mpvService', () => ({
    mpvService: {
        play: vi.fn(async () => ({ success: true })),
        stop: vi.fn(async () => undefined),
        getStatus: vi.fn(async () => ({
            running: true,
            timePos: 10,
            duration: 3600,
            paused: false,
            eofReached: false,
            volume: mpvEstado.volume,
            fullscreen: false,
            tracks: [],
            audioTrackId: null,
            subtitleTrackId: null,
        })),
        pause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        seek: vi.fn(async () => undefined),
        setVolume: vi.fn(async (v: number) => { mpvEstado.volume = v; }),
        setFullscreen: vi.fn(async () => undefined),
        setAspect: vi.fn(async () => undefined),
        setAudioTrack: vi.fn(async () => undefined),
        setSubtitleTrack: vi.fn(async () => undefined),
        addSubtitle: vi.fn(async () => true),
        addSubtitleFile: vi.fn(async () => true),
        adjustSubtitleDelay: vi.fn(async () => undefined),
    },
}));

import { mpvService } from '../services/mpvService';
import MpvPlayerView from './MpvPlayerView';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const CHAVE = 'neostream_mpv_volume';

let container: HTMLDivElement;
let root: Root;

async function avancar(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

/** Monta o player e deixa o `play()` resolver e o polling rodar algumas voltas. */
async function abrirFilme() {
    await act(async () => {
        root.render(
            <MpvPlayerView
                streamUrl="http://exemplo/movie/42.mkv"
                title="Filme Teste"
                isLive={false}
                movieId="42"
                movieName="Filme Teste"
                contentId="42"
                contentType="movie"
                onClose={() => { }}
                onFallback={() => { }}
            />
        );
    });
    await avancar(2_000);
}

const slider = () => container.querySelector('.mpv-view-volume') as HTMLInputElement;
const iconeDoVolume = () => slider().previousElementSibling?.textContent;

describe('volume do MPV lembrado entre sessões', () => {
    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        mpvEstado.volume = 100;
        vi.mocked(mpvService.setVolume).mockClear();
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
        globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('perfil novo (nada salvo): o mpv abre no volume dele, não mudo', async () => {
        await abrirFilme();

        expect(mpvService.setVolume).not.toHaveBeenCalledWith(0);
        expect(mpvEstado.volume).toBe(100);
        expect(slider().value).toBe('100');
        expect(iconeDoVolume()).toBe('🔊');
    });

    it('chave vazia também é "nada salvo"', async () => {
        localStorage.setItem(CHAVE, '');
        await abrirFilme();

        expect(mpvService.setVolume).not.toHaveBeenCalledWith(0);
        expect(mpvEstado.volume).toBe(100);
        expect(iconeDoVolume()).toBe('🔊');
    });

    it('volume salvo (40) é reaplicado ao abrir', async () => {
        localStorage.setItem(CHAVE, '40');
        await abrirFilme();

        expect(mpvService.setVolume).toHaveBeenCalledWith(40);
        expect(mpvEstado.volume).toBe(40);
        expect(slider().value).toBe('40');
        expect(iconeDoVolume()).toBe('🔉');
    });

    it('um 0 gravado de propósito continua valendo', async () => {
        localStorage.setItem(CHAVE, '0');
        await abrirFilme();

        expect(mpvService.setVolume).toHaveBeenCalledWith(0);
        expect(mpvEstado.volume).toBe(0);
        expect(iconeDoVolume()).toBe('🔇');
    });
});
