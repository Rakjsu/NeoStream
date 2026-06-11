import { useEffect, useRef, useState, useCallback } from 'react';

export interface VideoPlayerState {
    playing: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    muted: boolean;
    buffered: number;
    error: string | null;
    loading: boolean;
    fullscreen: boolean;
    playbackRate: number;
}

// Helper to get saved volume from localStorage
const getSavedVolume = (): number => {
    try {
        const saved = localStorage.getItem('playerVolume');
        if (saved !== null) {
            const vol = parseFloat(saved);
            return isNaN(vol) ? 1 : Math.max(0, Math.min(1, vol));
        }
    } catch {
        return 1;
    }
    return 1;
};

export function useVideoPlayer() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [state, setState] = useState<VideoPlayerState>(() => ({
        playing: false,
        currentTime: 0,
        duration: 0,
        volume: getSavedVolume(),
        muted: false,
        buffered: 0,
        error: null,
        loading: true,
        fullscreen: false,
        playbackRate: 1
    }));

    // Play/Pause
    const togglePlay = useCallback(() => {
        if (!videoRef.current) return;
        if (state.playing) {
            videoRef.current.pause();
        } else {
            videoRef.current.play();
        }
    }, [state.playing]);

    // Seek
    const seek = useCallback((time: number) => {
        if (!videoRef.current) return;
        videoRef.current.currentTime = time;
    }, []);

    // Volume
    const setVolume = useCallback((volume: number) => {
        if (!videoRef.current) return;
        const clampedVolume = Math.max(0, Math.min(1, volume));
        videoRef.current.volume = clampedVolume;
        setState(prev => ({ ...prev, volume: clampedVolume }));
        // Save volume to localStorage
        try {
            localStorage.setItem('playerVolume', clampedVolume.toString());
        } catch {
            // Ignore storage write failures, e.g. private mode or blocked storage.
        }
    }, []);

    // Mute
    const toggleMute = useCallback(() => {
        if (!videoRef.current) return;
        videoRef.current.muted = !videoRef.current.muted;
        setState(prev => ({ ...prev, muted: !prev.muted }));
    }, []);

    // Fullscreen
    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            videoRef.current?.parentElement?.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }, []);

    // Playback Rate
    const setPlaybackRate = useCallback((rate: number) => {
        if (!videoRef.current) return;
        videoRef.current.playbackRate = rate;
        setState(prev => ({ ...prev, playbackRate: rate }));
    }, []);

    // Event Handlers
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Initialize video element with saved volume
        video.volume = state.volume;

        const handlePlay = () => setState(prev => ({ ...prev, playing: true }));
        const handlePause = () => setState(prev => ({ ...prev, playing: false }));
        const handleTimeUpdate = () => setState(prev => ({ ...prev, currentTime: video.currentTime }));
        const handleDurationChange = () => setState(prev => ({ ...prev, duration: video.duration, loading: false }));
        const handleVolumeChange = () => setState(prev => ({ ...prev, volume: video.volume, muted: video.muted }));
        const handleWaiting = () => setState(prev => ({ ...prev, loading: true }));
        const handleCanPlay = () => setState(prev => ({ ...prev, loading: false }));
        const handleError = () => setState(prev => ({ ...prev, error: 'Erro ao carregar vídeo', loading: false }));
        const handleProgress = () => {
            if (video.buffered.length > 0) {
                const buffered = video.buffered.end(video.buffered.length - 1);
                setState(prev => ({ ...prev, buffered }));
            }
        };



        let fullscreenChangeTimeout: ReturnType<typeof setTimeout> | null = null;

        const isInFullscreen = (): boolean => {
            // Check multiple APIs for better compatibility
            return !!(
                document.fullscreenElement ||
                (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ||
                (document as Document & { mozFullScreenElement?: Element }).mozFullScreenElement ||
                (document as Document & { msFullscreenElement?: Element }).msFullscreenElement
            );
        };

        const handleFullscreenChange = () => {
            // Clear any pending timeout
            if (fullscreenChangeTimeout) {
                clearTimeout(fullscreenChangeTimeout);
            }

            // Debounce the state change
            fullscreenChangeTimeout = setTimeout(() => {
                const isFullscreen = isInFullscreen();
                
                setState(prev => {
                    if (prev.fullscreen !== isFullscreen) {
                                                return { ...prev, fullscreen: isFullscreen };
                    }
                    return prev;
                });
            }, 50);
        };

        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('durationchange', handleDurationChange);
        video.addEventListener('volumechange', handleVolumeChange);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('error', handleError);
        video.addEventListener('progress', handleProgress);

        // Use only standard fullscreenchange to prevent duplicate events
        document.addEventListener('fullscreenchange', handleFullscreenChange);

        return () => {
            if (fullscreenChangeTimeout) {
                clearTimeout(fullscreenChangeTimeout);
            }
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('durationchange', handleDurationChange);
            video.removeEventListener('volumechange', handleVolumeChange);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('error', handleError);
            video.removeEventListener('progress', handleProgress);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, [state.volume]);

    // Keyboard shortcuts are intentionally NOT registered here: each consumer
    // (VideoPlayer, PipWindow) owns a single document-level listener so the
    // same key never fires two competing handlers.

    return {
        videoRef,
        state,
        controls: {
            togglePlay,
            seek,
            setVolume,
            toggleMute,
            toggleFullscreen,
            setPlaybackRate
        }
    };
}
