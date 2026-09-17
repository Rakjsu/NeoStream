/**
 * O motor MPV tem que contar tempo assistido igual ao player interno.
 *
 * Antes deste teste, quem ligava "Player MPV" nas Configuracoes sumia da tela
 * de Estatisticas, da meta diaria do perfil e da Retrospectiva: o
 * MpvPlayerView gravava progresso (movieProgressService/watchProgressService)
 * mas nunca abria sessao no usageStatsService.
 *
 * Aqui o componente e montado DE VERDADE (react-dom/client + act) e o que se
 * mede e o EFEITO no armazenamento, pela mesma porta que as telas leem
 * (usageStatsService.getStats()) — nao a chamada.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { usageStatsService } from '../services/usageStatsService';

/** Status que o mpv "devolve" — mutavel, pra simular pause/fim no meio do teste. */
const mpvEstado = {
    running: true,
    timePos: 0 as number | null,
    duration: null as number | null,
    paused: false,
    eofReached: false,
    volume: 100 as number | null,
    fullscreen: false,
    tracks: [] as unknown[],
    audioTrackId: null as number | null,
    subtitleTrackId: null as number | null,
};
const mpvPlayResult = { success: true as boolean, reason: undefined as string | undefined };

vi.mock('../services/mpvService', () => ({
    mpvService: {
        play: vi.fn(async () => mpvPlayResult),
        stop: vi.fn(async () => undefined),
        getStatus: vi.fn(async () => ({ ...mpvEstado })),
        pause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        seek: vi.fn(async () => undefined),
        setVolume: vi.fn(async () => undefined),
        setFullscreen: vi.fn(async () => undefined),
        setAspect: vi.fn(async () => undefined),
        setAudioTrack: vi.fn(async () => undefined),
        setSubtitleTrack: vi.fn(async () => undefined),
        addSubtitle: vi.fn(async () => undefined),
        addSubtitleFile: vi.fn(async () => undefined),
        adjustSubtitleDelay: vi.fn(async () => undefined),
    },
}));

import MpvPlayerView from './MpvPlayerView';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

/** Monta o player do mpv e deixa o `play()` resolver (fase 'starting' → 'playing'). */
async function montarPlayer(props: Record<string, unknown> = {}) {
    await act(async () => {
        root.render(
            <MpvPlayerView
                streamUrl="http://exemplo/live/9001.ts"
                title="Canal Teste"
                isLive={true}
                contentId="9001"
                contentType="live"
                onClose={() => { }}
                onFallback={() => { }}
                {...props}
            />
        );
    });
}

async function avancar(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe('MpvPlayerView — tempo assistido nas Estatisticas', () => {
    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        mpvEstado.running = true;
        mpvEstado.paused = false;
        mpvEstado.eofReached = false;
        mpvEstado.tracks = [];
        mpvPlayResult.success = true;
        mpvPlayResult.reason = undefined;
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
        vi.setSystemTime(new Date('2026-09-17T20:00:00Z'));
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        usageStatsService.endSession();
        vi.useRealTimers();
        globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('dois minutos de canal ao vivo pelo mpv somam no dia, no tipo e na Retrospectiva', async () => {
        await montarPlayer();
        await avancar(120_000);

        // Desmonta (usuario fechou o player) — a sessao tem que encerrar aqui.
        await act(async () => { root.render(null); });

        const stats = usageStatsService.getStats();
        expect(stats.totalWatchTimeSeconds).toBe(120);
        expect(stats.contentBreakdown.live).toBe(120);
        expect(stats.dailyStats.reduce((soma, d) => soma + d.totalSeconds, 0)).toBe(120);
        expect(stats.contentTotals?.['9001']).toEqual({ name: 'Canal Teste', type: 'live', seconds: 120 });

        // Fechado o player, o relogio de 30 s do servico nao pode ficar orfao.
        await avancar(120_000);
        expect(usageStatsService.getStats().totalWatchTimeSeconds).toBe(120);
    });

    it('mpv que nem sobe nao conta nada — quem assume e o player interno', async () => {
        mpvPlayResult.success = false;
        mpvPlayResult.reason = 'not-found';

        await montarPlayer();
        await avancar(120_000);
        await act(async () => { root.render(null); });

        expect(usageStatsService.getStats().totalWatchTimeSeconds).toBe(0);
    });

    it('o que fica PAUSADO no mpv nao vira tempo assistido', async () => {
        await montarPlayer();
        await avancar(30_000);

        // O pause chega pelo polling de 500 ms. Avanco em dois tempos: se tudo
        // fosse num bloco so, o React aplicaria o estado 'paused' apenas no fim
        // e a hora inteira entraria na conta.
        mpvEstado.paused = true;
        await avancar(1_000);
        await avancar(3_600_000);

        await act(async () => { root.render(null); });

        // ~30 s, nao uma hora. A folga de 1 s e o atraso do polling: o pause so
        // e visto no tique seguinte do relogio de 500 ms.
        const total = usageStatsService.getStats().totalWatchTimeSeconds;
        expect(total).toBeGreaterThanOrEqual(30);
        expect(total).toBeLessThanOrEqual(32);
    });

    it('sem contentId (chamador que nao passa identidade) nao abre sessao fantasma', async () => {
        await montarPlayer({ contentId: undefined });
        await avancar(120_000);
        await act(async () => { root.render(null); });

        expect(usageStatsService.getStats().totalWatchTimeSeconds).toBe(0);
    });
});
