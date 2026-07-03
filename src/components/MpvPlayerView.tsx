/**
 * EXPERIMENTAL — MPV playback engine, phase 2 (pseudo-embedded).
 *
 * The mpv window is borderless/always-on-top and glued by the main process
 * over the app window's client area, except for a bottom strip of
 * CONTROLS_HEIGHT px reserved for this component's themed controls bar
 * (must match MPV_CONTROLS_HEIGHT in electron/mpvProtocol.ts).
 *
 * Responsibilities:
 *   - launch mpv on mount (with --start for resume), stop it on unmount
 *   - poll mpv:status every 500ms → play/pause state, seek bar, volume, fs
 *   - persist watch progress: movies via movieProgressService, series
 *     episodes via watchProgressService (same write APIs as VideoPlayer)
 *   - keyboard shortcuts while the app window is focused
 *   - fall back to the internal player when mpv is missing/fails
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { mpvService } from '../services/mpvService';
import { movieProgressService } from '../services/movieProgressService';
import { watchProgressService } from '../services/watchProgressService';
import { useLanguage } from '../services/languageService';
import { profileService } from '../services/profileService';
import { trackPrefKey, trackLang, choosePreferredTracks, type TrackPref } from '../utils/mpvTrackPrefs';
import { autoFetchSubtitle, cleanupSubtitleUrl, SUBTITLE_LANGUAGE_OPTIONS } from '../services/subtitleService';

/** Must match MPV_CONTROLS_HEIGHT in electron/mpvProtocol.ts. */
const CONTROLS_HEIGHT = 96;
const STATUS_POLL_INTERVAL_MS = 500;
const PROGRESS_SAVE_INTERVAL_MS = 15000;
const SEEK_STEP_SECONDS = 10;
const VOLUME_STEP = 5;

