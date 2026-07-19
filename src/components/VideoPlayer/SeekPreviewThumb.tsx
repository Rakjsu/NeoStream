// 🖼️ Item 31: preview de miniatura ao pairar na barra de progresso.
// Um segundo <video> OCULTO com a MESMA fonte faz seek pro ponto do hover e
// captura o frame (canvas) — sem sprites/ffmpeg. Cache por janelas de 10s
// pra não re-seekar a cada pixel; live fica de fora (sem duração).
import { useEffect, useRef, useState } from 'react';
import { useHls } from '../../hooks/useHls';
import { previewBucket, previewSeekTarget } from './playerExtras';

const THUMB_W = 200;
const THUMB_H = 112;
/** Espera do mouse parado antes de gastar um seek. */
const HOVER_DEBOUNCE_MS = 120;

interface SeekPreviewThumbProps {
    src: string;
    /** Tempo do hover em segundos (-1 = sem hover). */
    timeSec: number;
    visible: boolean;
    /** Posição horizontal (px) dentro do container da barra. */
    x: number;
}

export function SeekPreviewThumb({ src, timeSec, visible, x }: SeekPreviewThumbProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const cacheRef = useRef<Map<number, string>>(new Map());
    const [thumb, setThumb] = useState<string | null>(null);
    useHls({ src, videoRef, onStreamError: () => undefined });

    // Fonte trocou (outra versão/episódio): o cache antigo não vale mais.
    useEffect(() => {
        cacheRef.current = new Map();
        queueMicrotask(() => setThumb(null));
    }, [src]);

    useEffect(() => {
        if (!visible || timeSec < 0) return;
        const bucket = previewBucket(timeSec);
        if (bucket < 0) return;
        const cached = cacheRef.current.get(bucket);
        if (cached) {
            queueMicrotask(() => setThumb(cached));
            return;
        }
        const timer = window.setTimeout(() => {
            const video = videoRef.current;
            if (!video) return;
            const onSeeked = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = THUMB_W;
                    canvas.height = THUMB_H;
                    const context = canvas.getContext('2d');
                    if (context && video.videoWidth > 0) {
                        context.drawImage(video, 0, 0, THUMB_W, THUMB_H);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                        cacheRef.current.set(bucket, dataUrl);
                        setThumb(dataUrl);
                    }
                } catch { /* canvas tainted (stream sem CORS): fica só o tempo */ }
            };
            video.addEventListener('seeked', onSeeked, { once: true });
            try {
                video.currentTime = previewSeekTarget(bucket);
            } catch { /* metadata ainda não carregou */ }
        }, HOVER_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [visible, timeSec]);

    return (
        <>
            <video ref={videoRef} muted preload="metadata" crossOrigin="anonymous" style={{ display: 'none' }} />
            {visible && thumb && (
                <div
                    style={{
                        position: 'absolute', bottom: 34, left: x, transform: 'translateX(-50%)',
                        width: THUMB_W, height: THUMB_H, borderRadius: 8, overflow: 'hidden',
                        border: '1px solid rgba(255,255,255,0.3)', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                        pointerEvents: 'none', zIndex: 30,
                    }}
                >
                    <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
            )}
        </>
    );
}
