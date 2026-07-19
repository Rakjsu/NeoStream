// 🎬 Item 29 (modo cinema): luz ambiente — amostra o frame do <video> num
// canvas minúsculo e devolve a cor média escurecida pro glow das bordas.
// Canvas "tainted" (stream sem CORS) degrada pra null sem quebrar nada.
import { useEffect, useState, type RefObject } from 'react';

const SAMPLE_SIZE = 4;
const INTERVAL_MS = 700;

/** Média RGB dos pixels (RGBA plano), escurecida pro glow não ofuscar. PURO. */
export function averageColor(data: Uint8ClampedArray | number[], darken = 0.6): string {
    const count = Math.floor(data.length / 4);
    if (!count) return 'rgb(0, 0, 0)';
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < count; i++) {
        r += data[i * 4];
        g += data[i * 4 + 1];
        b += data[i * 4 + 2];
    }
    const factor = darken / count;
    return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

export function useAmbientLight(videoRef: RefObject<HTMLVideoElement | null>, enabled: boolean): string | null {
    const [color, setColor] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled) {
            queueMicrotask(() => setColor(null));
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;

        const timer = window.setInterval(() => {
            const video = videoRef.current;
            if (!video || video.readyState < 2 || video.videoWidth === 0) return;
            try {
                context.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
                const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
                setColor(averageColor(data));
            } catch {
                // Canvas tainted (stream sem CORS): fica na vinheta neutra.
                setColor(null);
            }
        }, INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [videoRef, enabled]);

    return color;
}
