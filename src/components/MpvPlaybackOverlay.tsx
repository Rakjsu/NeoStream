/**
 * EXPERIMENTAL — MPV playback engine PoC.
 *
 * Compact in-app overlay shown instead of the internal VideoPlayer while an
 * external MPV window is playing. Launches mpv on mount, polls mpv:status,
 * persists movie progress (Continue Assistindo) and falls back to the
 * internal player when mpv is missing or fails to start.
 */
import { useEffect, useRef, useState } from 'react';
import { mpvService } from '../services/mpvService';
import { movieProgressService } from '../services/movieProgressService';

const PROGRESS_SAVE_INTERVAL_MS = 15000;
const STATUS_POLL_INTERVAL_MS = 1500;

interface MpvPlaybackOverlayProps {
    streamUrl: string;
    title: string;
    startSeconds?: number | null;
    /** Persist progress for Continue Assistindo (movies only — omit for live). */
    movieId?: string;
    movieName?: string;
    isLive: boolean;
    /** User stopped playback (or mpv exited) — close the player UI. */
    onClose: () => void;
    /** mpv unavailable / failed to launch — caller should fall back to the internal player. */
    onFallback: (reason: string) => void;
}

function formatTime(seconds: number | null): string {
    if (seconds === null || !isFinite(seconds) || seconds < 0) return '--:--';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function MpvPlaybackOverlay({
    streamUrl,
    title,
    startSeconds,
    movieId,
    movieName,
    isLive,
    onClose,
    onFallback
}: MpvPlaybackOverlayProps) {
    const [phase, setPhase] = useState<'starting' | 'playing'>('starting');
    const [timePos, setTimePos] = useState<number | null>(null);
    const [duration, setDuration] = useState<number | null>(null);
    const lastProgressSaveRef = useRef(0);
    const closedRef = useRef(false);

    // Launch mpv once on mount; poll status while it runs.
    useEffect(() => {
        let cancelled = false;
        let pollTimer: ReturnType<typeof setInterval> | null = null;

        const saveProgress = (time: number | null, total: number | null) => {
            if (isLive || !movieId || time === null || !total || total <= 0) return;
            const now = Date.now();
            if (now - lastProgressSaveRef.current < PROGRESS_SAVE_INTERVAL_MS) return;
            lastProgressSaveRef.current = now;
            movieProgressService.saveMovieTime(movieId, movieName || title, time, total);
        };

        const startPolling = () => {
            pollTimer = setInterval(async () => {
                const status = await mpvService.getStatus();
                if (cancelled) return;

                if (!status || !status.running || status.eofReached) {
                    // mpv window closed / playback finished — close the in-app overlay too.
                    if (!closedRef.current) {
                        closedRef.current = true;
                        onClose();
                    }
                    return;
                }

                setTimePos(status.timePos);
                setDuration(status.duration);
                saveProgress(status.timePos, status.duration);
            }, STATUS_POLL_INTERVAL_MS);
        };

        mpvService.play(streamUrl, title, startSeconds ?? undefined).then((result) => {
            if (cancelled) return;
            if (!result.success) {
                console.warn(`[MPV] indisponível (${result.reason}) — usando o player interno.`);
                onFallback(result.reason || 'unknown');
                return;
            }
            setPhase('playing');
            startPolling();
        });

        return () => {
            cancelled = true;
            if (pollTimer) clearInterval(pollTimer);
            // PoC: leaving the overlay always stops the external player so no
            // orphan mpv window keeps streaming in the background.
            if (!closedRef.current) {
                mpvService.stop();
            }
        };
        // Intentionally mount-only: one overlay instance == one mpv launch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleStop = () => {
        closedRef.current = true;
        mpvService.stop();
        onClose();
    };

    return (
        <>
            <style>{overlayStyles}</style>
            <div className="mpv-overlay-backdrop">
                <div className="mpv-overlay-card">
                    <div className="mpv-overlay-badge">MPV · EXPERIMENTAL</div>
                    <div className="mpv-overlay-icon">🎞️</div>
                    <h2 className="mpv-overlay-title">{title}</h2>
                    <p className="mpv-overlay-text">
                        {phase === 'starting'
                            ? 'Abrindo o MPV...'
                            : 'Reproduzindo no MPV — controles no próprio player.'}
                    </p>
                    {phase === 'playing' && !isLive && (
                        <p className="mpv-overlay-time">
                            {formatTime(timePos)} / {formatTime(duration)}
                        </p>
                    )}
                    <button className="mpv-overlay-stop" onClick={handleStop}>
                        ⏹ Parar
                    </button>
                </div>
            </div>
        </>
    );
}

const overlayStyles = `
    .mpv-overlay-backdrop {
        position: fixed;
        inset: 0;
        z-index: 99999;
        background: radial-gradient(ellipse at center, rgba(15, 15, 26, 0.97) 0%, rgba(0, 0, 0, 0.99) 100%);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .mpv-overlay-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        padding: 40px 48px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.1);
        max-width: 460px;
        text-align: center;
    }

    .mpv-overlay-badge {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.5px;
        color: #fbbf24;
        border: 1px solid rgba(251, 191, 36, 0.4);
        border-radius: 999px;
        padding: 4px 12px;
    }

    .mpv-overlay-icon {
        font-size: 44px;
    }

    .mpv-overlay-title {
        color: white;
        font-size: 18px;
        font-weight: 600;
        margin: 0;
    }

    .mpv-overlay-text {
        color: rgba(255, 255, 255, 0.7);
        font-size: 14px;
        margin: 0;
    }

    .mpv-overlay-time {
        color: rgba(255, 255, 255, 0.5);
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        margin: 0;
    }

    .mpv-overlay-stop {
        margin-top: 8px;
        padding: 12px 28px;
        background: linear-gradient(135deg, #ef4444, #dc2626);
        border: none;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s ease;
    }

    .mpv-overlay-stop:hover {
        transform: scale(1.05);
    }
`;

export default MpvPlaybackOverlay;
