/**
 * Mini Player Context
 * Provides a floating mini player that persists across navigation
 */

import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FaPlay, FaPause, FaTimes, FaExpand, FaVolumeUp, FaVolumeMute } from 'react-icons/fa';
import { useHls } from '../hooks/useHls';
import { useVideoPlayer } from '../hooks/useVideoPlayer';
import { usageStatsService } from '../services/usageStatsService';

interface MiniPlayerContent {
    src: string;
    title: string;
    poster?: string;
    contentId?: string;
    contentType?: 'movie' | 'series' | 'live';
    currentTime?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    onExpand?: (currentTime: number) => void;
}

interface MiniPlayerContextType {
    isActive: boolean;
    content: MiniPlayerContent | null;
    startMiniPlayer: (content: MiniPlayerContent) => void;
    stopMiniPlayer: () => void;
    getCurrentTime: () => number;
}

const MiniPlayerContext = createContext<MiniPlayerContextType | null>(null);

export function useMiniPlayer() {
    const context = useContext(MiniPlayerContext);
    if (!context) {
        throw new Error('useMiniPlayer must be used within MiniPlayerProvider');
    }
    return context;
}

export function MiniPlayerProvider({ children }: { children: React.ReactNode }) {
    const [isActive, setIsActive] = useState(false);
    const [content, setContent] = useState<MiniPlayerContent | null>(null);
    const videoTimeRef = useRef<number>(0);

    const startMiniPlayer = useCallback((newContent: MiniPlayerContent) => {
        setContent(newContent);
        setIsActive(true);
        videoTimeRef.current = newContent.currentTime || 0;

        // Start usage tracking
        if (newContent.contentId && newContent.title) {
            usageStatsService.startSession(
                newContent.contentId,
                newContent.contentType || 'movie',
                newContent.title
            );
        }

        // Open external PiP window via IPC
        if (window.ipcRenderer) {
            window.ipcRenderer.invoke('pip:open', newContent).catch(console.error);
        }
    }, []);

    const stopMiniPlayer = useCallback(() => {
        usageStatsService.endSession();
        setIsActive(false);
        setContent(null);
        videoTimeRef.current = 0;

        // Close external PiP window
        if (window.ipcRenderer) {
            window.ipcRenderer.invoke('pip:close', {}).catch(console.error);
        }
    }, []);

    const getCurrentTime = useCallback(() => videoTimeRef.current, []);

    const updateTime = useCallback((time: number) => {
        videoTimeRef.current = time;
    }, []);

    // Listen for PiP closed event from external window
    React.useEffect(() => {
        if (!window.ipcRenderer) return;

        const handlePipClosed = () => {
            usageStatsService.endSession();
            setIsActive(false);
            setContent(null);
            videoTimeRef.current = 0;
        };

        const handlePipState = (_event: any, state: { currentTime: number }) => {
            videoTimeRef.current = state.currentTime;
        };

        const handlePipExpand = (_event: any, expandContent: MiniPlayerContent) => {
            // Emit event for pages to handle expansion
            const expandEvent = new CustomEvent('miniPlayerExpand', {
                detail: {
                    src: expandContent.src,
                    title: expandContent.title,
                    poster: expandContent.poster,
                    contentId: expandContent.contentId,
                    contentType: expandContent.contentType,
                    currentTime: expandContent.currentTime,
                    seasonNumber: expandContent.seasonNumber,
                    episodeNumber: expandContent.episodeNumber
                }
            });
            window.dispatchEvent(expandEvent);

            // Also call the callback if provided
            if (expandContent.onExpand && expandContent.currentTime) {
                expandContent.onExpand(expandContent.currentTime);
            }

            setIsActive(false);
            setContent(null);
        };

        window.ipcRenderer.on('pip:closed', handlePipClosed);
        window.ipcRenderer.on('pip:state', handlePipState);
        window.ipcRenderer.on('pip:expand', handlePipExpand);

        return () => {
            window.ipcRenderer?.off('pip:closed', handlePipClosed);
            window.ipcRenderer?.off('pip:state', handlePipState);
            window.ipcRenderer?.off('pip:expand', handlePipExpand);
        };
    }, []);

    // Expose context globally for VideoPlayer access
    React.useEffect(() => {
        (window as any).__miniPlayerContext = {
            startMiniPlayer,
            stopMiniPlayer,
            getCurrentTime,
            isActive
        };
        return () => {
            delete (window as any).__miniPlayerContext;
        };
    }, [startMiniPlayer, stopMiniPlayer, getCurrentTime, isActive]);

    return (
        <MiniPlayerContext.Provider value={{ isActive, content, startMiniPlayer, stopMiniPlayer, getCurrentTime }}>
            {children}
            {/* External PiP window is now used instead of internal MiniPlayerUI */}
        </MiniPlayerContext.Provider>
    );
}

