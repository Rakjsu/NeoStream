import { useRef, useState } from 'react';

interface ContinueFramePreviewProps {
    url: string;
    /** Segundos do ponto salvo — o frame mostrado é o deste instante. */
    time: number;
    x: number;
    y: number;
}

/**
 * 🖼️ Preview do frame no ponto salvo (hover no "continuar assistindo"):
 * um <video> pausado com currentTime no progresso — o browser busca só o
 * frame via range request. Se o contêiner não suportar (mkv etc.), some.
 */
export function ContinueFramePreview({ url, time, x, y }: ContinueFramePreviewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const [ready, setReady] = useState(false);

    if (failed) return null;

    const left = Math.min(x, window.innerWidth - 340);
    const top = Math.min(y, window.innerHeight - 220);

    return (
        <div style={{
            position: 'fixed',
            left,
            top,
            zIndex: 9500,
            width: 320,
            pointerEvents: 'none',
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid rgba(var(--ns-accent-rgb), 0.4)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
            background: '#000',
            opacity: ready ? 1 : 0,
            transition: 'opacity 0.25s ease'
        }}>
            <video
                ref={videoRef}
                src={url}
                muted
                preload="metadata"
                onLoadedMetadata={() => {
                    if (videoRef.current) videoRef.current.currentTime = Math.max(0, time);
                }}
                onSeeked={() => setReady(true)}
                onError={() => setFailed(true)}
                style={{ width: '100%', display: 'block' }}
            />
        </div>
    );
}
