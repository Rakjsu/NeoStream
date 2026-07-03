import { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';

export interface MultiViewChannel {
    id: string | number;
    name: string;
    logo?: string;
}

interface MultiViewProps {
    channels: MultiViewChannel[];
    /** Channel pre-selected for the first tile (came from "Multi-view" entry point). */
    initialChannelId?: string | number;
    onClose: () => void;
}

/**
 * Live TV mosaic: up to 4 channels playing at once, all muted except the
 * focused one (click a tile to move the audio there). Each tile runs its own
 * lean hls.js instance — no controls, no fallback chain, mosaic-grade only.
 */
export function MultiView({ channels, initialChannelId, onClose }: MultiViewProps) {
    const [slots, setSlots] = useState<(MultiViewChannel | null)[]>(() => {
        const first = initialChannelId !== undefined
            ? channels.find(c => String(c.id) === String(initialChannelId)) ?? null
            : null;
        return [first, null, null, null];
    });
    const [audioSlot, setAudioSlot] = useState(0);
    const [pickerSlot, setPickerSlot] = useState<number | null>(null);
    const [pickerQuery, setPickerQuery] = useState('');

    // Esc closes the picker first, then the mosaic.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            if (pickerSlot !== null) setPickerSlot(null);
            else onClose();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [pickerSlot, onClose]);

    const filteredChannels = useMemo(() => {
        const q = pickerQuery.trim().toLowerCase();
        if (!q) return channels;
        return channels.filter(c => c.name.toLowerCase().includes(q));
    }, [channels, pickerQuery]);

    return (
        // top: 36 = CustomTitleBar height — it sits at z-index 99999 and would
        // cover this overlay's own top bar (✕ Fechar) if we used inset: 0.
        <div style={{ position: 'fixed', top: 36, left: 0, right: 0, bottom: 0, zIndex: 9000, background: '#000', display: 'flex', flexDirection: 'column' }}>
            {/* Top bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'rgba(15, 15, 35, 0.95)' }}>
                <span style={{ color: 'white', fontWeight: 700, fontSize: 15 }}>🔲 Multi-view</span>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                    Clique num quadro para levar o áudio · Esc sai
                </span>
                <button
                    onClick={onClose}
                    style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', background: 'transparent', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                    ✕ Fechar
                </button>
            </div>

            {/* 2x2 grid */}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 4, padding: 4 }}>
                {slots.map((channel, i) => (
                    <div
                        key={i}
                        onClick={() => channel && setAudioSlot(i)}
                        style={{
                            position: 'relative',
                            background: '#0a0a18',
                            borderRadius: 10,
                            overflow: 'hidden',
                            border: channel && audioSlot === i ? '2px solid var(--ns-accent)' : '2px solid transparent',
                            cursor: channel ? 'pointer' : 'default'
                        }}
                    >
                        {channel ? (
                            <>
                                <MultiViewTile channel={channel} muted={audioSlot !== i} />
                                <div style={{ position: 'absolute', top: 8, left: 10, display: 'flex', alignItems: 'center', gap: 8, zIndex: 2 }}>
                                    <span style={{ padding: '3px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.65)', color: 'white', fontSize: 12, fontWeight: 600 }}>
                                        {channel.name}
                                    </span>
                                    {audioSlot === i && <span style={{ fontSize: 13 }}>🔊</span>}
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSlots(prev => prev.map((s, idx) => idx === i ? null : s));
                                    }}
                                    title="Remover canal"
                                    style={{ position: 'absolute', top: 8, right: 10, zIndex: 2, width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: 'white', cursor: 'pointer', fontSize: 13 }}
                                >
                                    ✕
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => { setPickerQuery(''); setPickerSlot(i); }}
                                style={{ position: 'absolute', inset: 0, border: '2px dashed rgba(255,255,255,0.15)', borderRadius: 10, background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 15, cursor: 'pointer' }}
                            >
                                + Adicionar canal
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Channel picker for an empty slot */}
            {pickerSlot !== null && (
                <div
                    onClick={() => setPickerSlot(null)}
                    style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: 420, maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: 'var(--ns-bg-panel, #181829)', borderRadius: 14, border: '1px solid rgba(var(--ns-accent-rgb), 0.35)', padding: 16 }}
                    >
                        <input
                            autoFocus
                            type="text"
                            value={pickerQuery}
                            onChange={(e) => setPickerQuery(e.target.value)}
                            placeholder="Buscar canal..."
                            style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.07)', color: 'white', fontSize: 13, outline: 'none', marginBottom: 10 }}
                        />
                        <div style={{ overflowY: 'auto' }}>
                            {filteredChannels.slice(0, 200).map(ch => (
                                <div
                                    key={ch.id}
                                    onClick={() => {
                                        setSlots(prev => prev.map((s, idx) => idx === pickerSlot ? ch : s));
                                        setPickerSlot(null);
                                    }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--ns-accent-rgb), 0.18)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                >
                                    {ch.logo
                                        ? <img src={ch.logo} alt="" style={{ width: 26, height: 26, objectFit: 'contain', flexShrink: 0 }} loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                                        : <span style={{ width: 26, textAlign: 'center', flexShrink: 0 }}>📺</span>}
                                    <span style={{ color: 'white', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** One mosaic tile: resolve the live URL and play it with a lean hls.js. */
function MultiViewTile({ channel, muted }: { channel: MultiViewChannel; muted: boolean }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        let hls: Hls | null = null;
        let cancelled = false;

        (async () => {
            const result = await window.ipcRenderer.invoke('streams:get-live-url', { streamId: channel.id })
                .catch(() => null);
            if (cancelled) return;
            if (!result?.success || !result.url) {
                setFailed(true);
                return;
            }
            const url: string = result.url;
            if (url.includes('.m3u8') && Hls.isSupported()) {
                hls = new Hls({
                    enableWorker: true,
                    // Mosaic-grade buffers: keep memory/bandwidth per tile low.
                    maxBufferLength: 10,
                    backBufferLength: 10,
                    fragLoadingMaxRetry: 2,
                });
                hls.loadSource(url);
                hls.attachMedia(video);
                hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) setFailed(true); });
            } else {
                video.src = url;
            }
            video.play().catch(() => { /* autoplay policies — muted, should play */ });
        })();

        return () => {
            cancelled = true;
            if (hls) hls.destroy();
            video.removeAttribute('src');
            video.load();
        };
    }, [channel.id]);

    return failed ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            ⚠️ Canal indisponível
        </div>
    ) : (
        <video
            ref={videoRef}
            muted={muted}
            autoPlay
            playsInline
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
        />
    );
}
