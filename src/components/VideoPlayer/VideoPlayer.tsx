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
import './VideoPlayer.css';

import type { MovieVersion } from '../../services/movieVersionService';

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
    isSubtitled
}: VideoPlayerProps) {
    const { videoRef, state, controls } = useVideoPlayer();
    useHls({ src, videoRef });

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

        const loadForcedSubtitles = async () => {
            try {
                console.log('🎬 Auto-loading forced subtitles...');
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
                    console.log('✅ Forced subtitles loaded automatically');
                } else {
                    console.log('ℹ️ No forced subtitles available for this movie');
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
                console.log('▶️ Auto-playing next episode');
                videoRef.current.play();
            } else {
                console.log('⏸️ Next episode loaded but paused (auto-play disabled)');
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
                    console.log(`Resuming playback at ${Math.floor(resumeTime)} seconds`);
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

            console.log(`📺 Video ended, going to next episode (auto-play: ${config.autoPlayNextEpisode})`);
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

                        <span className="time-display">
                            {formatTime(state.currentTime)} / {formatTime(state.duration)}
                        </span>
                    </div>

                    <div className="controls-right">
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
                                    {/* Movie Version Switcher - only show for movies with multiple versions */}
                                    {movieVersions && movieVersions.length > 1 && onSwitchVersion ? (
                                        <div className="settings-section">
                                            <span className="settings-label">Versão</span>
                                            <div className="settings-options">
                                                {movieVersions.map(version => {
                                                    const isActive = version.movie.stream_id === currentMovieId;
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
                                                        >
                                                            {version.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        /* Playback Speed - show for series or single-version movies */
                                        <div className="settings-section">
                                            <span className="settings-label">Velocidade</span>
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

                        {/* Episode Navigation - Only show for series */}
                        {(onNextEpisode || onPreviousEpisode) && (
                            <>
                                {canGoPrevious && onPreviousEpisode && (
                                    <button className="control-btn" onClick={onPreviousEpisode} title="Episódio Anterior">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                                            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                                        </svg>
                                    </button>
                                )}
                                {canGoNext && onNextEpisode && (
                                    <button className="control-btn" onClick={onNextEpisode} title="Próximo Episódio">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                                            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                                        </svg>
                                    </button>
                                )}
                            </>
                        )}

                        {/* Subtitles toggle - only show for dubbed movies (not already subtitled) */}
                        {!isSubtitled && (
                            <button
                                className="control-btn"
                                onClick={async () => {
                                    // If currently showing Forced subtitles, switch to full subtitles
                                    if (subtitlesEnabled && isForcedSubtitle) {
                                        console.log('🔄 Switching from Forced to full subtitles...');
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
                                                console.log('✅ Switched to full subtitles');
                                            } else {
                                                setSubtitleWarning('Nenhuma legenda completa encontrada.');
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
                                            console.log('🗑️ Subtitles cleaned up from memory');
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
                                                    setSubtitleWarning('Nenhuma legenda encontrada para este título.');
                                                    setTimeout(() => setSubtitleWarning(null), 4000);
                                                    console.log('No subtitles found');
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
                                title={subtitleLoading ? 'Buscando legendas...' : (subtitlesEnabled ? `Desativar Legendas (${subtitleLanguage || 'PT'})` : 'Ativar Legendas')}
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
                            console.log('Selected device:', device);
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
