import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Volume2, Volume1, Volume, VolumeX, Maximize, Minimize, Cast, Captions, PictureInPicture2 } from 'lucide-react';
import { useVideoPlayer } from '../../hooks/useVideoPlayer';
import { useHls } from '../../hooks/useHls';
import { useMediaSession } from '../../hooks/useMediaSession';
import { CastDeviceSelector } from '../CastDeviceSelector';
import { CastControls } from '../CastControls';
import { formatTime, percentage } from '../../utils/videoHelpers';
import { usageStatsService } from '../../services/usageStatsService';
import { SubtitleOverlay } from './SubtitleOverlay';
import { useSubtitleManager } from './useSubtitleManager';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { PlayerSettingsMenu } from './PlayerSettingsMenu';
import { useSleepTimer, formatSleepCountdown } from './useSleepTimer';
import { aspectPrefs, aspectPrefKey } from '../../utils/aspectPrefs';
import { ForcedSubtitlesMenu } from './ForcedSubtitlesMenu';
import { ChannelZapOverlay, type PlayerChannel } from './ChannelZapOverlay';
import { useLanguage } from '../../services/languageService';
import './VideoPlayer.css';

import type { MovieVersion } from '../../services/movieVersionService';
import type { SwitchableContent } from './PlayerSettingsMenu';

// Live TV quality variant type (matches LiveTV.tsx structure)
export interface QualityVariant<TChannel = unknown> {
    channel: TChannel;
    quality: string;
    priority: number;
    label: string;
}

export interface VideoPlayerProps<TSwitchContent extends SwitchableContent = SwitchableContent> {
    src: string;
    title?: string;
    poster?: string;
    onClose?: () => void;
    autoPlay?: boolean;
    onNextEpisode?: () => void;
    onPreviousEpisode?: () => void;
    canGoNext?: boolean;
    canGoPrevious?: boolean;
    resumeTime?: number | null; // Time in seconds to resume from
    onTimeUpdate?: (currentTime: number, duration: number) => void; // Callback for video progress
    // Usage stats tracking
    contentId?: string;
    contentType?: 'movie' | 'series' | 'live';
    genre?: string;
    // For series PiP expand
    seasonNumber?: number;
    episodeNumber?: number;
    // Movie version switching
    movieVersions?: MovieVersion<TSwitchContent>[];
    currentMovieId?: number;
    onSwitchVersion?: (movie: TSwitchContent, currentTime: number) => void;
    // Subtitle search
    tmdbId?: string | number;
    imdbId?: string;
    // If true, movie is already subtitled (has [L] in name), hide subtitle button
    isSubtitled?: boolean;
    // Live TV quality fallback
    liveQualityVariants?: QualityVariant<TSwitchContent>[];
    currentQualityIndex?: number;
    // Live TV zapping (channel list inside the player)
    channelList?: PlayerChannel[];
    onSwitchChannel?: (id: string | number) => void;
    /** Override the end-of-video countdown texts (e.g. movie queue: "A seguir em"). */
    nextCountdownLabel?: string;
    nextActionLabel?: string;
    /** Live TV mini-EPG shown under the title (now / next + progress). */
    liveEpg?: {
        nowTitle: string;
        timeRange?: string;
        progressPct?: number;
        nextTitle?: string;
    };
}

