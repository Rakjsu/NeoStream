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

export function useVideoPlayer() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [state, setState] = useState<VideoPlayerState>({
        playing: false,
        currentTime: 0,
        duration: 0,
        volume: 1,
        muted: false,
        buffered: 0,
        error: null,
        loading: true,
        fullscreen: false,
        playbackRate: 1
    });

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
                (document as any).webkitFullscreenElement ||
                (document as any).mozFullScreenElement ||
                (document as any).msFullscreenElement
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
                console.log('🔄 FS State:', isFullscreen);

                setState(prev => {
                    if (prev.fullscreen !== isFullscreen) {
                        console.log(`✅ ${prev.fullscreen} → ${isFullscreen}`);
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
    }, []);

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!videoRef.current) return;

            switch (e.key) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'f':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'm':
                    e.preventDefault();
                    toggleMute();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    seek(Math.max(0, state.currentTime - 5));
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    seek(Math.min(state.duration, state.currentTime + 5));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setVolume(state.volume + 0.05);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    setVolume(state.volume - 0.05);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [state.currentTime, state.duration, state.volume, togglePlay, toggleFullscreen, toggleMute, seek, setVolume]);

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
