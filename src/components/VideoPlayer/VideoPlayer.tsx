import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FaPlay, FaPause, FaVolumeUp, FaVolumeDown, FaVolumeOff, FaVolumeMute, FaExpand, FaCompress, FaCog, FaChromecast, FaClosedCaptioning } from 'react-icons/fa';
import { RiPictureInPictureExitLine, RiPictureInPictureLine } from 'react-icons/ri';
import { useVideoPlayer } from '../../hooks/useVideoPlayer';
import { useHls } from '../../hooks/useHls';
import { useChromecast } from '../../hooks/useChromecast';
import { CastDeviceSelector } from '../CastDeviceSelector';
import { formatTime, percentage } from '../../utils/videoHelpers';
import { usageStatsService } from '../../services/usageStatsService';
import { useMiniPlayer } from '../MiniPlayer';
import { autoFetchSubtitle, autoFetchForcedSubtitle, cleanupSubtitleUrl } from '../../services/subtitleService';
import { SubtitleOverlay } from './SubtitleOverlay';
import { useLanguage } from '../../services/languageService';
import './VideoPlayer.css';

import type { MovieVersion } from '../../services/movieVersionService';

// Live TV quality variant type (matches LiveTV.tsx structure)
export interface QualityVariant {
    channel: any;
    quality: string;
    priority: number;
    label: string;
}

export interface VideoPlayerProps {
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
    movieVersions?: MovieVersion[];
    currentMovieId?: number;
    onSwitchVersion?: (movie: any, currentTime: number) => void;
    // Subtitle search
    tmdbId?: string | number;
    imdbId?: string;
    // If true, movie is already subtitled (has [L] in name), hide subtitle button
    isSubtitled?: boolean;
    // Live TV quality fallback
    liveQualityVariants?: QualityVariant[];
    currentQualityIndex?: number;
}