function VideoPlayerImpl<TSwitchContent extends SwitchableContent = SwitchableContent>({
    src,
    title,
    poster,
    onClose,
    autoPlay = false,
    onNextEpisode,
    onPreviousEpisode,
    canGoNext,
    canGoPrevious,
    resumeTime,
    onTimeUpdate,
    contentId,
    contentType = 'movie',
    genre,
    seasonNumber,
    episodeNumber,
    movieVersions,
    currentMovieId,
    onSwitchVersion,
    tmdbId,
    imdbId,
    isSubtitled,
    liveQualityVariants,
    currentQualityIndex = 0,
    channelList,
    onSwitchChannel,
    nextCountdownLabel,
    nextActionLabel,
    liveEpg
}: VideoPlayerProps<TSwitchContent>) {
    const { videoRef, state, controls } = useVideoPlayer();
    const { t } = useLanguage();
    const [streamErrorToast, setStreamErrorToast] = useState<string | null>(null);

    // Handle stream error for fallback
    const handleStreamError = useCallback(() => {
        if (contentType === 'live' && liveQualityVariants && liveQualityVariants.length > 1) {
            // Find next lower quality variant
            const nextIndex = currentQualityIndex + 1;
            if (nextIndex < liveQualityVariants.length && onSwitchVersion) {
                const nextVariant = liveQualityVariants[nextIndex];
                console.log(`[Fallback] Switching from index ${currentQualityIndex} to ${nextIndex}: ${nextVariant.label}`);
                setStreamErrorToast(`${t('player', 'streamFallback')} ${nextVariant.label}...`);
                setTimeout(() => setStreamErrorToast(null), 3000);
                onSwitchVersion(nextVariant.channel, 0);
            } else {
                console.warn('[Fallback] No more quality variants available');
                setStreamErrorToast(t('player', 'streamUnavailable'));
                setTimeout(() => setStreamErrorToast(null), 5000);
            }
        }
    }, [contentType, liveQualityVariants, currentQualityIndex, onSwitchVersion, t]);

    // ---- Rescue transcode -------------------------------------------------
    // Fatal media errors (HEVC/AC3 the browser can't play) trigger a one-shot
    // ffmpeg rescue: the main process re-encodes the stream into a local live
    // HLS and the player swaps to it. Reset per src; disabled by config.
    const [rescue, setRescue] = useState<{ src: string; id: string } | null>(null);
    const rescueAttemptedRef = useRef<string | null>(null);

    const attemptRescue = useCallback(() => {
        if (!src || rescueAttemptedRef.current === src) return;
        if (localStorage.getItem('neostream_transcode_rescue') === '0') return;
        rescueAttemptedRef.current = src;
        setStreamErrorToast(t('player', 'transcodeTrying'));
        void (async () => {
            try {
                const result = await window.ipcRenderer.invoke('transcode:start', { url: src }) as {
                    success: boolean; id?: string; playUrl?: string;
                };
                if (result.success && result.playUrl && result.id) {
                    setRescue({ src: result.playUrl, id: result.id });
                    setStreamErrorToast(t('player', 'transcodeActive'));
                    setTimeout(() => setStreamErrorToast(null), 5000);
                } else {
                    setStreamErrorToast(null);
                }
            } catch {
                setStreamErrorToast(null);
            }
        })();
    }, [src, t]);

    // New source: drop any previous rescue session (deferred setState).
    useEffect(() => {
        rescueAttemptedRef.current = null;
        queueMicrotask(() => setRescue(prev => {
            if (prev) void window.ipcRenderer.invoke('transcode:stop', { id: prev.id }).catch(() => undefined);
            return null;
        }));
    }, [src]);
    useEffect(() => () => {
        setRescue(prev => {
            if (prev) void window.ipcRenderer.invoke('transcode:stop', { id: prev.id }).catch(() => undefined);
            return prev;
        });
    }, []);

    const combinedStreamError = useCallback(() => {
        // Live quality-variant fallback first (existing behavior); when there
        // is nothing to fall back to, try the ffmpeg rescue.
        if (contentType === 'live' && liveQualityVariants && liveQualityVariants.length > 1) {
            handleStreamError();
            return;
        }
        attemptRescue();
    }, [contentType, liveQualityVariants, handleStreamError, attemptRescue]);

    const hlsRef = useHls({ src: rescue?.src ?? src, videoRef, onStreamError: combinedStreamError });

    // Direct-file playback errors (mp4/mkv the <video> can't decode) don't go
    // through hls.js — listen on the element too.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onError = () => {
            const code = video.error?.code;
            // 3 = MEDIA_ERR_DECODE, 4 = MEDIA_ERR_SRC_NOT_SUPPORTED
            if (code === 3 || code === 4) attemptRescue();
        };
        video.addEventListener('error', onError);
        return () => video.removeEventListener('error', onError);
    }, [videoRef, attemptRescue]);

    // Sleep timer: pauses playback when the countdown hits zero.
    const sleepTimer = useSleepTimer(useCallback(() => {
        videoRef.current?.pause();
        setStreamErrorToast(t('player', 'sleepTimerPaused'));
        setTimeout(() => setStreamErrorToast(null), 5000);
    }, [videoRef, t]));

    // Tray menu mirror: report playback state; obey play/pause/stop clicks.
    useEffect(() => {
        try {
            window.ipcRenderer?.send('media:state', { hasMedia: true, playing: state.playing, title: title || '' });
        } catch { /* older preloads block the channel */ }
    }, [state.playing, title]);
    useEffect(() => () => {
        try {
            window.ipcRenderer?.send('media:state', { hasMedia: false, playing: false, title: '' });
        } catch { /* ignore */ }
    }, []);
    useEffect(() => {
        if (!window.ipcRenderer) return;
        const handler = (_event: unknown, action: unknown) => {
            if (action === 'togglePlay') controls.togglePlay();
            else if (action === 'stop') onClose?.();
        };
        window.ipcRenderer.on('media:control', handler);
        return () => { window.ipcRenderer?.off('media:control', handler); };
    }, [controls, onClose]);

    // OS media integration: hardware media keys + Windows media overlay (SMTC)
    useMediaSession({
        videoRef,
        playing: state.playing,
        title,
        poster,
        contentType,
        seasonNumber,
        episodeNumber,
        onNext: onNextEpisode,
        onPrevious: onPreviousEpisode,
        canGoNext,
        canGoPrevious
    });


    const [showControls, setShowControls] = useState(true);
    const [seeking, setSeeking] = useState(false);
    const [showVolumeSlider, setShowVolumeSlider] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showDeviceSelector, setShowDeviceSelector] = useState(false);
    const [castingDevice, setCastingDevice] = useState<{ id: string; name: string } | null>(null);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    // Subtitle sync offset (seconds); adjusted from the gear menu in 0.5s steps.
    const [subtitleOffset, setSubtitleOffset] = useState(0);
    // Aspect ratio mode (gear menu): how the video fills the stage.
    // Default 'fill' (cover) = the player's historical rendering; 'original'
    // shows the full frame uncropped (letterbox for 4:3 content). The chosen
    // mode is remembered per content (utils/aspectPrefs), so a 4:3 channel
    // keeps its mode across sessions and zapping.
    const [aspectMode, setAspectMode] = useState<'original' | 'stretch' | 'fill' | 'zoom'>('fill');
    useEffect(() => {
        const saved = aspectPrefs.get(aspectPrefKey(contentType, contentId));
        queueMicrotask(() => setAspectMode(saved ?? 'fill'));
    }, [contentType, contentId]);
    const chooseAspectMode = useCallback((mode: 'original' | 'stretch' | 'fill' | 'zoom') => {
        setAspectMode(mode);
        aspectPrefs.set(aspectPrefKey(contentType, contentId), mode);
    }, [contentType, contentId]);
    const aspectStyle: React.CSSProperties =
        aspectMode === 'stretch' ? { objectFit: 'fill' }
        : aspectMode === 'fill' ? { objectFit: 'cover' }
        : aspectMode === 'zoom' ? { objectFit: 'contain', transform: 'scale(1.33)' }
        : { objectFit: 'contain' };
    const [hoverPosition, setHoverPosition] = useState(0);
    const {
        subtitlesEnabled,
        setSubtitlesEnabled,
        subtitleLoading,
        subtitleLanguage,
        vttContent,
        subtitleWarning,
        isForcedSubtitle,
        forcedEnabledForSession,
        handleSubtitleToggle,
        handleSubtitleLanguageSelect,
        handleSubtitlesOff,
        handleForcedSessionToggle
    } = useSubtitleManager({ title, tmdbId, imdbId, seasonNumber, episodeNumber, videoRef });

    // HLS audio tracks — snapshotted when the settings menu opens (live
    // streams occasionally expose more than one language).
    const [audioTracks, setAudioTracks] = useState<{ id: number; label: string; active: boolean }[]>([]);
    useEffect(() => {
        if (!showSettings) return;
        const hls = hlsRef.current;
        if (!hls || !hls.audioTracks || hls.audioTracks.length === 0) {
            setAudioTracks([]);
            return;
        }
        setAudioTracks(hls.audioTracks.map((track, i) => ({
            id: i,
            label: track.name || track.lang || `Áudio ${i + 1}`,
            active: i === hls.audioTrack
        })));
    }, [showSettings, hlsRef]);

    const handleSelectAudioTrack = (id: number) => {
        const hls = hlsRef.current;
        if (!hls) return;
        hls.audioTrack = id;
        setAudioTracks(tracks => tracks.map(tr => ({ ...tr, active: tr.id === id })));
    };
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);

    const hideControlsTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

    const resetHideControlsTimer = useCallback(() => {
        setShowControls(true);
        if (hideControlsTimeoutRef.current) {
            clearTimeout(hideControlsTimeoutRef.current);
        }
        hideControlsTimeoutRef.current = setTimeout(() => {
            if (state.playing && !seeking) {
                setShowControls(false);
            }
        }, 3000);
    }, [state.playing, seeking]);

    // State for PiP resume time (if same content was in PiP)
    const [pipResumeTime, setPipResumeTime] = useState<number | null>(null);

    // Close PiP when VideoPlayer opens and get resume time if same content
    useEffect(() => {
        const closePipAndGetTime = async () => {
            if (!window.ipcRenderer) return;

            try {
                const state = await window.ipcRenderer.invoke('pip:close-and-get');
                if (state.isOpen && state.content) {
                    // Check if same content was in PiP
                    const isSameContent =
                        (contentId && state.content.contentId === contentId) ||
                        (src && state.content.src === src);

                    if (isSameContent && state.content.currentTime && state.content.currentTime > 0) {
                        setPipResumeTime(state.content.currentTime);
                    }
                }
            } catch (error) {
                console.error('[VideoPlayer] Error closing PiP:', error);
            }
        };

        closePipAndGetTime();
    }, [contentId, src]);

    // Apply PiP resume time when video is ready
    useEffect(() => {
        if (pipResumeTime !== null && videoRef.current && state.duration > 0) {
            videoRef.current.currentTime = pipResumeTime;
            setPipResumeTime(null); // Clear after applying
        }
    }, [pipResumeTime, state.duration, videoRef]);

    useEffect(() => {
        // Deferred: the reset shows the controls (setState) synchronously.
        queueMicrotask(resetHideControlsTimer);
        return () => {
            if (hideControlsTimeoutRef.current) {
                clearTimeout(hideControlsTimeoutRef.current);
            }
        };
    }, [resetHideControlsTimer, state.fullscreen]);

    // Handle auto-play (respects the shouldAutoPlayNextEpisode setting)
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Check if we should auto-play (either autoPlay prop or from episode transition)
        const shouldAutoPlay = localStorage.getItem('shouldAutoPlayNextEpisode');

        // Clear the flag after reading
        if (shouldAutoPlay !== null) {
            localStorage.removeItem('shouldAutoPlayNextEpisode');

            if (shouldAutoPlay === 'true') {
                video.play();
            } else {
                // Don't play, let user manually start
            }
        } else if (autoPlay) {
            // Normal autoPlay behavior for initial video load
            video.play();
        }
    }, [autoPlay, src, videoRef]);

    // Resume from saved time
    useEffect(() => {
        if (!resumeTime || !videoRef.current) return;

        const video = videoRef.current;

        const setResumeTime = () => {
            if (video && resumeTime) {
                // Only seek if not already at or past the resume point
                if (Math.abs(video.currentTime - resumeTime) > 5) {
                    video.currentTime = resumeTime;
                }
            }
        };

        // If metadata is already loaded, set time immediately
        if (video.readyState >= 2) {
            setResumeTime();
        } else {
            // Otherwise, wait for metadata to load (once only)
            video.addEventListener('loadedmetadata', setResumeTime, { once: true });
            video.addEventListener('canplay', setResumeTime, { once: true });
        }

        return () => {
            video.removeEventListener('loadedmetadata', setResumeTime);
            video.removeEventListener('canplay', setResumeTime);
        };
    }, [resumeTime, src, videoRef]);

    // Time update tracker
    useEffect(() => {
        if (!onTimeUpdate || !videoRef.current) return;

        const video = videoRef.current;

        const handleTimeUpdate = () => {
            onTimeUpdate(video.currentTime, video.duration || 0);
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        return () => video.removeEventListener('timeupdate', handleTimeUpdate);
    }, [onTimeUpdate, videoRef]);

    // Usage stats tracking - start session on play, end on pause/unmount
    useEffect(() => {
        if (!contentId || !title) return;

        const handlePlay = () => {
            usageStatsService.startSession(contentId, contentType, title, genre);
        };

        const handlePause = () => {
            usageStatsService.endSession();
        };

        const video = videoRef.current;
        if (video) {
            video.addEventListener('play', handlePlay);
            video.addEventListener('pause', handlePause);
            video.addEventListener('ended', handlePause);
        }

        return () => {
            // End session when component unmounts
            usageStatsService.endSession();
            if (video) {
                video.removeEventListener('play', handlePlay);
                video.removeEventListener('pause', handlePause);
                video.removeEventListener('ended', handlePause);
            }
        };
    }, [contentId, contentType, title, genre, videoRef]);


    // Live TV recording (DVR) — ffmpeg in the main process copies the stream.
    const [recording, setRecording] = useState<{ id: string; seconds: number } | null>(null);
    const [recToast, setRecToast] = useState<string | null>(null);

    useEffect(() => {
        if (contentType !== 'live') return;
        const onProgress = (_e: unknown, data: { id: string; seconds: number }) => {
            setRecording(prev => (prev && prev.id === data.id ? { ...prev, seconds: data.seconds } : prev));
        };
        const onStopped = (_e: unknown, data: { id: string; file: string; error?: string }) => {
            setRecording(prev => (prev && prev.id === data.id ? null : prev));
            setRecToast(data.error ? t('player', 'recordingFailed') : `${t('player', 'recordingSaved')}: ${data.file}`);
            setTimeout(() => setRecToast(null), 6000);
        };
        window.ipcRenderer.on('dvr:progress', onProgress);
        window.ipcRenderer.on('dvr:stopped', onStopped);
        return () => {
            window.ipcRenderer.off('dvr:progress', onProgress);
            window.ipcRenderer.off('dvr:stopped', onStopped);
        };
    }, [contentType, t]);

    const toggleRecording = async () => {
        if (recording) {
            await window.ipcRenderer.invoke('dvr:stop', { id: recording.id });
            return;
        }
        const result = await window.ipcRenderer.invoke('dvr:start', { url: src, channelName: title || 'canal' });
        if (result?.success) {
            setRecording({ id: result.id, seconds: 0 });
        } else {
            setRecToast(`${t('player', 'recordingFailed')}${result?.error ? `: ${result.error}` : ''}`);
            setTimeout(() => setRecToast(null), 5000);
        }
    };

    // Live TV zapping: channel list overlay + PageUp/PageDown channel hop.
    const [showChannelList, setShowChannelList] = useState(false);
    const zapEnabled = contentType === 'live' && !!channelList?.length && !!onSwitchChannel;

    // TV-style digit jump: type the channel number, it switches after a beat.
    const [digitBuffer, setDigitBuffer] = useState('');
    const digitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!zapEnabled) return;
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            if (!/^[0-9]$/.test(e.key)) return;
            e.preventDefault();
            setDigitBuffer(prev => {
                const next = (prev + e.key).slice(0, 4);
                if (digitTimerRef.current) clearTimeout(digitTimerRef.current);
                digitTimerRef.current = setTimeout(() => {
                    setDigitBuffer('');
                    const num = Number(next);
                    const hit = channelList!.find(c => c.num === num);
                    if (hit && String(hit.id) !== String(contentId)) onSwitchChannel!(hit.id);
                }, 1400);
                return next;
            });
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            if (digitTimerRef.current) clearTimeout(digitTimerRef.current);
        };
    }, [zapEnabled, channelList, contentId, onSwitchChannel]);

    useEffect(() => {
        if (!zapEnabled) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
            e.preventDefault();
            const list = channelList!;
            const idx = list.findIndex(c => String(c.id) === String(contentId));
            if (idx === -1) return;
            // PageUp = previous channel in the list, PageDown = next (TV-style CH±).
            const next = e.key === 'PageDown'
                ? list[Math.min(list.length - 1, idx + 1)]
                : list[Math.max(0, idx - 1)];
            if (next && String(next.id) !== String(contentId)) onSwitchChannel!(next.id);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [zapEnabled, channelList, contentId, onSwitchChannel]);

    // Next-episode countdown when the video ends (cancelable, Netflix-style).
    const [nextEpCountdown, setNextEpCountdown] = useState<number | null>(null);
    const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const clearNextEpCountdown = useCallback(() => {
        if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
        }
        setNextEpCountdown(null);
    }, []);

    const goToNextEpisode = useCallback((autoPlay: boolean) => {
        clearNextEpCountdown();
        localStorage.setItem('shouldAutoPlayNextEpisode', autoPlay ? 'true' : 'false');
        onNextEpisode?.();
    }, [clearNextEpCountdown, onNextEpisode]);

    useEffect(() => {
        if (!videoRef.current || !onNextEpisode || !canGoNext) return;

        const video = videoRef.current;

        const handleEnded = async () => {
            const { playbackService } = await import('../../services/playbackService');
            const config = playbackService.getConfig();

            if (!config.autoPlayNextEpisode) {
                // Autoplay off: offer the next episode, don't count down.
                setNextEpCountdown(-1);
                return;
            }

            // Count down from 5, then advance (the 0-watcher effect below fires it).
            setNextEpCountdown(5);
            countdownTimerRef.current = setInterval(() => {
                setNextEpCountdown(prev => (prev === null ? null : prev - 1));
            }, 1000);
        };

        video.addEventListener('ended', handleEnded);
        return () => {
            video.removeEventListener('ended', handleEnded);
        };
    }, [onNextEpisode, canGoNext, videoRef]);

    // Countdown reached zero → advance (deferred; advancing sets state).
    useEffect(() => {
        if (nextEpCountdown === 0) queueMicrotask(() => goToNextEpisode(true));
    }, [nextEpCountdown, goToNextEpisode]);

    // Drop any pending countdown when the source changes or on unmount.
    useEffect(() => clearNextEpCountdown, [src, clearNextEpCountdown]);

    // Add mousemove listener - works both in and out of fullscreen
    useEffect(() => {
        const handleMouseMove = () => {
            setShowControls(true);

            if (hideControlsTimeoutRef.current) {
                clearTimeout(hideControlsTimeoutRef.current);
            }

            hideControlsTimeoutRef.current = setTimeout(() => {
                if (state.playing && !seeking) {
                    setShowControls(false);
                }
            }, 3000);
        };

        // Always add listener to document for better coverage
        document.addEventListener('mousemove', handleMouseMove);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            if (hideControlsTimeoutRef.current) {
                clearTimeout(hideControlsTimeoutRef.current);
            }
        };
    }, [state.playing, seeking]);

    // Note: SubtitleOverlay component handles its own timeupdate/seeked events

    // Keyboard shortcuts (Space/K/arrows/M/F/C/Escape) — single stable document listener.
    useKeyboardShortcuts({
        showDeviceSelector,
        controls,
        currentTime: state.currentTime,
        duration: state.duration,
        volume: state.volume,
        containerRef,
        vttContent,
        setSubtitlesEnabled,
        onClose
    });

    // Progress bar hover preview
    const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!progressRef.current) return;
        const rect = progressRef.current.getBoundingClientRect();
        const position = (e.clientX - rect.left) / rect.width;
        setHoverPosition(e.clientX - rect.left);
        setHoverTime(position * state.duration);
    };

    const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const clickPosition = (e.clientX - rect.left) / rect.width;
        controls.seek(clickPosition * state.duration);
    };

    const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        setSeeking(true);
        handleProgressBarClick(e);
    };

    const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (seeking) {
            handleProgressBarClick(e);
        }
    };

    const handleProgressMouseUp = () => {
        setSeeking(false);
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        controls.setVolume(parseFloat(e.target.value));
    };

    const currentTimePercent = percentage(state.currentTime, state.duration);
    const bufferedPercent = percentage(state.buffered, state.duration);

    return (
        <div ref={containerRef} className="video-player-container" onMouseMove={resetHideControlsTimer}>
            {onClose && showControls && (
                <button className="video-player-close" onClick={onClose}>✕</button>
            )}


            {title && showControls && (
                <div className="video-player-title">{title}</div>
            )}

            {/* Live mini-EPG: what's on now / next, right under the title */}
            {contentType === 'live' && liveEpg && showControls && (
                <div className="live-epg-bar">
                    <div className="live-epg-now">
                        <span className="live-epg-dot" />
                        <span className="live-epg-now-title">{liveEpg.nowTitle}</span>
                        {liveEpg.timeRange && <span className="live-epg-time">{liveEpg.timeRange}</span>}
                    </div>
                    {typeof liveEpg.progressPct === 'number' && (
                        <div className="live-epg-progress">
                            <div className="live-epg-progress-fill" style={{ width: `${Math.min(100, Math.max(0, liveEpg.progressPct))}%` }} />
                        </div>
                    )}
                    {liveEpg.nextTitle && (
                        <div className="live-epg-next">
                            {t('player', 'epgNext')}: {liveEpg.nextTitle}
                        </div>
                    )}
                </div>
            )}

            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#000'
                }}
                onMouseMove={resetHideControlsTimer}
            >
                <video
                    ref={videoRef}
                    className="video-fullwidth"
                    style={aspectStyle}
                    poster={poster}
                    onClick={controls.togglePlay}
                    crossOrigin="anonymous"
                />

                {/* Custom Subtitle Overlay - replaces native <track> for better HLS sync */}
                <SubtitleOverlay
                    vttContent={vttContent}
                    videoRef={videoRef}
                    enabled={subtitlesEnabled}
                    offsetSeconds={subtitleOffset}
                />

                {/* Subtitle Warning Toast */}
                {subtitleWarning && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '80px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            padding: '10px 20px',
                            backgroundColor: 'rgba(245, 158, 11, 0.9)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '0.9rem',
                            fontWeight: 500,
                            zIndex: 1000,
                            animation: 'fadeIn 0.3s ease-in-out',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                        }}
                    >
                        ⚠️ {subtitleWarning}
                    </div>
                )}

                {/* Sleep timer countdown chip (discreet, top-right; always visible
                    in the final minute even with controls hidden) */}
                {sleepTimer.active && (showControls || sleepTimer.remainingSeconds <= 60) && (
                    <div className="sleep-timer-chip" title={t('player', 'sleepTimer')}>
                        🌙 {formatSleepCountdown(sleepTimer.remainingSeconds)}
                    </div>
                )}

                {/* Stream Fallback Toast */}
                {streamErrorToast && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '80px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            padding: '12px 24px',
                            background: streamErrorToast.includes('indisponível')
                                ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                                : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                            borderRadius: '10px',
                            color: 'white',
                            fontSize: '0.95rem',
                            fontWeight: 600,
                            zIndex: 1000,
                            animation: 'fadeIn 0.3s ease-in-out',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px'
                        }}
                    >
                        {streamErrorToast === t('player', 'streamUnavailable') ? '⚠️' : '🔄'} {streamErrorToast}
                    </div>
                )}

                {/* Recording saved/failed toast */}
                {recToast && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '130px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            padding: '12px 24px',
                            background: recToast.startsWith(t('player', 'recordingFailed'))
                                ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                                : 'linear-gradient(135deg, #10b981, #059669)',
                            borderRadius: '10px',
                            color: 'white',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                            zIndex: 1000,
                            maxWidth: '80%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
                        }}
                    >
                        ⏺ {recToast}
                    </div>
                )}

                {/* Digit-jump OSD (typing a channel number) */}
                {digitBuffer && (
                    <div style={{
                        position: 'absolute',
                        top: 24,
                        right: 32,
                        zIndex: 1003,
                        padding: '10px 22px',
                        borderRadius: 12,
                        background: 'rgba(0, 0, 0, 0.75)',
                        border: '1px solid rgba(var(--ns-accent-rgb), 0.5)',
                        color: 'white',
                        fontSize: 30,
                        fontWeight: 700,
                        letterSpacing: 4,
                        fontVariantNumeric: 'tabular-nums'
                    }}>
                        {digitBuffer}
                    </div>
                )}

                {/* Live TV zapping overlay */}
                {zapEnabled && (
                    <ChannelZapOverlay
                        channels={channelList!}
                        currentId={contentId}
                        visible={showChannelList}
                        onSelect={(id) => {
                            setShowChannelList(false);
                            if (String(id) !== String(contentId)) onSwitchChannel!(id);
                        }}
                        onClose={() => setShowChannelList(false)}
                    />
                )}

                {/* Next-episode countdown card (video ended, series with a next ep) */}
                {nextEpCountdown !== null && (
                    <div
                        style={{
                            position: 'absolute',
                            right: 32,
                            bottom: 110,
                            zIndex: 1001,
                            padding: '18px 22px',
                            borderRadius: 14,
                            background: 'rgba(10, 10, 25, 0.92)',
                            border: '1px solid rgba(var(--ns-accent-rgb), 0.4)',
                            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
                            animation: 'fadeIn 0.25s ease-in-out',
                            minWidth: 260
                        }}
                    >
                        <div style={{ color: 'white', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                            {nextEpCountdown > 0
                                ? `${nextCountdownLabel ?? t('player', 'nextEpisodeIn')} ${nextEpCountdown}s`
                                : (nextActionLabel ?? t('player', 'nextEpisode'))}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button
                                onClick={() => goToNextEpisode(true)}
                                style={{
                                    flex: 1,
                                    padding: '10px 16px',
                                    borderRadius: 10,
                                    border: 'none',
                                    background: 'linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to))',
                                    color: 'white',
                                    fontSize: 14,
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                ▶ {t('player', 'watchNow')}
                            </button>
                            <button
                                onClick={clearNextEpCountdown}
                                style={{
                                    padding: '10px 16px',
                                    borderRadius: 10,
                                    border: '1px solid rgba(255, 255, 255, 0.3)',
                                    background: 'transparent',
                                    color: 'white',
                                    fontSize: 14,
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                {t('player', 'cancelAutoplay')}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Central Play Button - Shows when paused */}
            {!state.playing && !state.loading && !state.error && (
                <div className="central-play-button" onClick={controls.togglePlay}>
                    <div className="central-play-icon">
                        <Play size="1em" />
                    </div>
                </div>
            )}

            {/* Modern Loading Spinner */}
            {state.loading && (
                <div className="video-player-loading">
                    <div className="modern-spinner">
                        <div className="spinner-ring"></div>
                        <div className="spinner-ring"></div>
                        <div className="spinner-ring"></div>
                    </div>
                    <span className="loading-text">Carregando...</span>
                </div>
            )}

            {state.error && (
                <div className="video-player-error">
                    <p>⚠️ Erro ao carregar vídeo</p>
                    <p style={{ fontSize: '12px', marginTop: '8px' }}>
                        {state.error.includes('HTTP2') || state.error.includes('ERR_')
                            ? 'Erro de conexão com o servidor IPTV. Verifique as credenciais.'
                            : 'Verifique se as credenciais do servidor IPTV estão corretas.'}
                    </p>
                    {onClose && <button onClick={onClose}>Fechar</button>}
                </div>
            )}

            <div className={`video-player-controls ${showControls ? 'visible' : 'hidden'}`}>
                {/* Progress bar - hide for live TV */}
                {contentType !== 'live' && (
                    <div
                        ref={progressRef}
                        className="progress-container"
                        onClick={handleProgressBarClick}
                        onMouseDown={handleProgressMouseDown}
                        onMouseMove={(e) => {
                            handleProgressMouseMove(e);
                            handleProgressHover(e);
                        }}
                        onMouseUp={handleProgressMouseUp}
                        onMouseLeave={() => {
                            handleProgressMouseUp();
                            setHoverTime(null);
                        }}
                    >
                        {/* Time Preview Tooltip */}
                        {hoverTime !== null && (
                            <div
                                className="time-preview-tooltip"
                                style={{ left: `${hoverPosition}px` }}
                            >
                                {formatTime(hoverTime)}
                            </div>
                        )}
                        <div className="progress-bar">
                            <div className="progress-buffered" style={{ width: `${bufferedPercent}%` }} />
                            <div className="progress-played" style={{ width: `${currentTimePercent}%` }} />
                            <div className="progress-handle" style={{ left: `${currentTimePercent}%` }} />
                        </div>
                    </div>
                )}

                <div className="controls-row">
                    <div className="controls-left">
                        <button className="control-btn" onClick={controls.togglePlay}>
                            {state.playing ? <Pause size="1em" /> : <Play size="1em" />}
                        </button>

                        <div
                            className="volume-control"
                            onMouseEnter={() => setShowVolumeSlider(true)}
                            onMouseLeave={() => setShowVolumeSlider(false)}
                        >
                            <button className="control-btn volume-btn" onClick={controls.toggleMute}>
                                {state.muted || state.volume === 0 ? (
                                    <VolumeX size="1em" />
                                ) : state.volume < 0.33 ? (
                                    <Volume size="1em" />
                                ) : state.volume < 0.66 ? (
                                    <Volume1 size="1em" />
                                ) : (
                                    <Volume2 size="1em" />
                                )}
                            </button>
                            {showVolumeSlider && (
                                <input
                                    type="range"
                                    className="volume-slider"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={state.muted ? 0 : state.volume}
                                    onChange={handleVolumeChange}
                                />
                            )}
                        </div>

                        {contentType === 'live' ? (
                            <span
                                className="live-badge"
                                onClick={() => {
                                    // Seek to live edge (end of buffer)
                                    if (videoRef.current) {
                                        const video = videoRef.current;
                                        // For HLS live streams, seek to the end
                                        if (video.duration && isFinite(video.duration)) {
                                            video.currentTime = video.duration - 0.5;
                                        } else if (video.seekable && video.seekable.length > 0) {
                                            // Use seekable range for live streams
                                            video.currentTime = video.seekable.end(video.seekable.length - 1) - 0.5;
                                        }
                                    }
                                }}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '4px 12px',
                                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    color: 'white',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)',
                                    cursor: 'pointer',
                                    transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'scale(1.05)';
                                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(239, 68, 68, 0.6)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'scale(1)';
                                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(239, 68, 68, 0.4)';
                                }}
                                title={t('liveTV', 'watchNow')}
                            >
                                <span style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    backgroundColor: 'white',
                                    animation: 'pulse 1.5s ease-in-out infinite'
                                }} />
                                {t('liveTV', 'live')}
                            </span>
                        ) : (
                            <span className="time-display">
                                {formatTime(state.currentTime)} / {formatTime(state.duration)}
                            </span>
                        )}
                    </div>

                    <div className="controls-right">
                        {/* Settings/Quality gear menu (movie versions / live quality / speed) */}
                        <PlayerSettingsMenu
                            contentType={contentType}
                            movieVersions={movieVersions}
                            currentMovieId={currentMovieId}
                            onSwitchVersion={onSwitchVersion}
                            currentTime={state.currentTime}
                            playbackRate={state.playbackRate}
                            onSetPlaybackRate={controls.setPlaybackRate}
                            showSettings={showSettings}
                            setShowSettings={setShowSettings}
                            subtitlesEnabled={subtitlesEnabled}
                            subtitleLanguage={subtitleLanguage}
                            onSelectSubtitleLanguage={handleSubtitleLanguageSelect}
                            onDisableSubtitles={handleSubtitlesOff}
                            audioTracks={audioTracks}
                            onSelectAudioTrack={handleSelectAudioTrack}
                            aspectMode={aspectMode}
                            onSetAspectMode={chooseAspectMode}
                            subtitleOffset={contentType !== 'live' && subtitlesEnabled ? subtitleOffset : undefined}
                            onAdjustSubtitleOffset={(delta) => setSubtitleOffset(prev => Math.round((prev + delta) * 2) / 2)}
                            sleepTimerMinutes={sleepTimer.selectedMinutes}
                            onSetSleepTimer={(minutes) => minutes ? sleepTimer.start(minutes) : sleepTimer.cancel()}
                        />

                        {/* Channel list toggle (live TV zapping) */}
                        {zapEnabled && (
                            <button
                                className="control-btn"
                                onClick={() => setShowChannelList(v => !v)}
                                title={t('player', 'channelList')}
                                style={{ fontSize: 16 }}
                            >
                                📺
                            </button>
                        )}

                        {/* Record toggle (live TV DVR) */}
                        {contentType === 'live' && (
                            <button
                                className="control-btn"
                                onClick={toggleRecording}
                                title={recording ? t('player', 'stopRecording') : t('player', 'record')}
                                style={{
                                    fontSize: 14,
                                    color: recording ? '#ef4444' : 'white',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6
                                }}
                            >
                                <span>⏺</span>
                                {recording && <span style={{ fontSize: 12, fontWeight: 700 }}>{formatTime(recording.seconds)}</span>}
                            </button>
                        )}

                        {/* Episode Navigation - Only show for series */}
                        {(onNextEpisode || onPreviousEpisode) && (
                            <>
                                {canGoPrevious && onPreviousEpisode && (
                                    <button className="control-btn" onClick={onPreviousEpisode} title={t('player', 'previousEpisode')}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                                            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                                        </svg>
                                    </button>
                                )}
                                {canGoNext && onNextEpisode && (
                                    <button className="control-btn" onClick={onNextEpisode} title={t('player', 'nextEpisode')}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                                            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                                        </svg>
                                    </button>
                                )}
                            </>
                        )}

                        {/* Subtitles toggle - only show for dubbed movies (not already subtitled) and not live */}
                        {!isSubtitled && contentType !== 'live' && (
                            <button
                                className="control-btn"
                                onClick={handleSubtitleToggle}
                                title={subtitleLoading ? t('player', 'fetchingSubtitles') : (subtitlesEnabled ? `${t('player', 'disableSubtitles')} (${subtitleLanguage || 'PT'})` : t('player', 'enableSubtitles'))}
                                style={{
                                    color: subtitlesEnabled && !isForcedSubtitle ? '#10b981' : (subtitleLoading ? '#f59e0b' : 'white'),
                                    opacity: subtitleLoading ? 0.7 : 1
                                }}
                                disabled={subtitleLoading}
                            >
                                {subtitleLoading ? (
                                    <span style={{ fontSize: '10px', fontWeight: 600 }}>...</span>
                                ) : (
                                    <Captions size="1em" />
                                )}
                            </button>
                        )}

                        {/* Forced Subtitles Button - Only show for non-[L] content and not live */}
                        {title && !title.includes('[L]') && contentType !== 'live' && (
                            <ForcedSubtitlesMenu
                                forcedEnabledForSession={forcedEnabledForSession}
                                onToggleForcedSession={handleForcedSessionToggle}
                            />
                        )}

                        {/* Picture-in-Picture */}
                        <button
                            className="control-btn"
                            onClick={() => {
                                if (src && title) {
                                    try {
                                        const miniPlayer = window.__miniPlayerContext;
                                        if (miniPlayer) {
                                            miniPlayer.startMiniPlayer({
                                                src,
                                                title: title || 'Video',
                                                poster,
                                                contentId,
                                                contentType,
                                                currentTime: state.currentTime,
                                                seasonNumber,
                                                episodeNumber,
                                                channelList: contentType === 'live'
                                                    ? channelList?.map(c => ({ id: c.id, name: c.name, directUrl: c.directUrl }))
                                                    : undefined,
                                                onExpand: (time: number) => {
                                                    if (videoRef.current) {
                                                        videoRef.current.currentTime = time;
                                                        videoRef.current.play();
                                                    }
                                                }
                                            });
                                            if (onClose) onClose();
                                        }
                                    } catch {
                                        // Fallback to native PiP if available
                                        if (videoRef.current && document.pictureInPictureEnabled) {
                                            videoRef.current.requestPictureInPicture();
                                        }
                                    }
                                }
                            }}
                            title="Picture-in-Picture"
                        >
                            <PictureInPicture2 size={18} />
                        </button>

                        <button
                            className="control-btn"
                            onClick={() => setShowDeviceSelector(true)}
                            title="Cast to Device"
                            style={{
                                color: castingDevice ? '#2563eb' : 'white',
                                opacity: 1
                            }}
                        >
                            <Cast size="1em" />
                        </button>

                        <button className="control-btn" onClick={() => {
                            if (!document.fullscreenElement) {
                                containerRef.current?.requestFullscreen();
                            } else {
                                document.exitFullscreen();
                            }
                        }}>
                            {state.fullscreen ? <Minimize size="1em" /> : <Maximize size="1em" />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Device Selector Modal */}
            {
                showDeviceSelector && (
                    <CastDeviceSelector
                        videoUrl={src}
                        videoTitle={title || 'Video'}
                        subtitleVtt={vttContent}
                        onClose={() => setShowDeviceSelector(false)}
                        onDeviceSelected={(device) => {
                            if (device.type === 'dlna') {
                                setCastingDevice({ id: device.id, name: device.name });
                                // Pause local playback — the TV took over.
                                if (state.playing) controls.togglePlay();
                            }
                        }}
                    />
                )
            }

            {/* Mini remote while a DLNA cast session is active */}
            {
                castingDevice && (
                    <CastControls
                        deviceId={castingDevice.id}
                        deviceName={castingDevice.name}
                        onSessionEnded={() => setCastingDevice(null)}
                    />
                )
            }
        </div >
    );
}

// Memoize while preserving the generic signature via cast.
export const VideoPlayer = memo(VideoPlayerImpl) as typeof VideoPlayerImpl;
