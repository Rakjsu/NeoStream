import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FaPlay, FaPause, FaVolumeUp, FaVolumeMute, FaExpand, FaCompress, FaCog, FaChromecast } from 'react-icons/fa';
import { useVideoPlayer } from '../../hooks/useVideoPlayer';
import { useHls } from '../../hooks/useHls';
import { useChromecast } from '../../hooks/useChromecast';
import { CastDeviceSelector } from '../CastDeviceSelector';
import { formatTime, percentage } from '../../utils/videoHelpers';
import './VideoPlayer.css';

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
    onTimeUpdate
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
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverPosition, setHoverPosition] = useState(0);
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

    useEffect(() => {
        if (autoPlay && videoRef.current) {
            videoRef.current.play();
        }
    }, [autoPlay]);

    // Resume from saved time
    useEffect(() => {
        if (!resumeTime || !videoRef.current) return;

        const video = videoRef.current;

        const setResumeTime = () => {
            if (video && resumeTime) {
                console.log(`Resuming playback at ${resumeTime} seconds`);
                video.currentTime = resumeTime;
            }
        };

        // If metadata is already loaded, set time immediately
        if (video.readyState >= 2) {
            setResumeTime();
        } else {
            // Otherwise, wait for metadata to load
            video.addEventListener('loadedmetadata', setResumeTime);
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
                />
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
                            <button className="control-btn" onClick={controls.toggleMute}>
                                {state.muted || state.volume === 0 ? <FaVolumeMute /> : <FaVolumeUp />}
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
                                className="control-btn"
                                onClick={() => setShowSettings(!showSettings)}
                            >
                                <FaCog />
                            </button>

                            {showSettings && (
                                <div className="settings-menu">
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
            {showDeviceSelector && (
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
            )}
        </div>
    );
}