export function VideoPlayer({
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
    currentQualityIndex = 0
}: VideoPlayerProps) {
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

    useHls({ src, videoRef, onStreamError: handleStreamError });

    // Chromecast integration
    const chromecast = useChromecast(src, title || 'Video');

    const [showControls, setShowControls] = useState(true);
    const [seeking, setSeeking] = useState(false);
    const [showVolumeSlider, setShowVolumeSlider] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showDeviceSelector, setShowDeviceSelector] = useState(false);
    const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverPosition, setHoverPosition] = useState(0);
    const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
    const [subtitleLoading, setSubtitleLoading] = useState(false);
    const [subtitleLanguage, setSubtitleLanguage] = useState<string | null>(null);
    const [vttContent, setVttContent] = useState<string | null>(null);
    const [subtitleWarning, setSubtitleWarning] = useState<string | null>(null);
    const [isForcedSubtitle, setIsForcedSubtitle] = useState(false); // Track if current subtitle is Forced type
    const [showSettingsMenu, setShowSettingsMenu] = useState(false); // Gear menu visibility
    // Initialize session toggle from global config (enabled = setting is ON)
    const [forcedEnabledForSession, setForcedEnabledForSession] = useState(() => {
        try {
            // Read active profile ID from neostream_profiles (correct key)
            const profilesData = localStorage.getItem('neostream_profiles');
            let profileId: string | null = null;
            if (profilesData) {
                const parsed = JSON.parse(profilesData);
                profileId = parsed.activeProfileId || null;
            }
            const configKey = profileId ? `playbackConfig_${profileId}` : 'playbackConfig';
            const saved = localStorage.getItem(configKey);
            if (saved) {
                const config = JSON.parse(saved);
                const result = config.forcedSubtitlesEnabled !== false;
                return result;
            }
        } catch (e) { console.error('Error reading forced config:', e); }
        return true; // default enabled
    });
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);

    const hideControlsTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

    const resetHideControlsTimer = () => {
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
    }, [pipResumeTime, state.duration]);

    useEffect(() => {
        resetHideControlsTimer();
        return () => {
            if (hideControlsTimeoutRef.current) {
                clearTimeout(hideControlsTimeoutRef.current);
            }
        };
    }, [state.playing, seeking, state.fullscreen]); // Added fullscreen to dependencies

    // Auto-load Forced subtitles when content starts (movies and series)
    useEffect(() => {
        // Skip if no title
        if (!title) return;

        // Check if title contains [L] - already subtitled, skip Forced
        if (title.includes('[L]')) {
            return;
        }

        const loadForcedSubtitles = async () => {
            try {
                // Check if Forced subtitles are disabled for this session
                if (!forcedEnabledForSession) {
                    return;
                }

                // Check if Forced subtitles are enabled in settings
                const { playbackService } = await import('../../services/playbackService');
                playbackService.reloadConfig();
                const config = playbackService.getConfig();

                if (!config.forcedSubtitlesEnabled) {
                    return;
                }

                const result = await autoFetchForcedSubtitle({
                    title,
                    tmdbId,
                    imdbId,
                    season: seasonNumber,
                    episode: episodeNumber
                });

                if (result) {
                    setSubtitleUrl(result.url);
                    setSubtitleLanguage(result.language);
                    setVttContent(result.vttContent);
                    setSubtitlesEnabled(true);
                    setIsForcedSubtitle(true);
                } else {
                }
            } catch (error) {
                console.error('Error auto-loading forced subtitles:', error);
            }
        };

        // Small delay to let video player initialize
        const timer = setTimeout(loadForcedSubtitles, 1000);
        return () => clearTimeout(timer);
    }, [title, tmdbId, imdbId, seasonNumber, episodeNumber]);

    // Handle auto-play (respects the shouldAutoPlayNextEpisode setting)
    useEffect(() => {
        if (!videoRef.current) return;

        // Check if we should auto-play (either autoPlay prop or from episode transition)
        const shouldAutoPlay = localStorage.getItem('shouldAutoPlayNextEpisode');

        // Clear the flag after reading
        if (shouldAutoPlay !== null) {
            localStorage.removeItem('shouldAutoPlayNextEpisode');

            if (shouldAutoPlay === 'true') {
                videoRef.current.play();
            } else {
                // Don't play, let user manually start
            }
        } else if (autoPlay) {
            // Normal autoPlay behavior for initial video load
            videoRef.current.play();
        }
    }, [autoPlay, src]);

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
    }, [resumeTime, src]);

    // Time update tracker
    useEffect(() => {
        if (!onTimeUpdate || !videoRef.current) return;

        const handleTimeUpdate = () => {
            if (videoRef.current) {
                onTimeUpdate(videoRef.current.currentTime, videoRef.current.duration || 0);
            }
        };

        videoRef.current.addEventListener('timeupdate', handleTimeUpdate);
        return () => videoRef.current?.removeEventListener('timeupdate', handleTimeUpdate);
    }, [onTimeUpdate]);

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
    }, [contentId, contentType, title, genre]);


    // Go to next episode when video ends
    useEffect(() => {
        if (!videoRef.current || !onNextEpisode || !canGoNext) return;

        const video = videoRef.current;

        const handleEnded = async () => {
            // Check if auto-play is enabled to determine if we should auto-start
            const { playbackService } = await import('../../services/playbackService');
            const config = playbackService.getConfig();

            // Always go to next episode, but store the auto-play preference
            // The next video will check localStorage for shouldAutoPlay
            localStorage.setItem('shouldAutoPlayNextEpisode', config.autoPlayNextEpisode ? 'true' : 'false');

            onNextEpisode();
        };

        video.addEventListener('ended', handleEnded);
        return () => video.removeEventListener('ended', handleEnded);
    }, [onNextEpisode, canGoNext]);

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

    // Cleanup subtitle blob URL on unmount
    useEffect(() => {
        return () => {
            if (subtitleUrl) {
                cleanupSubtitleUrl(subtitleUrl);
            }
        };
    }, [subtitleUrl]);

    // Keyboard shortcuts
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement) return;

        switch (e.key.toLowerCase()) {
            case ' ':
            case 'k':
                e.preventDefault();
                controls.togglePlay();
                break;
            case 'arrowleft':
                e.preventDefault();
                controls.seek(Math.max(0, state.currentTime - 10));
                break;
            case 'arrowright':
                e.preventDefault();
                controls.seek(Math.min(state.duration, state.currentTime + 10));
                break;
            case 'arrowup':
                e.preventDefault();
                controls.setVolume(Math.min(1, state.volume + 0.1));
                break;
            case 'arrowdown':
                e.preventDefault();
                controls.setVolume(Math.max(0, state.volume - 0.1));
                break;
            case 'm':
                e.preventDefault();
                controls.toggleMute();
                break;
            case 'f':
                e.preventDefault();
                if (!document.fullscreenElement) {
                    containerRef.current?.requestFullscreen();
                } else {
                    document.exitFullscreen();
                }
                break;
            case 'escape':
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else if (onClose) {
                    onClose();
                }
                break;
        }
    }, [controls, state.currentTime, state.duration, state.volume, onClose]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

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

    const handleProgressMouseDown = (e: React.MouseEvent) => {
        setSeeking(true);
        handleProgressBarClick(e as any);
    };

    const handleProgressMouseMove = (e: React.MouseEvent) => {
        if (seeking) {
            handleProgressBarClick(e as any);
        }
    };

    const handleProgressMouseUp = () => {
        setSeeking(false);
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        controls.setVolume(parseFloat(e.target.value));
    };

    const playbackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

    const currentTimePercent = percentage(state.currentTime, state.duration);
    const bufferedPercent = percentage(state.buffered, state.duration);

    return (
        <div ref={containerRef} className="video-player-container" onMouseMove={resetHideControlsTimer}>
            {onClose && (
                <button className="video-player-close" onClick={onClose}>✕</button>
            )}


            {title && showControls && (
                <div className="video-player-title">{title}</div>
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
                    poster={poster}
                    onClick={controls.togglePlay}
                    crossOrigin="anonymous"
                />

                {/* Custom Subtitle Overlay - replaces native <track> for better HLS sync */}
                <SubtitleOverlay
                    vttContent={vttContent}
                    videoRef={videoRef}
                    enabled={subtitlesEnabled}
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
            </div>

            {/* Central Play Button - Shows when paused */}
            {!state.playing && !state.loading && !state.error && (
                <div className="central-play-button" onClick={controls.togglePlay}>
                    <div className="central-play-icon">
                        <FaPlay />
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
                            {state.playing ? <FaPause /> : <FaPlay />}
                        </button>

                        <div
                            className="volume-control"
                            onMouseEnter={() => setShowVolumeSlider(true)}
                            onMouseLeave={() => setShowVolumeSlider(false)}
                        >
                            <button className="control-btn volume-btn" onClick={controls.toggleMute}>
                                {state.muted || state.volume === 0 ? (
                                    <FaVolumeMute />
                                ) : state.volume < 0.33 ? (
                                    <FaVolumeOff />
                                ) : state.volume < 0.66 ? (
                                    <FaVolumeDown />
                                ) : (
                                    <FaVolumeUp />
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
                        {/* Settings/Quality button - show for movies/series OR for live TV with quality variants */}
                        {(contentType !== 'live' || (movieVersions && movieVersions.length > 1)) && (
                            <div className="settings-menu-container">
                                <button
                                    className="control-btn settings-btn"
                                    onClick={() => setShowSettings(!showSettings)}
                                    style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '4px' }}
                                >
                                    <FaCog />
                                    {/* Quality Badge - show current quality when movie versions available */}
                                    {movieVersions && movieVersions.length > 0 && (() => {
                                        const currentVersion = movieVersions.find(v => v.movie.stream_id === currentMovieId);
                                        if (currentVersion) {
                                            // For live TV, just show the quality label directly
                                            if (contentType === 'live') {
                                                return (
                                                    <span style={{
                                                        fontSize: '10px',
                                                        fontWeight: 700,
                                                        padding: '2px 6px',
                                                        borderRadius: '4px',
                                                        background: currentVersion.label === '4K' || currentVersion.label === 'UHD'
                                                            ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                                            : currentVersion.label === 'FHD' || currentVersion.label === 'H.265'
                                                                ? 'linear-gradient(135deg, #10b981, #059669)'
                                                                : currentVersion.label === 'SD'
                                                                    ? 'linear-gradient(135deg, #6b7280, #4b5563)'
                                                                    : 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                                                        color: 'white',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.5px',
                                                        boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                                                    }}>
                                                        {currentVersion.label}
                                                    </span>
                                                );
                                            }
                                            // For movies/series
                                            const qualityText = currentVersion.quality === '4k' ? '4K' : '1080p';
                                            const audioText = currentVersion.audio === 'subtitled' ? 'LEG' : 'DUB';
                                            return (
                                                <span style={{
                                                    fontSize: '9px',
                                                    fontWeight: 700,
                                                    padding: '2px 5px',
                                                    borderRadius: '4px',
                                                    background: currentVersion.quality === '4k'
                                                        ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                                        : 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                                                    color: 'white',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '3px',
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                                                }}>
                                                    {qualityText}
                                                    <span style={{ opacity: 0.7, fontSize: '7px' }}>•</span>
                                                    <span style={{ fontSize: '7px', opacity: 0.9 }}>{audioText}</span>
                                                </span>
                                            );
                                        }
                                        return null;
                                    })()}
                                </button>

                                {showSettings && (
                                    <div className="settings-menu">
                                        {/* Movie Version Switcher / Live TV Quality Switcher */}
                                        {movieVersions && movieVersions.length > 1 && onSwitchVersion ? (
                                            <div className="settings-section">
                                                <span className="settings-label">
                                                    {contentType === 'live' ? t('player', 'quality') : t('player', 'version')}
                                                </span>
                                                <div className="settings-options">
                                                    {movieVersions.map(version => {
                                                        const isActive = version.movie.stream_id === currentMovieId;
                                                        // Get icon based on quality
                                                        const getQualityIcon = (label: string) => {
                                                            const l = label.toLowerCase();
                                                            if (l.includes('4k') || l.includes('uhd')) return '🔵';
                                                            if (l.includes('fhd') || l.includes('h.265') || l.includes('1080')) return '🟢';
                                                            if (l.includes('hd') || l.includes('720')) return '🟡';
                                                            return '⚪'; // SD or unknown
                                                        };
                                                        return (
                                                            <button
                                                                key={version.movie.stream_id}
                                                                className={`settings-option ${isActive ? 'active' : ''}`}
                                                                onClick={() => {
                                                                    if (!isActive) {
                                                                        onSwitchVersion(version.movie, state.currentTime);
                                                                    }
                                                                    setShowSettings(false);
                                                                }}
                                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}
                                                            >
                                                                <span style={{ fontSize: '10px' }}>{getQualityIcon(version.label)}</span>
                                                                {version.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ) : (
                                            /* Playback Speed - show for series or single-version movies */
                                            <div className="settings-section">
                                                <span className="settings-label">{t('player', 'speed')}</span>
                                                <div className="settings-options">
                                                    {playbackRates.map(rate => (
                                                        <button
                                                            key={rate}
                                                            className={`settings-option ${state.playbackRate === rate ? 'active' : ''}`}
                                                            onClick={() => {
                                                                controls.setPlaybackRate(rate);
                                                                setShowSettings(false);
                                                            }}
                                                        >
                                                            {rate}x
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
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
                                onClick={async () => {
                                    // If currently showing Forced subtitles, switch to full subtitles
                                    if (subtitlesEnabled && isForcedSubtitle) {
                                        // Cleanup Forced subtitle
                                        if (subtitleUrl) {
                                            cleanupSubtitleUrl(subtitleUrl);
                                        }
                                        setSubtitleLoading(true);
                                        setIsForcedSubtitle(false);

                                        try {
                                            const result = await autoFetchSubtitle({
                                                title: title || '',
                                                tmdbId,
                                                imdbId,
                                                season: seasonNumber,
                                                episode: episodeNumber
                                            });
                                            if (result) {
                                                setSubtitleUrl(result.url);
                                                setSubtitleLanguage(result.language);
                                                setVttContent(result.vttContent);
                                                if (result.warning) {
                                                    setSubtitleWarning(result.warning);
                                                    setTimeout(() => setSubtitleWarning(null), 5000);
                                                }
                                            } else {
                                                setSubtitleWarning(t('player', 'noFullSubtitlesFound'));
                                                setTimeout(() => setSubtitleWarning(null), 4000);
                                            }
                                        } catch (error) {
                                            console.error('Error fetching full subtitles:', error);
                                        } finally {
                                            setSubtitleLoading(false);
                                        }
                                        return;
                                    }

                                    if (subtitlesEnabled) {
                                        // Disable subtitles and cleanup
                                        setSubtitlesEnabled(false);
                                        setIsForcedSubtitle(false);

                                        // Cleanup subtitle blob URL from memory
                                        if (subtitleUrl) {
                                            cleanupSubtitleUrl(subtitleUrl);
                                            setSubtitleUrl(null);
                                            setSubtitleLanguage(null);
                                            setVttContent(null);
                                        }

                                        const video = videoRef.current;
                                        if (video && video.textTracks.length > 0) {
                                            for (let i = 0; i < video.textTracks.length; i++) {
                                                video.textTracks[i].mode = 'hidden';
                                            }
                                        }
                                    } else {
                                        // Enable subtitles - fetch if not already loaded
                                        if (!subtitleUrl && title) {
                                            setSubtitleLoading(true);
                                            try {
                                                const result = await autoFetchSubtitle({
                                                    title,
                                                    tmdbId,
                                                    imdbId,
                                                    season: seasonNumber,
                                                    episode: episodeNumber
                                                });
                                                if (result) {
                                                    setSubtitleUrl(result.url);
                                                    setSubtitleLanguage(result.language);
                                                    setVttContent(result.vttContent);
                                                    setSubtitlesEnabled(true);
                                                    // Show warning if using fallback language
                                                    if (result.warning) {
                                                        setSubtitleWarning(result.warning);
                                                        // Clear warning after 5 seconds
                                                        setTimeout(() => setSubtitleWarning(null), 5000);
                                                    }
                                                } else {
                                                    setSubtitleWarning(t('player', 'noSubtitlesFound'));
                                                    setTimeout(() => setSubtitleWarning(null), 4000);
                                                }
                                            } catch (error) {
                                                console.error('Error fetching subtitles:', error);
                                            } finally {
                                                setSubtitleLoading(false);
                                            }
                                        } else {
                                            setSubtitlesEnabled(true);
                                            const video = videoRef.current;
                                            if (video && video.textTracks.length > 0) {
                                                for (let i = 0; i < video.textTracks.length; i++) {
                                                    video.textTracks[i].mode = 'showing';
                                                }
                                            }
                                        }
                                    }
                                }}
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
                                    <FaClosedCaptioning />
                                )}
                            </button>
                        )}

                        {/* Forced Subtitles Button - Only show for non-[L] content and not live */}
                        {title && !title.includes('[L]') && contentType !== 'live' && (
                            <div style={{ position: 'relative' }}>
                                <button
                                    className="control-btn"
                                    onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                                    title={t('player', 'forcedSubtitles')}
                                    style={{ color: showSettingsMenu ? '#a855f7' : (!forcedEnabledForSession ? 'rgba(255,255,255,0.4)' : 'white') }}
                                >
                                    <span style={{ fontSize: 14, fontWeight: 600 }}>F</span>
                                </button>

                                {/* Settings Dropdown Menu */}
                                {showSettingsMenu && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            bottom: '100%',
                                            right: 0,
                                            marginBottom: 8,
                                            background: 'rgba(0, 0, 0, 0.95)',
                                            borderRadius: 12,
                                            padding: '12px 0',
                                            minWidth: 220,
                                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                                            border: '1px solid rgba(255, 255, 255, 0.1)',
                                            zIndex: 100
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div style={{ padding: '0 16px 8px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', marginBottom: 8 }}>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255, 255, 255, 0.5)', textTransform: 'uppercase' }}>
                                                {t('player', 'currentSession')}
                                            </span>
                                        </div>

                                        {/* Forced Subtitles Toggle */}
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '10px 16px',
                                                cursor: 'pointer',
                                                transition: 'background 0.2s'
                                            }}
                                            onClick={async () => {
                                                const newValue = !forcedEnabledForSession;
                                                setForcedEnabledForSession(newValue);

                                                if (!newValue && isForcedSubtitle) {
                                                    // Disabling: remove current forced subtitle
                                                    setSubtitlesEnabled(false);
                                                    setIsForcedSubtitle(false);
                                                    if (subtitleUrl) {
                                                        cleanupSubtitleUrl(subtitleUrl);
                                                        setSubtitleUrl(null);
                                                        setVttContent(null);
                                                    }
                                                } else if (newValue && !subtitlesEnabled) {
                                                    // Enabling: load forced subtitles now
                                                    try {
                                                        const { autoFetchForcedSubtitle } = await import('../../services/subtitleService');
                                                        const result = await autoFetchForcedSubtitle({
                                                            title: title || '',
                                                            tmdbId,
                                                            imdbId,
                                                            season: seasonNumber,
                                                            episode: episodeNumber
                                                        });
                                                        if (result && result.warning) {
                                                            // Show warning toast for rejected special editions
                                                            setSubtitleWarning(result.warning);
                                                            setTimeout(() => setSubtitleWarning(null), 4000);
                                                        } else if (result && result.vttContent) {
                                                            const blob = new Blob([result.vttContent], { type: 'text/vtt' });
                                                            const blobUrl = URL.createObjectURL(blob);
                                                            setSubtitleUrl(blobUrl);
                                                            setVttContent(result.vttContent);
                                                            setSubtitlesEnabled(true);
                                                            setIsForcedSubtitle(true);
                                                        } else {
                                                            setSubtitleWarning(t('player', 'noForcedSubtitlesFound'));
                                                            setTimeout(() => setSubtitleWarning(null), 4000);
                                                        }
                                                    } catch (e) {
                                                        console.error('Failed to load forced subtitles:', e);
                                                        setSubtitleWarning(t('player', 'errorLoadingSubtitles'));
                                                        setTimeout(() => setSubtitleWarning(null), 4000);
                                                    }
                                                }
                                            }}
                                            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                        >
                                            <div>
                                                <div style={{ fontSize: 14, color: 'white', fontWeight: 500 }}>
                                                    Legendas Forçadas
                                                </div>
                                                <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)', marginTop: 2 }}>
                                                    Placas e diálogos estrangeiros
                                                </div>
                                            </div>
                                            <div
                                                style={{
                                                    width: 36,
                                                    height: 20,
                                                    borderRadius: 10,
                                                    background: forcedEnabledForSession ? 'linear-gradient(135deg, #a855f7, #ec4899)' : 'rgba(255, 255, 255, 0.2)',
                                                    position: 'relative',
                                                    transition: 'background 0.3s'
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: 16,
                                                        height: 16,
                                                        borderRadius: '50%',
                                                        background: 'white',
                                                        position: 'absolute',
                                                        top: 2,
                                                        left: forcedEnabledForSession ? 18 : 2,
                                                        transition: 'left 0.3s'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Picture-in-Picture */}
                        <button
                            className="control-btn"
                            onClick={() => {
                                if (src && title) {
                                    try {
                                        const miniPlayer = (window as any).__miniPlayerContext;
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
                                                onExpand: (time: number) => {
                                                    if (videoRef.current) {
                                                        videoRef.current.currentTime = time;
                                                        videoRef.current.play();
                                                    }
                                                }
                                            });
                                            if (onClose) onClose();
                                        }
                                    } catch (e) {
                                        // Fallback to native PiP if available
                                        if (videoRef.current && document.pictureInPictureEnabled) {
                                            videoRef.current.requestPictureInPicture();
                                        }
                                    }
                                }
                            }}
                            title="Picture-in-Picture"
                        >
                            <RiPictureInPictureLine size={18} />
                        </button>

                        <button
                            className="control-btn"
                            onClick={() => setShowDeviceSelector(true)}
                            title="Cast to Device"
                            style={{
                                color: chromecast.isCasting ? '#2563eb' : 'white',
                                opacity: 1
                            }}
                        >
                            <FaChromecast />
                        </button>

                        <button className="control-btn" onClick={() => {
                            if (!document.fullscreenElement) {
                                containerRef.current?.requestFullscreen();
                            } else {
                                document.exitFullscreen();
                            }
                        }}>
                            {state.fullscreen ? <FaCompress /> : <FaExpand />}
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
                        onClose={() => setShowDeviceSelector(false)}
                        onDeviceSelected={(device) => {
                        }}
                        chromecastAvailable={chromecast.isAvailable}
                        chromecastCasting={chromecast.isCasting}
                        onChromecastCast={() => {
                            chromecast.setCurrentTime(state.currentTime);
                            chromecast.startCasting();
                        }}
                    />
                )
            }
        </div >
    );
}
