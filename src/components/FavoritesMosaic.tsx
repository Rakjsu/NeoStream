// 🧩 Item 33: mosaico de miniaturas dos canais favoritos — um player OCULTO
// visita cada favorito em rodízio, captura um frame e atualiza a miniatura do
// tile (leve: 1 stream por vez, não N players). Clicar num tile sintoniza.
import { useEffect, useRef, useState } from 'react';
import { useHls } from '../hooks/useHls';
import { useLanguage } from '../services/languageService';

export interface MosaicChannel {
    stream_id: number | string;
    name: string;
    stream_icon?: string;
    direct_source?: string;
}

/** Tempo parado em cada canal antes de capturar o frame e avançar. */
const DWELL_MS = 5000;

interface FavoritesMosaicProps<T extends MosaicChannel> {
    channels: T[];
    buildStreamUrl: (channel: T) => Promise<string>;
    onTune: (channel: T) => void;
    onClose: () => void;
}

export function FavoritesMosaic<T extends MosaicChannel>({ channels, buildStreamUrl, onTune, onClose }: FavoritesMosaicProps<T>) {
    const { t } = useLanguage();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [src, setSrc] = useState('');
    const [snapshots, setSnapshots] = useState<Map<string, string>>(new Map());
    const [scanningId, setScanningId] = useState<string | null>(null);
    useHls({ src, videoRef, onStreamError: () => undefined });

    useEffect(() => {
        let cancelled = false;
        let timer = 0;
        const scan = async (index: number) => {
            if (cancelled || channels.length === 0) return;
            const channel = channels[index % channels.length];
            const id = String(channel.stream_id);
            setScanningId(id);
            try {
                const url = await buildStreamUrl(channel);
                if (cancelled) return;
                setSrc(url);
            } catch { /* canal fora do ar — captura não acontece, segue o rodízio */ }
            timer = window.setTimeout(() => {
                if (cancelled) return;
                const video = videoRef.current;
                if (video && video.readyState >= 2 && video.videoWidth > 0) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = 320;
                        canvas.height = 180;
                        const context = canvas.getContext('2d');
                        if (context) {
                            context.drawImage(video, 0, 0, 320, 180);
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                            setSnapshots(prev => new Map(prev).set(id, dataUrl));
                        }
                    } catch { /* canvas tainted (stream sem CORS): fica o logo */ }
                }
                void scan(index + 1);
            }, DWELL_MS);
        };
        queueMicrotask(() => void scan(0));
        return () => { cancelled = true; window.clearTimeout(timer); };
        // A lista é estável enquanto o mosaico está aberto.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(8, 8, 18, 0.97)', display: 'flex', flexDirection: 'column' }}>
            {/* player oculto do rodízio de capturas */}
            <video ref={videoRef} muted autoPlay crossOrigin="anonymous" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 26px' }}>
                <div>
                    <div style={{ color: 'white', fontSize: 18, fontWeight: 800 }}>🧩 {t('favMosaic', 'title')}</div>
                    <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 }}>{t('favMosaic', 'hint')}</div>
                </div>
                <button
                    onClick={onClose}
                    style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', background: 'transparent', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                    ✕ {t('favMosaic', 'close')}
                </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 26px 26px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, alignContent: 'start' }}>
                {channels.map(channel => {
                    const id = String(channel.stream_id);
                    const snapshot = snapshots.get(id);
                    return (
                        <button
                            key={id}
                            onClick={() => onTune(channel)}
                            style={{
                                position: 'relative', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden',
                                border: scanningId === id ? '2px solid var(--ns-accent, #7c3aed)' : '1px solid rgba(255,255,255,0.12)',
                                background: snapshot ? `url(${snapshot}) center/cover` : 'rgba(255,255,255,0.05)',
                                cursor: 'pointer', padding: 0,
                            }}
                        >
                            {!snapshot && channel.stream_icon && (
                                <img src={channel.stream_icon} alt="" style={{ position: 'absolute', inset: 0, margin: 'auto', maxWidth: '45%', maxHeight: '45%', objectFit: 'contain', opacity: 0.9 }} />
                            )}
                            {scanningId === id && (
                                <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 12 }}>🔄</span>
                            )}
                            <span
                                style={{
                                    position: 'absolute', left: 0, right: 0, bottom: 0, padding: '18px 10px 8px',
                                    background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
                                    color: 'white', fontSize: 12, fontWeight: 700, textAlign: 'left',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}
                            >
                                {channel.name}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
