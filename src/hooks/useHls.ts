import { useEffect, useRef } from 'react';
import Hls from 'hls.js';

interface UseHlsOptions {
    src: string;
    videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function useHls({ src, videoRef }: UseHlsOptions) {
    const hlsRef = useRef<Hls | null>(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return;

        console.log('🎥 useHls: Initializing with src:', src);

        // Check if HLS is needed (m3u8 format)
        const isHls = src.includes('.m3u8');

        if (isHls && Hls.isSupported()) {
            console.log('📺 Using HLS.js for m3u8');
            // Initialize HLS.js
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 90,
                maxBufferLength: 30,
                maxMaxBufferLength: 600,
            });

            hls.loadSource(src);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('✅ HLS manifest loaded, levels:', hls.levels.length);
            });

            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    console.error('❌ HLS fatal error:', data);
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.error('HLS network error, trying to recover');
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.error('HLS media error, trying to recover');
                            hls.recoverMediaError();
                            break;
                        default:
                            console.error('HLS fatal error, cannot recover');
                            hls.destroy();
                            break;
                    }
                }
            });

            hlsRef.current = hls;

            return () => {
                hls.destroy();
                hlsRef.current = null;
            };
        } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
            console.log('🍎 Using native HLS support (Safari)');
            // Native HLS support (Safari)
            video.src = src;
        } else {
            console.log('📹 Using direct video source (MP4/other)');
            // Regular video file
            video.src = src;

            // Add event listeners to debug
            video.addEventListener('loadstart', () => console.log('🔄 Video: loadstart'));
            video.addEventListener('loadeddata', () => console.log('✅ Video: loadeddata'));
            video.addEventListener('canplay', () => console.log('✅ Video: canplay'));
            video.addEventListener('error', (e) => console.error('❌ Video error:', e, video.error));
        }

        return () => {
            video.src = '';
        };
    }, [src, videoRef]);

    return hlsRef;
}
