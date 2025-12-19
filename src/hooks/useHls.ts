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

        
        // Clean up any existing HLS instance first
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        const isHls = src.includes('.m3u8');

        if (isHls && Hls.isSupported()) {
            
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: bufferSeconds * 2,
                maxBufferLength: bufferSeconds,
                maxMaxBufferLength: bufferSeconds * 20,
                maxBufferHole: 0.5,
                // Network/Bandwidth settings - remove limitations
                abrEwmaDefaultEstimate: 5000000, // Start assuming 5Mbps (higher = better quality initially)
                abrEwmaFastLive: 3, // Fast adaptation for live
                abrEwmaSlowLive: 9,
                abrEwmaFastVoD: 3,
                abrEwmaSlowVoD: 9,
                abrBandWidthFactor: 0.95, // Use 95% of estimated bandwidth (was implicit 0.8)
                abrBandWidthUpFactor: 0.7, // Be more aggressive switching to higher quality
                startLevel: -1, // Auto-select best quality based on bandwidth
                // Loader settings - faster network usage
                fragLoadingTimeOut: 20000, // 20s timeout for fragments
                fragLoadingMaxRetry: 6,
                manifestLoadingTimeOut: 10000,
                levelLoadingTimeOut: 10000,
            });

            hls.loadSource(src);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
                
                // Apply video codec preference if set
                if (config.videoCodec !== 'auto' && data.levels.length > 1) {
                    const preferredCodec = config.videoCodec;
                    
                    // Map codec setting to actual codec identifiers
                    const codecMap: { [key: string]: string[] } = {
                        'h264': ['avc1', 'avc', 'h264'],
                        'h265': ['hev1', 'hvc1', 'hevc', 'h265'],
                        'vp9': ['vp09', 'vp9']
                    };

                    const targetCodecs = codecMap[preferredCodec] || [];

                    // Find levels matching the preferred codec
                    const matchingLevelIndices: number[] = [];
                    data.levels.forEach((level, index) => {
                        const levelCodecs = (level.codecSet || level.videoCodec || '').toLowerCase();
                        if (targetCodecs.some(c => levelCodecs.includes(c))) {
                            matchingLevelIndices.push(index);
                                                    }
                    });

                    if (matchingLevelIndices.length > 0) {
                        // Restrict HLS to only use matching levels
                        // Start with highest quality matching level
                        const bestMatch = matchingLevelIndices[matchingLevelIndices.length - 1];
                        hls.currentLevel = bestMatch;
                                            } else {
                                            }
                }
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
                        video.src = src;
        } else {
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
