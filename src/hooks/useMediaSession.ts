import { useEffect } from 'react';
import type { RefObject } from 'react';

export interface MediaSessionInfo {
    title?: string;
    poster?: string;
    contentType?: 'movie' | 'series' | 'live';
    seasonNumber?: number;
    episodeNumber?: number;
}

/**
 * Builds the MediaMetadata init payload shown by the OS media overlay
 * (Windows SMTC / macOS Now Playing). Pure so it can be unit-tested.
 */
export function buildMediaSessionMetadata(info: MediaSessionInfo): MediaMetadataInit {
    const { title, poster, contentType, seasonNumber, episodeNumber } = info;

    let displayTitle = title || 'NeoStream';
    if (contentType === 'series' && seasonNumber && episodeNumber) {
        displayTitle = `${displayTitle} — T${seasonNumber}E${episodeNumber}`;
    }

    return {
        title: displayTitle,
        artist: contentType === 'live' ? 'TV ao vivo · NeoStream' : 'NeoStream',
        artwork: poster && poster.startsWith('http')
            ? [{ src: poster, sizes: '512x512', type: 'image/jpeg' }]
            : []
    };
}

interface UseMediaSessionOptions extends MediaSessionInfo {
    videoRef: RefObject<HTMLVideoElement | null>;
    playing: boolean;
    onNext?: () => void;
    onPrevious?: () => void;
    canGoNext?: boolean;
    canGoPrevious?: boolean;
}

const SEEK_STEP = 10; // seconds, matches the on-screen ±10s buttons

/**
 * Wires the internal <video> player into navigator.mediaSession so hardware
 * media keys and the Windows media overlay (SMTC) control playback:
 * metadata (title/artwork), play/pause, ±10s seek, absolute seek and
 * next/previous episode. Live streams only expose play/pause + zapping.
 */
export function useMediaSession(options: UseMediaSessionOptions): void {
    const {
        videoRef, playing, title, poster, contentType,
        seasonNumber, episodeNumber, onNext, onPrevious, canGoNext, canGoPrevious
    } = options;

    const isLive = contentType === 'live';

    // Metadata (title / artwork shown in the OS overlay)
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.metadata = new MediaMetadata(
            buildMediaSessionMetadata({ title, poster, contentType, seasonNumber, episodeNumber })
        );
        return () => {
            navigator.mediaSession.metadata = null;
        };
    }, [title, poster, contentType, seasonNumber, episodeNumber]);

    // Playback state keeps the OS play/pause glyph in sync
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
        return () => {
            navigator.mediaSession.playbackState = 'none';
        };
    }, [playing]);

    // Action handlers (media keys / overlay buttons)
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        const session = navigator.mediaSession;

        const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
            try {
                session.setActionHandler(action, handler);
            } catch {
                // Action not supported by this Chromium build — ignore.
            }
        };

        setHandler('play', () => { void videoRef.current?.play(); });
        setHandler('pause', () => { videoRef.current?.pause(); });

        if (!isLive) {
            setHandler('seekbackward', (details) => {
                const video = videoRef.current;
                if (!video) return;
                video.currentTime = Math.max(0, video.currentTime - (details.seekOffset || SEEK_STEP));
            });
            setHandler('seekforward', (details) => {
                const video = videoRef.current;
                if (!video) return;
                video.currentTime = Math.min(video.duration || Infinity, video.currentTime + (details.seekOffset || SEEK_STEP));
            });
            setHandler('seekto', (details) => {
                const video = videoRef.current;
                if (!video || details.seekTime == null) return;
                video.currentTime = details.seekTime;
            });
        } else {
            setHandler('seekbackward', null);
            setHandler('seekforward', null);
            setHandler('seekto', null);
        }

        setHandler('nexttrack', onNext && canGoNext !== false ? () => onNext() : null);
        setHandler('previoustrack', onPrevious && canGoPrevious !== false ? () => onPrevious() : null);

        return () => {
            (['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack', 'previoustrack'] as MediaSessionAction[])
                .forEach((action) => setHandler(action, null));
        };
    }, [videoRef, isLive, onNext, onPrevious, canGoNext, canGoPrevious]);

    // Position state feeds the OS progress bar (VOD/series only)
    useEffect(() => {
        if (!('mediaSession' in navigator) || isLive) return;
        const video = videoRef.current;
        if (!video) return;

        const updatePosition = () => {
            if (!Number.isFinite(video.duration) || video.duration <= 0) return;
            try {
                navigator.mediaSession.setPositionState({
                    duration: video.duration,
                    playbackRate: video.playbackRate,
                    position: Math.min(video.currentTime, video.duration)
                });
            } catch {
                // Invalid transient state (e.g. mid-source-swap) — ignore.
            }
        };

        video.addEventListener('loadedmetadata', updatePosition);
        video.addEventListener('seeked', updatePosition);
        video.addEventListener('ratechange', updatePosition);
        // Throttled progress tick: SMTC only needs coarse updates.
        const interval = window.setInterval(updatePosition, 5000);
        updatePosition();

        return () => {
            video.removeEventListener('loadedmetadata', updatePosition);
            video.removeEventListener('seeked', updatePosition);
            video.removeEventListener('ratechange', updatePosition);
            window.clearInterval(interval);
            try {
                navigator.mediaSession.setPositionState();
            } catch {
                // ignore
            }
        };
    }, [videoRef, isLive]);
}
