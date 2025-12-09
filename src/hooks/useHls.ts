import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { playbackService } from '../services/playbackService';

interface UseHlsOptions {
    src: string;
    videoRef: React.RefObject<HTMLVideoElement | null>;
}

// Global lock with timestamp - prevents Strict Mode double-init for 500ms
const srcInitTimes = new Map<string, number>();

export function useHls({ src, videoRef }: UseHlsOptions) {
    const hlsRef = useRef<Hls | null>(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return;

        // Check if this src was initialized recently (within 500ms = Strict Mode)
        const lastInitTime = srcInitTimes.get(src) || 0;
        const timeSinceLastInit = Date.now() - lastInitTime;

        if (timeSinceLastInit < 500) {
            console.log('⏭️ Skipping duplicate init (Strict Mode detected)');
            return; // Don't cleanup on skip, just return without doing anything
        }

        // Mark this src as being initialized NOW
        srcInitTimes.set(src, Date.now());

        // Get buffer settings synchronously
        const config = playbackService.getConfig();
        let bufferSeconds = 15;
        if (config.bufferSize === 'intelligent') {
            const cached = playbackService.getCachedBufferSeconds();
            bufferSeconds = cached || 15;
            // Pre-fetch for future videos silently
            playbackService.getBufferSeconds().catch(() => { });
        } else {
            bufferSeconds = parseInt(config.bufferSize, 10);
        }

        console.log('🎥 useHls: Loading video with buffer', bufferSeconds + 's');

        // Clean up any existing HLS instance first
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        const isHls = src.includes('.m3u8');

        if (isHls && Hls.isSupported()) {
            console.log('📺 Using HLS.js for m3u8');

            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: bufferSeconds * 2,
                maxBufferLength: bufferSeconds,
                maxMaxBufferLength: bufferSeconds * 20,
                maxBufferHole: 0.5,
            });

            hls.loadSource(src);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('✅ HLS manifest loaded');
            });

            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    console.error('HLS fatal error:', data);
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            hls.recoverMediaError();
                            break;
                        default:
                            hls.destroy();
                            break;
                    }
                }
            });

            hlsRef.current = hls;

            return () => {
                // Allow re-initialization after 1 second (for genuine source changes)
                setTimeout(() => srcInitTimes.delete(src), 1000);
                hls.destroy();
                hlsRef.current = null;
            };
        } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
            console.log('🍎 Using native HLS (Safari)');
            video.src = src;
        } else {
            console.log('📹 Using direct video source (MP4/other)');
            // Only set src if it's different to avoid reloading and resetting position
            if (video.src !== src) {
                video.src = src;
            }
        }
        return () => {
            // Allow re-initialization after 1 second
            setTimeout(() => srcInitTimes.delete(src), 1000);
            // DON'T clear video.src - this causes AbortError
        };
    }, [src, videoRef]);

    return hlsRef;
}