// Mini Player UI Component
function MiniPlayerUI({
    content,
    onClose,
    onTimeUpdate
}: {
    content: MiniPlayerContent;
    onClose: () => void;
    onTimeUpdate: (time: number) => void;
}) {
    const { videoRef, state, controls } = useVideoPlayer();
    useHls({ src: content.src, videoRef });

    const [position, setPosition] = useState({ x: window.innerWidth - 370, y: window.innerHeight - 250 });
    const [size, setSize] = useState({ width: 350, height: 210 });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState<string | null>(null);
    const [showVolumeSlider, setShowVolumeSlider] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const resizeStart = useRef({ width: 350, height: 210, x: 0, y: 0 });

    // Set initial time when video is ready
    React.useEffect(() => {
        if (content.currentTime && videoRef.current) {
            const setTime = () => {
                if (videoRef.current && content.currentTime) {
                    videoRef.current.currentTime = content.currentTime;
                    videoRef.current.play();
                }
            };
            if (videoRef.current.readyState >= 2) {
                setTime();
            } else {
                videoRef.current.addEventListener('canplay', setTime, { once: true });
            }
        }
    }, [content.currentTime]);

    // Track time updates
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => {
            onTimeUpdate(video.currentTime);
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        return () => video.removeEventListener('timeupdate', handleTimeUpdate);
    }, [onTimeUpdate]);

    // Drag handlers - only from title bar
    const handleDragStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
        dragOffset.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
    };

    // Resize handlers
    const handleResizeStart = (e: React.MouseEvent, direction: string) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(direction);
        resizeStart.current = {
            width: size.width,
            height: size.height,
            x: e.clientX,
            y: e.clientY
        };
    };

    React.useEffect(() => {
        if (!isDragging && !isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                const newX = Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragOffset.current.x));
                const newY = Math.max(0, Math.min(window.innerHeight - size.height, e.clientY - dragOffset.current.y));
                setPosition({ x: newX, y: newY });
            } else if (isResizing) {
                const deltaX = e.clientX - resizeStart.current.x;
                const deltaY = e.clientY - resizeStart.current.y;

                let newWidth = resizeStart.current.width;
                let newHeight = resizeStart.current.height;

                if (isResizing.includes('e')) newWidth = Math.max(280, Math.min(600, resizeStart.current.width + deltaX));
                if (isResizing.includes('w')) newWidth = Math.max(280, Math.min(600, resizeStart.current.width - deltaX));
                if (isResizing.includes('s')) newHeight = Math.max(160, Math.min(400, resizeStart.current.height + deltaY));
                if (isResizing.includes('n')) newHeight = Math.max(160, Math.min(400, resizeStart.current.height - deltaY));

                // Keep 16:9 aspect ratio approximately
                if (isResizing === 'e' || isResizing === 'w') {
                    newHeight = Math.round(newWidth * 0.6);
                }

                setSize({ width: newWidth, height: newHeight });

                // Adjust position for west/north resize
                if (isResizing.includes('w')) {
                    setPosition(p => ({ ...p, x: p.x + (size.width - newWidth) }));
                }
                if (isResizing.includes('n')) {
                    setPosition(p => ({ ...p, y: p.y + (size.height - newHeight) }));
                }
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(null);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing, size.width, size.height]);

    const handleExpand = () => {
        const currentTime = videoRef.current?.currentTime || 0;

        // Emit global event for pages to listen and reopen full player
        const expandEvent = new CustomEvent('miniPlayerExpand', {
            detail: {
                src: content.src,
                title: content.title,
                poster: content.poster,
                contentId: content.contentId,
                contentType: content.contentType,
                currentTime,
                seasonNumber: content.seasonNumber,
                episodeNumber: content.episodeNumber
            }
        });
        window.dispatchEvent(expandEvent);

        // Also call the callback if provided
        if (content.onExpand) {
            content.onExpand(currentTime);
        }

        onClose();
    };

    return createPortal(
        <div
            style={{
                position: 'fixed',
                left: position.x,
                top: position.y,
                width: size.width,
                height: size.height,
                background: '#000',
                borderRadius: 12,
                overflow: 'visible',
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                zIndex: 9999,
                userSelect: 'none'
            }}
        >
            {/* Resize handles */}
            <div onMouseDown={(e) => handleResizeStart(e, 'e')} style={{ position: 'absolute', right: -4, top: 20, bottom: 20, width: 8, cursor: 'ew-resize', zIndex: 10 }} />
            <div onMouseDown={(e) => handleResizeStart(e, 'w')} style={{ position: 'absolute', left: -4, top: 20, bottom: 20, width: 8, cursor: 'ew-resize', zIndex: 10 }} />
            <div onMouseDown={(e) => handleResizeStart(e, 's')} style={{ position: 'absolute', bottom: -4, left: 20, right: 20, height: 8, cursor: 'ns-resize', zIndex: 10 }} />
            <div onMouseDown={(e) => handleResizeStart(e, 'se')} style={{ position: 'absolute', right: -4, bottom: -4, width: 12, height: 12, cursor: 'nwse-resize', zIndex: 10 }} />
            <div onMouseDown={(e) => handleResizeStart(e, 'sw')} style={{ position: 'absolute', left: -4, bottom: -4, width: 12, height: 12, cursor: 'nesw-resize', zIndex: 10 }} />

            {/* Video container */}
            <div style={{ width: '100%', height: '100%', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
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

                {/* Title Bar - Drag zone */}
                <div
                    onMouseDown={handleDragStart}
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
                        cursor: isDragging ? 'grabbing' : 'grab'
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
                    <div style={{ display: 'flex', gap: 4 }}>
                        <button
                            onClick={handleExpand}
                            style={{
                                background: 'rgba(255,255,255,0.2)',
                                border: 'none',
                                borderRadius: 4,
                                padding: 6,
                                cursor: 'pointer',
                                display: 'flex'
                            }}
                            title="Expandir"
                        >
                            <FaExpand size={12} color="white" />
                        </button>
                        <button
                            onClick={onClose}
                            style={{
                                background: 'rgba(239, 68, 68, 0.6)',
                                border: 'none',
                                borderRadius: 4,
                                padding: 6,
                                cursor: 'pointer',
                                display: 'flex'
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
                        onClick={controls.togglePlay}
                        style={{
                            background: 'rgba(139, 92, 246, 0.8)',
                            border: 'none',
                            borderRadius: 6,
                            padding: 8,
                            cursor: 'pointer',
                            display: 'flex'
                        }}
                    >
                        {state.playing ? <FaPause size={12} color="white" /> : <FaPlay size={12} color="white" />}
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
                            controls.seek(pos * state.duration);
                        }}
                    >
                        <div style={{
                            width: `${(state.currentTime / state.duration) * 100 || 0}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #8b5cf6, #a855f7)',
                            borderRadius: 2
                        }} />
                    </div>

                    {/* Volume control with hover slider */}
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
                            onClick={controls.toggleMute}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                padding: 4,
                                cursor: 'pointer',
                                display: 'flex'
                            }}
                        >
                            {state.muted ? <FaVolumeMute size={14} color="white" /> : <FaVolumeUp size={14} color="white" />}
                        </button>

                        {/* Volume slider */}
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
                                value={state.muted ? 0 : state.volume}
                                onChange={(e) => controls.setVolume(parseFloat(e.target.value))}
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
                {state.loading && (
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
            </div>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>,
        document.body
    );
}

