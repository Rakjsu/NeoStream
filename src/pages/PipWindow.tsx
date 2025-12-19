/**
 * PiP Window Page
 * Rendered in the independent PiP BrowserWindow
 */

import { useState, useEffect } from 'react';
import { FaPlay, FaPause, FaTimes, FaExpand, FaVolumeUp, FaVolumeMute, FaVolumeDown, FaVolumeOff } from 'react-icons/fa';
import { useHls } from '../hooks/useHls';
import { useVideoPlayer } from '../hooks/useVideoPlayer';
import { useSearchParams } from 'react-router-dom';
import { movieProgressService } from '../services/movieProgressService';
import { watchProgressService } from '../services/watchProgressService';

interface PipContent {
    src: string;
    title: string;
    poster?: string;
    contentId?: string;
    contentType?: 'movie' | 'series' | 'live';
    currentTime?: number;
    seasonNumber?: number;
    episodeNumber?: number;
}

export function PipWindow() {
    const [searchParams] = useSearchParams();
    const [content, setContent] = useState<PipContent | null>(null);
    const [showVolumeSlider, setShowVolumeSlider] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const { videoRef } = useVideoPlayer();

    // Parse content from URL
    useEffect(() => {
        const dataParam = searchParams.get('data');
        if (dataParam) {
            try {
                const parsed = JSON.parse(decodeURIComponent(dataParam));
                setContent(parsed);
            } catch (error) {
                console.error('Failed to parse PiP content:', error);
            }
        }
    }, [searchParams]);

    // Initialize HLS only when we have content
    useHls({ src: content?.src || '', videoRef });

    // Set initial time and auto-play
    useEffect(() => {
        if (content?.currentTime && videoRef.current) {
            const setTime = () => {
                if (videoRef.current && content.currentTime) {
                    videoRef.current.currentTime = content.currentTime;
                    videoRef.current.play().catch(console.error);
                }
            };
            if (videoRef.current.readyState >= 2) {
                setTime();
            } else {
                videoRef.current.addEventListener('canplay', setTime, { once: true });
            }
        }
    }, [content?.currentTime]);

    // Local loading state management
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Check if video is already playing
        if (video.readyState >= 3 && !video.paused) {
            setIsLoading(false);
        }

        const handleCanPlay = () => setIsLoading(false);
        const handlePlaying = () => setIsLoading(false);
        const handleWaiting = () => setIsLoading(true);
        const handleLoadedData = () => setIsLoading(false);

        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('loadeddata', handleLoadedData);

        return () => {
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('loadeddata', handleLoadedData);
        };
    }, [content]);

    // Local playback state updates
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleTimeUpdate = () => setCurrentTime(video.currentTime);
        const handleDurationChange = () => setDuration(video.duration || 0);
        const handleVolumeChange = () => {
            setVolume(video.volume);
            setIsMuted(video.muted);
        };

        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('durationchange', handleDurationChange);
        video.addEventListener('volumechange', handleVolumeChange);

        return () => {
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('durationchange', handleDurationChange);
            video.removeEventListener('volumechange', handleVolumeChange);
        };
    }, [content]);

    // Local control handlers
    const handleTogglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
        }
    };

    const handleSeek = (time: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = time;
        }
    };

    const handleToggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !videoRef.current.muted;
        }
    };

    const handleSetVolume = (vol: number) => {
        if (videoRef.current) {
            videoRef.current.volume = vol;
            if (vol > 0) videoRef.current.muted = false;
        }
    };

    // Send state updates to main window
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const sendState = () => {
            if (window.ipcRenderer) {
                window.ipcRenderer.send('pip:state', {
                    playing: !video.paused,
                    currentTime: video.currentTime,
                    duration: video.duration || 0
                });
            }
        };

        video.addEventListener('timeupdate', sendState);
        video.addEventListener('play', sendState);
        video.addEventListener('pause', sendState);

        return () => {
            video.removeEventListener('timeupdate', sendState);
            video.removeEventListener('play', sendState);
            video.removeEventListener('pause', sendState);
        };
    }, []);

    // Listen for control commands from main window
    useEffect(() => {
        if (!window.ipcRenderer) return;

        const handleControl = (_event: unknown, action: string, value?: number) => {
            switch (action) {
                case 'play':
                    videoRef.current?.play();
                    break;
                case 'pause':
                    videoRef.current?.pause();
                    break;
                case 'togglePlay':
                    handleTogglePlay();
                    break;
                case 'mute':
                    handleToggleMute();
                    break;
                case 'seek':
                    if (typeof value === 'number') handleSeek(value);
                    break;
                case 'volume':
                    if (typeof value === 'number') handleSetVolume(value);
                    break;
            }
        };

        window.ipcRenderer.on('pip:control', handleControl);
        return () => {
            window.ipcRenderer?.off('pip:control', handleControl);
        };
    }, [isPlaying]);

    // Save progress to localStorage
    const saveProgress = () => {
        if (!content || !videoRef.current) return;
        const time = videoRef.current.currentTime;
        const dur = videoRef.current.duration || 0;
        if (time <= 0 || dur <= 0) return;

        if (content.contentType === 'movie' && content.contentId) {
            movieProgressService.saveMovieTime(
                content.contentId,
                content.title,
                time,
                dur
            );
            console.log('[PiP] Saved movie progress:', content.title, time, '/', dur);
        } else if (content.contentType === 'series' && content.contentId && content.seasonNumber && content.episodeNumber) {
            watchProgressService.saveVideoTime(
                content.contentId,
                content.seasonNumber,
                content.episodeNumber,
                time,
                dur
            );
            console.log('[PiP] Saved series progress:', content.title, `S${content.seasonNumber}E${content.episodeNumber}`, time, '/', dur);
        }
    };

    const handleClose = () => {
        saveProgress();
        if (window.ipcRenderer) {
            window.ipcRenderer.invoke('pip:close', {});
        }
    };

    const handleExpand = async () => {
        saveProgress();
        if (window.ipcRenderer && content) {
            await window.ipcRenderer.invoke('pip:expand', {
                ...content,
                currentTime: videoRef.current?.currentTime || 0
            });
            // Explicitly close PiP window as fallback
            window.ipcRenderer.invoke('pip:close', {});
        }
    };

    if (!content) {
        return (
            <div style={{
                width: '100vw',
                height: '100vh',
                background: '#000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white'
            }}>
                Carregando...
            </div>
        );
    }

    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            background: '#000',
            borderRadius: 12,
            overflow: 'hidden',
            position: 'relative',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6)',
            border: '1px solid rgba(139, 92, 246, 0.4)',
        }}>
            {/* Video */}
            <video
                ref={videoRef}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                }}
                poster={content.poster}
            />

            {/* Title Bar - Draggable zone */}
            <div
                className="pip-title-bar"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    padding: '8px 12px',
                    background: 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'grab'
                }}
            >
                <span style={{
                    color: 'white',
                    fontSize: 12,
                    fontWeight: 600,
                    maxWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                }}>
                    {content.title}
                </span>
                <div className="pip-title-buttons" style={{ display: 'flex', gap: 4 }}>
                    <button
                        onClick={handleExpand}
                        className="pip-btn pip-btn-expand"
                        style={{
                            background: 'rgba(255,255,255,0.2)',
                            border: 'none',
                            borderRadius: 4,
                            padding: 6,
                            cursor: 'pointer',
                            display: 'flex',
                            transition: 'all 0.2s ease'
                        }}
                        title="Expandir"
                    >
                        <FaExpand size={12} color="white" />
                    </button>
                    <button
                        onClick={handleClose}
                        className="pip-btn pip-btn-close"
                        style={{
                            background: 'rgba(239, 68, 68, 0.6)',
                            border: 'none',
                            borderRadius: 4,
                            padding: 6,
                            cursor: 'pointer',
                            display: 'flex',
                            transition: 'all 0.2s ease'
                        }}
                        title="Fechar"
                    >
                        <FaTimes size={12} color="white" />
                    </button>
                </div>
            </div>

            {/* Controls Bar */}
            <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '8px 12px',
                background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, transparent 100%)',
                display: 'flex',
                alignItems: 'center',
                gap: 8
            }}>
                <button
                    onClick={handleTogglePlay}
                    className="pip-btn pip-btn-play"
                    style={{
                        background: 'rgba(139, 92, 246, 0.8)',
                        border: 'none',
                        borderRadius: 6,
                        padding: 8,
                        cursor: 'pointer',
                        display: 'flex',
                        transition: 'all 0.2s ease'
                    }}
                >
                    {isPlaying ? <FaPause size={12} color="white" /> : <FaPlay size={12} color="white" />}
                </button>

                {/* Progress bar */}
                <div
                    style={{
                        flex: 1,
                        height: 4,
                        background: 'rgba(255,255,255,0.3)',
                        borderRadius: 2,
                        cursor: 'pointer',
                        overflow: 'hidden'
                    }}
                    onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pos = (e.clientX - rect.left) / rect.width;
                        handleSeek(pos * duration);
                    }}
                >
                    <div style={{
                        width: `${(currentTime / duration) * 100 || 0}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #8b5cf6, #a855f7)',
                        borderRadius: 2
                    }} />
                </div>

                {/* Volume control */}
                <div
                    onMouseEnter={() => setShowVolumeSlider(true)}
                    onMouseLeave={() => setShowVolumeSlider(false)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        position: 'relative'
                    }}
                >
                    <button
                        onClick={handleToggleMute}
                        className="pip-btn"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 4,
                            cursor: 'pointer',
                            display: 'flex',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        {(() => {
                            if (isMuted || volume === 0) {
                                return <FaVolumeMute size={14} color="white" style={{ transition: 'transform 0.2s ease' }} />;
                            } else if (volume < 0.33) {
                                return <FaVolumeOff size={14} color="white" style={{ transition: 'transform 0.2s ease' }} />;
                            } else if (volume < 0.66) {
                                return <FaVolumeDown size={14} color="white" style={{ transition: 'transform 0.2s ease' }} />;
                            } else {
                                return <FaVolumeUp size={14} color="white" style={{ transition: 'transform 0.2s ease' }} />;
                            }
                        })()}
                    </button>

                    <div style={{
                        width: showVolumeSlider ? 60 : 0,
                        overflow: 'hidden',
                        transition: 'width 0.2s ease',
                        display: 'flex',
                        alignItems: 'center'
                    }}>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={isMuted ? 0 : volume}
                            onChange={(e) => handleSetVolume(parseFloat(e.target.value))}
                            style={{
                                width: 55,
                                height: 4,
                                cursor: 'pointer',
                                accentColor: '#8b5cf6'
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Loading indicator */}
            {isLoading && (
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,0.5)'
                }}>
                    <div style={{
                        width: 24,
                        height: 24,
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderTopColor: '#8b5cf6',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                    }} />
                </div>
            )}

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                .pip-btn {
                    transition: all 0.2s ease;
                }
                .pip-btn:hover {
                    transform: scale(1.15);
                    filter: brightness(1.2);
                }
                .pip-btn:active {
                    transform: scale(0.95);
                }
                .pip-btn-close:hover {
                    background: rgba(239, 68, 68, 0.9) !important;
                }
                .pip-btn-expand:hover {
                    background: rgba(255,255,255,0.35) !important;
                }
                .pip-btn-play:hover {
                    background: rgba(139, 92, 246, 1) !important;
                }
                .pip-title-bar {
                    -webkit-app-region: drag;
                }
                .pip-title-buttons {
                    -webkit-app-region: no-drag;
                }
            `}</style>
        </div>
    );
}

export default PipWindow;
