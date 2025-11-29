import React, { useState, useEffect } from 'react';
import { FaPlay, FaPause, FaVolumeUp, FaVolumeMute, FaExpand, FaCompress, FaCog, FaSpinner } from 'react-icons/fa';
import { useVideoPlayer } from '../../hooks/useVideoPlayer';
import { useHls } from '../../hooks/useHls';
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
    canGoPrevious
}: VideoPlayerProps) {
    const { videoRef, state, controls } = useVideoPlayer();
    useHls({ src, videoRef });

    const [showControls, setShowControls] = useState(true);
    const [seeking, setSeeking] = useState(false);
    const [showVolumeSlider, setShowVolumeSlider] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const hideControlsTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>();

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
    }, [state.playing, seeking]);

    useEffect(() => {
        if (autoPlay && videoRef.current) {
            videoRef.current.play();
        }
    }, [autoPlay]);

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
        <div className="video-player-container" onMouseMove={resetHideControlsTimer}>
            {onClose && (
                <button className="video-player-close" onClick={onClose}>✕</button>
            )}

            {title && showControls && (
                <div className="video-player-title">{title}</div>
            )}

            {/* Skip Intro Button - Show during first 90 seconds */}
            {state.currentTime < 90 && state.currentTime > 0 && showControls && (
                <button
                    onClick={() => controls.seek(90)}
                    style={{
                        position: 'absolute',
                        bottom: '100px',
                        right: '20px',
                        zIndex: 85,
                        padding: '12px 20px',
                        backgroundColor: 'rgba(37, 99, 235, 0.95)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '15px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
                        backdropFilter: 'blur(10px)',
                        transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    <img src="/skip-intro-icon.png" alt="Skip" style={{ width: '20px', height: '20px' }} />
                    Pular Abertura
                </button>
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

            {state.loading && (
                <div className="video-player-loading">
                    <FaSpinner className="spinner" />
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
                    className="progress-container"
                    onClick={handleProgressBarClick}
                    onMouseDown={handleProgressMouseDown}
                    onMouseMove={handleProgressMouseMove}
                    onMouseUp={handleProgressMouseUp}
                    onMouseLeave={handleProgressMouseUp}
                >
                    <div className="progress-bar">
                        <div className="progress-buffered" style={{ width: `${bufferedPercent}%` }} />
                        <div className="progress-played" style={{ width: `${currentTimePercent}%` }}>
                            <div className="progress-handle" />
                        </div>
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

                        <button className="control-btn" onClick={controls.toggleFullscreen}>
                            {state.fullscreen ? <FaCompress /> : <FaExpand />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
