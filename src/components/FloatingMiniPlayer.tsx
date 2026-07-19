/**
 * 🪟 Mini-player flutuante (in-app): o conteúdo continua tocando num cartão
 * fixo no canto enquanto o usuário navega pelo app. Arrastável pela barra do
 * título; expandir devolve pro player cheio via o evento 'miniPlayerExpand'.
 */
import { useEffect, useRef, useState } from 'react';
import { useHls } from '../hooks/useHls';
import { useLanguage } from '../services/languageService';
import type { MiniPlayerContent } from './miniPlayerContext';

interface FloatingMiniPlayerProps {
    content: MiniPlayerContent;
    /** 📺 Zap ao vivo: o provider troca o conteúdo pro canal vizinho. */
    onZap?: (patch: { src: string; title: string; contentId: string }) => void;
    onClose: () => void;
    onExpand: (currentTime: number) => void;
    onTime: (currentTime: number) => void;
}

const headerButtonStyle: React.CSSProperties = {
    flexShrink: 0,
    width: 26,
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    border: 'none',
    background: 'rgba(255, 255, 255, 0.1)',
    color: 'white',
    fontSize: 12,
    cursor: 'pointer'
};

export function FloatingMiniPlayer({ content, onZap, onClose, onExpand, onTime }: FloatingMiniPlayerProps) {
    const zap = async (direction: 1 | -1) => {
        const list = content.channelList;
        if (!list || list.length < 2) return;
        const index = Math.max(0, list.findIndex(c => String(c.id) === String(content.contentId)));
        const next = list[(index + direction + list.length) % list.length];
        let url = next.directUrl || null;
        if (!url) {
            const result = await window.ipcRenderer.invoke('streams:get-live-url', { streamId: next.id })
                .catch(() => null) as { success?: boolean; url?: string } | null;
            url = result?.success && result.url ? result.url : null;
        }
        if (url) onZap?.({ src: url, title: next.name, contentId: String(next.id) });
    };

    // 🎵 Faixas de áudio do HLS (lidas na hora do clique — lazy, sem eventos).
    const [audioMenu, setAudioMenu] = useState<{ id: number; name: string; active: boolean }[] | null>(null);
    const toggleAudioMenu = () => {
        setAudioMenu(prev => {
            if (prev) return null;
            const hls = hlsRef.current;
            const tracks = hls?.audioTracks ?? [];
            return tracks.map((track, index) => ({
                id: index,
                name: track.name || track.lang || `Áudio ${index + 1}`,
                active: hls?.audioTrack === index
            }));
        });
    };
    const pickAudioTrack = (id: number) => {
        if (hlsRef.current) hlsRef.current.audioTrack = id;
        setAudioMenu(null);
    };

    const videoRef = useRef<HTMLVideoElement>(null);
    const [paused, setPaused] = useState(false);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
    const { t } = useLanguage();

    const hlsRef = useHls({ src: content.src, videoRef });

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const handleLoaded = () => {
            if (content.currentTime && content.contentType !== 'live') {
                video.currentTime = content.currentTime;
            }
            video.play().catch(() => undefined);
        };
        const handleTime = () => onTime(video.currentTime);
        const handlePlay = () => setPaused(false);
        const handlePause = () => setPaused(true);
        video.addEventListener('loadedmetadata', handleLoaded);
        video.addEventListener('timeupdate', handleTime);
        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        return () => {
            video.removeEventListener('loadedmetadata', handleLoaded);
            video.removeEventListener('timeupdate', handleTime);
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
        };
    }, [content, onTime]);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        dragRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            baseX: offset.x,
            baseY: offset.y
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        setOffset({ x: drag.baseX + (e.clientX - drag.startX), y: drag.baseY + (e.clientY - drag.startY) });
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
    };

    const togglePlay = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) video.play().catch(() => undefined);
        else video.pause();
    };

    return (
        <div style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            transform: `translate(${offset.x}px, ${offset.y}px)`,
            width: 360,
            zIndex: 9500,
            borderRadius: 14,
            overflow: 'hidden',
            background: '#000',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)'
        }}>
            <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    background: 'rgba(15, 23, 42, 0.95)',
                    cursor: 'grab',
                    userSelect: 'none',
                    touchAction: 'none'
                }}
            >
                <span style={{
                    flex: 1,
                    minWidth: 0,
                    color: 'white',
                    fontSize: 12,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                }}>
                    {content.title}
                </span>
                {audioMenu && (
                    <div style={{ position: 'absolute', top: 40, right: 8, zIndex: 5, background: 'rgba(10, 10, 25, 0.96)', border: '1px solid rgba(var(--ns-accent-rgb), 0.4)', borderRadius: 8, padding: 6, minWidth: 140 }}>
                        {audioMenu.length === 0 && (
                            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, padding: '4px 6px' }}>—</div>
                        )}
                        {audioMenu.map(track => (
                            <button
                                key={track.id}
                                onClick={() => pickAudioTrack(track.id)}
                                style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: track.active ? 'rgba(var(--ns-accent-rgb), 0.25)' : 'transparent', color: 'white', fontSize: 12, padding: '5px 8px', borderRadius: 6, cursor: 'pointer' }}
                            >
                                {track.name}
                            </button>
                        ))}
                    </div>
                )}
                <button onClick={toggleAudioMenu} style={headerButtonStyle} title="🎵">🎵</button>
                {content.contentType === 'live' && (content.channelList?.length ?? 0) > 1 && (
                    <>
                        <button onClick={() => void zap(-1)} style={headerButtonStyle} title="Canal anterior">⏮</button>
                        <button onClick={() => void zap(1)} style={headerButtonStyle} title="Próximo canal">⏭</button>
                    </>
                )}
                <button onClick={togglePlay} style={headerButtonStyle} title={paused ? '▶' : '⏸'}>
                    {paused ? '▶' : '⏸'}
                </button>
                <button
                    onClick={() => onExpand(videoRef.current?.currentTime || 0)}
                    style={headerButtonStyle}
                    title={t('player', 'miniExpand')}
                >
                    ⤢
                </button>
                <button onClick={onClose} style={headerButtonStyle} title={t('player', 'miniClose')}>
                    ✕
                </button>
            </div>
            <video
                ref={videoRef}
                poster={content.poster}
                onClick={togglePlay}
                style={{ width: '100%', aspectRatio: '16 / 9', display: 'block', background: '#000' }}
            />
        </div>
    );
}