interface MpvPlayerViewProps {
    streamUrl: string;
    title: string;
    startSeconds?: number | null;
    /** Persist movie progress (Continue Assistindo) — omit for live/series. */
    movieId?: string;
    movieName?: string;
    /** Persist episode progress — all three required for series. */
    seriesId?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    isLive: boolean;
    /** User stopped playback (or mpv exited) — close the player UI. */
    onClose: () => void;
    /** mpv unavailable / failed to launch — caller falls back to the internal player. */
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

export function MpvPlayerView({
    streamUrl,
    title,
    startSeconds,
    movieId,
    movieName,
    seriesId,
    seasonNumber,
    episodeNumber,
    isLive,
    onClose,
    onFallback
}: MpvPlayerViewProps) {
    const { t } = useLanguage();
    const [phase, setPhase] = useState<'starting' | 'playing'>('starting');
    const [timePos, setTimePos] = useState<number | null>(null);
    const [duration, setDuration] = useState<number | null>(null);
    const [paused, setPaused] = useState(false);
    const [volume, setVolume] = useState<number | null>(null);
    const [fullscreen, setFullscreen] = useState(false);
    const [tracks, setTracks] = useState<import('../services/mpvService').MpvTrack[]>([]);
    const [audioTrackId, setAudioTrackId] = useState<number | null>(null);
    const [subtitleTrackId, setSubtitleTrackId] = useState<number | null>(null);
    /** While the user drags the seek slider, show the drag value instead of polled time. */
    const [seekDrag, setSeekDrag] = useState<number | null>(null);
    // Subtitle sync offset (display only; mpv holds the real sub-delay)
    const [subDelay, setSubDelay] = useState(0);
    const nudgeSubDelay = useCallback((delta: number) => {
        setSubDelay(prev => Math.round((prev + delta) * 2) / 2);
        void mpvService.adjustSubtitleDelay(delta);
    }, []);

    // Aspect override cycle: source → 16:9 → 4:3 → source…
    const ASPECTS: Array<{ value: -1 | '16:9' | '4:3'; label: string }> = [
        { value: -1, label: 'Auto' },
        { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' }
    ];
    const [aspectIndex, setAspectIndex] = useState(0);
    const cycleAspect = useCallback(() => {
        setAspectIndex(prev => {
            const next = (prev + 1) % ASPECTS.length;
            void mpvService.setAspect(ASPECTS[next].value);
            return next;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ASPECTS is a render-stable literal
    }, []);

    // External subtitle search (OpenSubtitles → temp .vtt → mpv sub-add)
    const [showSubSearch, setShowSubSearch] = useState(false);
    const [subSearchBusy, setSubSearchBusy] = useState(false);
    const [subSearchMsg, setSubSearchMsg] = useState<string | null>(null);

    const closedRef = useRef(false);
    const lastProgressSaveRef = useRef(0);
    const lastVolumeBeforeMuteRef = useRef(100);
    const latestRef = useRef<{ timePos: number | null; duration: number | null; paused: boolean; volume: number | null; fullscreen: boolean }>({
        timePos: null,
        duration: null,
        paused: false,
        volume: null,
        fullscreen: false,
    });

    const isSeries = Boolean(seriesId) && seasonNumber !== undefined && episodeNumber !== undefined;

    const persistProgress = useCallback((time: number | null, total: number | null, force = false) => {
        if (isLive || time === null || !total || total <= 0) return;
        const now = Date.now();
        if (!force && now - lastProgressSaveRef.current < PROGRESS_SAVE_INTERVAL_MS) return;
        lastProgressSaveRef.current = now;

        if (isSeries && seriesId && seasonNumber !== undefined && episodeNumber !== undefined) {
            watchProgressService.saveVideoTime(seriesId, seasonNumber, episodeNumber, time, total);
        } else if (movieId) {
            movieProgressService.saveMovieTime(movieId, movieName || title, time, total);
        }
    }, [isLive, isSeries, seriesId, seasonNumber, episodeNumber, movieId, movieName, title]);

    const stopPlayback = useCallback(() => {
        if (closedRef.current) return;
        closedRef.current = true;
        const latest = latestRef.current;
        persistProgress(latest.timePos, latest.duration, true);
        mpvService.stop();
        onClose();
    }, [persistProgress, onClose]);

    // Launch mpv once on mount; poll status while it runs.
    useEffect(() => {
        let cancelled = false;
        let pollTimer: ReturnType<typeof setInterval> | null = null;

        const startPolling = () => {
            pollTimer = setInterval(async () => {
                const status = await mpvService.getStatus();
                if (cancelled) return;

                if (!status || !status.running || status.eofReached) {
                    // mpv exited / playback finished — close the in-app view too.
                    if (!closedRef.current) {
                        closedRef.current = true;
                        const latest = latestRef.current;
                        if (status?.eofReached) {
                            // Finished: save the end position so it's marked completed.
                            persistProgress(latest.duration, latest.duration, true);
                        } else {
                            persistProgress(latest.timePos, latest.duration, true);
                        }
                        onClose();
                    }
                    return;
                }

                latestRef.current = {
                    timePos: status.timePos,
                    duration: status.duration,
                    paused: status.paused,
                    volume: status.volume,
                    fullscreen: status.fullscreen,
                };
                setTimePos(status.timePos);
                setDuration(status.duration);
                setPaused(status.paused);
                setVolume(status.volume);
                setFullscreen(status.fullscreen);
                setTracks(status.tracks ?? []);
                setAudioTrackId(status.audioTrackId ?? null);
                setSubtitleTrackId(status.subtitleTrackId ?? null);
                persistProgress(status.timePos, status.duration);
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
            // Leaving the view always stops the external player so no orphan
            // mpv window keeps streaming in the background.
            if (!closedRef.current) {
                closedRef.current = true;
                const latest = latestRef.current;
                persistProgress(latest.timePos, latest.duration, true);
                mpvService.stop();
            }
        };
        // Intentionally mount-only: one view instance == one mpv launch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const togglePause = useCallback(() => {
        const next = !latestRef.current.paused;
        latestRef.current.paused = next;
        setPaused(next);
        if (next) {
            mpvService.pause();
        } else {
            mpvService.resume();
        }
    }, []);

    const seekBy = useCallback((deltaSeconds: number) => {
        const { timePos: time, duration: total } = latestRef.current;
        if (time === null) return;
        const target = Math.max(0, total !== null ? Math.min(total, time + deltaSeconds) : time + deltaSeconds);
        latestRef.current.timePos = target;
        setTimePos(target);
        mpvService.seek(target);
    }, []);

    const changeVolume = useCallback((value: number) => {
        const clamped = Math.round(Math.min(100, Math.max(0, value)));
        if (clamped > 0) lastVolumeBeforeMuteRef.current = clamped;
        latestRef.current.volume = clamped;
        setVolume(clamped);
        mpvService.setVolume(clamped);
    }, []);

    // Cycle buttons (the mpv window covers everything above the controls
    // strip, so dropdown menus can't render — cycling fits the 96px bar).
    const trackLabel = (track: import('../services/mpvService').MpvTrack | undefined, fallback: string) =>
        track ? (track.lang?.toUpperCase() || track.title || `#${track.id}`) : fallback;

    const audioTracks = tracks.filter(tr => tr.type === 'audio');
    const subTracks = tracks.filter(tr => tr.type === 'sub');

    // Track choice remembered per content (movie/series), per profile — keyed
    // by LANGUAGE so it carries across episodes of the same series.
    const prefsStorageKey = () => `neostream_mpv_tracks_${profileService.getActiveProfile()?.id ?? 'default'}`;
    const contentKey = trackPrefKey(movieId, seriesId);

    const savePref = useCallback((patch: Partial<TrackPref>) => {
        if (!contentKey) return;
        try {
            const key = prefsStorageKey();
            const all = JSON.parse(localStorage.getItem(key) || '{}');
            all[contentKey] = { audioLang: null, subLang: null, ...all[contentKey], ...patch };
            localStorage.setItem(key, JSON.stringify(all));
        } catch { /* best-effort */ }
    }, [contentKey]);

    // Re-apply the remembered choice once the file's tracks show up.
    const prefsAppliedRef = useRef(false);
    useEffect(() => {
        if (prefsAppliedRef.current || tracks.length === 0 || !contentKey) return;
        prefsAppliedRef.current = true;
        // Deferred: applying the saved pick sets state; keep it off the
        // effect's synchronous path.
        queueMicrotask(() => {
            try {
                const all = JSON.parse(localStorage.getItem(prefsStorageKey()) || '{}');
                const chosen = choosePreferredTracks(tracks, all[contentKey]);
                if (chosen.audioId !== undefined) {
                    setAudioTrackId(chosen.audioId);
                    mpvService.setAudioTrack(chosen.audioId);
                }
                if (chosen.subtitleId !== undefined) {
                    setSubtitleTrackId(chosen.subtitleId);
                    mpvService.setSubtitleTrack(chosen.subtitleId);
                }
            } catch { /* best-effort */ }
        });
    }, [tracks, contentKey]);

    const cycleAudioTrack = useCallback(() => {
        const list = tracks.filter(tr => tr.type === 'audio');
        if (list.length < 2) return;
        const idx = list.findIndex(tr => tr.id === audioTrackId);
        const next = list[(idx + 1) % list.length];
        setAudioTrackId(next.id);
        mpvService.setAudioTrack(next.id);
        savePref({ audioLang: trackLang(next) });
    }, [tracks, audioTrackId, savePref]);

    const cycleSubtitleTrack = useCallback(() => {
        const list = tracks.filter(tr => tr.type === 'sub');
        if (list.length === 0) return;
        const idx = subtitleTrackId === null ? -1 : list.findIndex(tr => tr.id === subtitleTrackId);
        // off → 1 → 2 → ... → off
        const next = idx + 1 < list.length ? list[idx + 1] : null;
        setSubtitleTrackId(next ? next.id : null);
        mpvService.setSubtitleTrack(next ? next.id : null);
        savePref({ subLang: next ? trackLang(next) : 'off' });
    }, [tracks, subtitleTrackId, savePref]);

    // Search an external subtitle for this content and hand it to mpv.
    const searchExternalSubtitle = useCallback(async (language: string, label: string) => {
        setShowSubSearch(false);
        setSubSearchBusy(true);
        setSubSearchMsg(t('player', 'fetchingSubtitles'));
        try {
            const result = await autoFetchSubtitle({
                title,
                season: seasonNumber,
                episode: episodeNumber,
                language
            });
            if (result?.vttContent) {
                const ok = await mpvService.addSubtitle(result.vttContent, label, result.language);
                setSubSearchMsg(ok ? `💬 ${label}` : t('player', 'errorLoadingSubtitles'));
                cleanupSubtitleUrl(result.url);
            } else {
                setSubSearchMsg(t('player', 'noSubtitlesFound'));
            }
        } catch {
            setSubSearchMsg(t('player', 'errorLoadingSubtitles'));
        } finally {
            setSubSearchBusy(false);
            setTimeout(() => setSubSearchMsg(null), 4000);
        }
    }, [title, seasonNumber, episodeNumber, t]);

    const toggleMute = useCallback(() => {
        const current = latestRef.current.volume ?? 100;
        if (current > 0) {
            lastVolumeBeforeMuteRef.current = current;
            latestRef.current.volume = 0;
            setVolume(0);
            mpvService.setVolume(0);
        } else {
            changeVolume(lastVolumeBeforeMuteRef.current || 100);
        }
    }, [changeVolume]);

    const toggleFullscreen = useCallback(() => {
        const next = !latestRef.current.fullscreen;
        latestRef.current.fullscreen = next;
        setFullscreen(next);
        mpvService.setFullscreen(next);
    }, []);

    // Keyboard shortcuts (active while the app window is focused — when the
    // mpv window itself has focus, mpv's own default bindings apply).
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

            switch (event.code) {
                case 'Space':
                    event.preventDefault();
                    togglePause();
                    break;
                case 'ArrowLeft':
                    if (!isLive) {
                        event.preventDefault();
                        seekBy(-SEEK_STEP_SECONDS);
                    }
                    break;
                case 'ArrowRight':
                    if (!isLive) {
                        event.preventDefault();
                        seekBy(SEEK_STEP_SECONDS);
                    }
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    changeVolume((latestRef.current.volume ?? 100) + VOLUME_STEP);
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    changeVolume((latestRef.current.volume ?? 100) - VOLUME_STEP);
                    break;
                case 'KeyF':
                    event.preventDefault();
                    toggleFullscreen();
                    break;
                case 'KeyM':
                    event.preventDefault();
                    toggleMute();
                    break;
                case 'Escape':
                    event.preventDefault();
                    stopPlayback();
                    break;
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [togglePause, seekBy, changeVolume, toggleFullscreen, toggleMute, stopPlayback, isLive]);

    const shownTime = seekDrag ?? timePos;
    const seekMax = duration && duration > 0 ? duration : 0;
    const seekPercent = seekMax > 0 && shownTime !== null ? Math.min(100, (shownTime / seekMax) * 100) : 0;
    const volumeValue = volume ?? 100;

    const commitSeek = () => {
        if (seekDrag === null) return;
        latestRef.current.timePos = seekDrag;
        setTimePos(seekDrag);
        mpvService.seek(seekDrag);
        setSeekDrag(null);
    };

    return (
        <>
            <style>{viewStyles}</style>
            <div className="mpv-view-backdrop">
                {/* Everything above the controls bar is covered by the mpv
                    window once playback starts; this area is only visible
                    while mpv is starting (or if it loses its position). */}
                <div className="mpv-view-stage">
                    {phase === 'starting' && (
                        <div className="mpv-view-loading">
                            <div className="mpv-view-badge">MPV · EXPERIMENTAL</div>
                            <div className="mpv-view-loading-icon">🎞️</div>
                            <p>{t('playback', 'mpvStarting') || 'Abrindo o MPV...'}</p>
                        </div>
                    )}
                </div>

                <div className="mpv-view-controls" style={{ height: CONTROLS_HEIGHT }}>
                    {subSearchMsg && <div className="mpv-view-subsearch-msg">{subSearchMsg}</div>}
                    {!isLive && (
                        <input
                            className="mpv-view-seek"
                            type="range"
                            min={0}
                            max={seekMax || 1}
                            step={1}
                            value={shownTime ?? 0}
                            disabled={seekMax <= 0}
                            aria-label="seek"
                            style={{
                                background: `linear-gradient(to right, var(--ns-accent) 0%, var(--ns-accent-grad-to, var(--ns-accent)) ${seekPercent}%, rgba(255, 255, 255, 0.15) ${seekPercent}%)`
                            }}
                            onChange={(e) => setSeekDrag(Number(e.target.value))}
                            onPointerUp={commitSeek}
                            onKeyUp={commitSeek}
                        />
                    )}

                    <div className="mpv-view-controls-row">
                        <div className="mpv-view-controls-left">
                            <button
                                className="mpv-view-btn mpv-view-btn-play"
                                onClick={togglePause}
                                title={paused ? (t('playback', 'mpvPlay') || 'Reproduzir') : (t('playback', 'mpvPause') || 'Pausar')}
                            >
                                {paused ? '▶' : '⏸'}
                            </button>
                            {isLive ? (
                                <span className="mpv-view-live-badge">● {t('playback', 'mpvLive') || 'AO VIVO'}</span>
                            ) : (
                                <span className="mpv-view-time">
                                    {formatTime(shownTime)} / {formatTime(duration)}
                                </span>
                            )}
                        </div>

                        <div className="mpv-view-title" title={title}>{title}</div>

                        <div className="mpv-view-controls-right">
                            {audioTracks.length > 1 && (
                                <button
                                    className="mpv-view-btn"
                                    onClick={cycleAudioTrack}
                                    title={`${t('player', 'audioTrack')} (${audioTracks.length})`}
                                >
                                    🎧 {trackLabel(audioTracks.find(tr => tr.id === audioTrackId), '—')}
                                </button>
                            )}
                            {!isLive && (
                                <div style={{ position: 'relative' }}>
                                    <button
                                        className="mpv-view-btn"
                                        onClick={() => setShowSubSearch(v => !v)}
                                        disabled={subSearchBusy}
                                        title={t('player', 'subtitleLanguage')}
                                    >
                                        {subSearchBusy ? '⏳' : '🔍'}💬
                                    </button>
                                    {showSubSearch && (
                                        <div className="mpv-view-subsearch">
                                            {SUBTITLE_LANGUAGE_OPTIONS.map(opt => (
                                                <button
                                                    key={opt.code}
                                                    className="mpv-view-subsearch-option"
                                                    onClick={() => void searchExternalSubtitle(opt.code, opt.label)}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            <button
                                className="mpv-view-btn"
                                onClick={cycleAspect}
                                title={`${t('player', 'aspectRatio')}: ${ASPECTS[aspectIndex].label}`}
                            >
                                📐 {ASPECTS[aspectIndex].label}
                            </button>
                            {!isLive && (subTracks.length > 0 || subDelay !== 0) && (
                                <>
                                    <button
                                        className="mpv-view-btn"
                                        onClick={() => nudgeSubDelay(-0.5)}
                                        title={`${t('player', 'subtitleSync')} −0,5s`}
                                    >
                                        💬−
                                    </button>
                                    {subDelay !== 0 && (
                                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' }}>
                                            {subDelay > 0 ? '+' : ''}{subDelay.toFixed(1)}s
                                        </span>
                                    )}
                                    <button
                                        className="mpv-view-btn"
                                        onClick={() => nudgeSubDelay(0.5)}
                                        title={`${t('player', 'subtitleSync')} +0,5s`}
                                    >
                                        💬+
                                    </button>
                                </>
                            )}
                            {subTracks.length > 0 && (
                                <button
                                    className="mpv-view-btn"
                                    onClick={cycleSubtitleTrack}
                                    title={`${t('player', 'subtitleLanguage')} (${subTracks.length})`}
                                >
                                    💬 {subtitleTrackId === null ? t('player', 'subtitlesOff') : trackLabel(subTracks.find(tr => tr.id === subtitleTrackId), '—')}
                                </button>
                            )}
                            <button
                                className="mpv-view-btn"
                                onClick={toggleMute}
                                title={t('playback', 'mpvVolume') || 'Volume'}
                            >
                                {volumeValue <= 0 ? '🔇' : volumeValue < 50 ? '🔉' : '🔊'}
                            </button>
                            <input
                                className="mpv-view-volume"
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={volumeValue}
                                aria-label={t('playback', 'mpvVolume') || 'Volume'}
                                style={{
                                    background: `linear-gradient(to right, var(--ns-accent) ${volumeValue}%, rgba(255, 255, 255, 0.15) ${volumeValue}%)`
                                }}
                                onChange={(e) => changeVolume(Number(e.target.value))}
                            />
                            <button
                                className="mpv-view-btn"
                                onClick={toggleFullscreen}
                                title={t('playback', 'mpvFullscreen') || 'Tela cheia'}
                            >
                                {fullscreen ? '🗗' : '⛶'}
                            </button>
                            <button
                                className="mpv-view-btn mpv-view-btn-stop"
                                onClick={stopPlayback}
                                title={t('playback', 'mpvStop') || 'Parar'}
                            >
                                ⏹ {t('playback', 'mpvStop') || 'Parar'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

const viewStyles = `
    .mpv-view-subsearch {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        background: rgba(10, 10, 14, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        padding: 6px;
        min-width: 170px;
        z-index: 10;
    }

    .mpv-view-subsearch-option {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.85);
        font-size: 13px;
        text-align: left;
        padding: 7px 10px;
        border-radius: 6px;
        cursor: pointer;
    }

    .mpv-view-subsearch-option:hover {
        background: rgba(var(--ns-accent-rgb), 0.25);
        color: white;
    }

    .mpv-view-subsearch-msg {
        position: absolute;
        top: -34px;
        right: 16px;
        background: rgba(10, 10, 14, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        padding: 5px 12px;
        color: rgba(255, 255, 255, 0.9);
        font-size: 12px;
        font-weight: 600;
    }

    .mpv-view-backdrop {
        position: fixed;
        /* 36px: leaves the app's CustomTitleBar visible/clickable while mpv
           plays (drag, minimize, maximize, close). Must match
           MPV_TITLEBAR_HEIGHT in electron/mpvProtocol.ts and the height in
           CustomTitleBar.css. */
        inset: 36px 0 0 0;
        z-index: 99999;
        background: #000;
        display: flex;
        flex-direction: column;
    }

    .mpv-view-stage {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 0;
    }

    .mpv-view-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        color: rgba(255, 255, 255, 0.75);
        font-size: 15px;
    }

    .mpv-view-loading p {
        margin: 0;
    }

    .mpv-view-badge {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.5px;
        color: #fbbf24;
        border: 1px solid rgba(251, 191, 36, 0.4);
        border-radius: 999px;
        padding: 4px 12px;
    }

    .mpv-view-loading-icon {
        font-size: 44px;
    }

    .mpv-view-controls {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 10px;
        padding: 0 20px;
        box-sizing: border-box;
        background: var(--ns-bg-secondary, #0f0f23);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .mpv-view-seek,
    .mpv-view-volume {
        -webkit-appearance: none;
        appearance: none;
        height: 5px;
        border-radius: 999px;
        outline: none;
        cursor: pointer;
    }

    .mpv-view-seek {
        width: 100%;
    }

    .mpv-view-seek:disabled {
        cursor: default;
        opacity: 0.4;
    }

    .mpv-view-volume {
        width: 90px;
    }

    .mpv-view-seek::-webkit-slider-thumb,
    .mpv-view-volume::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--ns-accent, #6366f1);
        border: 2px solid #fff;
        cursor: pointer;
    }

    .mpv-view-controls-row {
        display: flex;
        align-items: center;
        gap: 16px;
    }

    .mpv-view-controls-left,
    .mpv-view-controls-right {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
    }

    .mpv-view-title {
        flex: 1;
        min-width: 0;
        text-align: center;
        color: rgba(255, 255, 255, 0.85);
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .mpv-view-time {
        color: rgba(255, 255, 255, 0.6);
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    .mpv-view-live-badge {
        color: #ef4444;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 1px;
        white-space: nowrap;
    }

    .mpv-view-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font-size: 14px;
        cursor: pointer;
        transition: background 0.15s ease, transform 0.15s ease;
    }

    .mpv-view-btn:hover {
        background: rgba(255, 255, 255, 0.14);
    }

    .mpv-view-btn-play {
        background: linear-gradient(135deg, var(--ns-accent, #6366f1), var(--ns-accent-grad-to, #8b5cf6));
        border: none;
        min-width: 44px;
        justify-content: center;
    }

    .mpv-view-btn-play:hover {
        transform: scale(1.05);
    }

    .mpv-view-btn-stop {
        border-color: rgba(239, 68, 68, 0.5);
        color: #fca5a5;
        font-weight: 600;
    }

    .mpv-view-btn-stop:hover {
        background: rgba(239, 68, 68, 0.2);
    }
`;

export default MpvPlayerView;
