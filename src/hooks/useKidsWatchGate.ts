import { useEffect, useState, type RefObject } from 'react';
import { isWatchBlockedNow } from '../services/watchGateService';

/**
 * ⏰ A trava de tempo de tela / janela de horário para uma superfície de vídeo.
 *
 * Reconfere a decisão (`isWatchBlockedNow`) a cada 30 s e, quando ela fecha,
 * PAUSA o `<video>` passado e segura cada `play` que chegar depois. Sem
 * `videoRef` (o mosaico, que prefere nem montar os `<video>`) devolve só o
 * booleano.
 *
 * Uma vez bloqueado, fica bloqueado até a tela ser remontada — é a semântica
 * que o `VideoPlayer` já tinha, mantida de propósito.
 */

/** De quanto em quanto tempo cada superfície reconfere a trava. */
export const KIDS_GATE_POLL_MS = 30_000;

export function useKidsWatchGate(videoRef?: RefObject<HTMLVideoElement | null>): boolean {
    const [blocked, setBlocked] = useState(false);

    useEffect(() => {
        const conferir = () => {
            if (isWatchBlockedNow()) setBlocked(true);
        };
        queueMicrotask(conferir);
        const intervalId = setInterval(conferir, KIDS_GATE_POLL_MS);
        return () => clearInterval(intervalId);
    }, []);

    useEffect(() => {
        if (!blocked) return;
        const video = videoRef?.current;
        if (!video) return;
        video.pause();
        const blockPlay = () => video.pause();
        video.addEventListener('play', blockPlay);
        return () => video.removeEventListener('play', blockPlay);
    }, [blocked, videoRef]);

    return blocked;
}
