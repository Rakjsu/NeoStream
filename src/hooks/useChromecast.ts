import { useState, useEffect, useRef, useCallback } from 'react';

// Extend Window interface for Chromecast
declare global {
    interface Window {
        __onGCastApiAvailable?: (isAvailable: boolean, reason?: string) => void;
    }
}

export interface CastDevice {
    friendlyName: string;
    capabilities: string[];
}

interface CastError {
    code?: string;
    description?: string;
    details?: unknown;
}

interface CastMediaSession {
    pause: (request: CastPauseRequest, success: () => void, error: (error: CastError) => void) => void;
    play: (request: CastPlayRequest, success: () => void, error: (error: CastError) => void) => void;
    seek: (request: CastSeekRequest, success: () => void, error: (error: CastError) => void) => void;
}

interface CastSession {
    media?: CastMediaSession[];
    addUpdateListener: (listener: (isAlive: boolean) => void) => void;
    loadMedia: (request: CastLoadRequest) => Promise<void>;
    stop: (success: () => void, error: (error: CastError) => void) => void;
}

interface CastMediaInfo {
    metadata?: CastGenericMediaMetadata;
}

interface CastGenericMediaMetadata {
    title?: string;
    subtitle?: string;
}

interface CastLoadRequest {
    autoplay?: boolean;
    currentTime?: number;
}

interface CastSeekRequest {
    currentTime?: number;
}

type CastPauseRequest = object;
type CastPlayRequest = object;

type CastApiConfig = object;

interface CastApi {
    media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        MediaInfo: new (contentId: string, contentType: string) => CastMediaInfo;
        GenericMediaMetadata: new () => CastGenericMediaMetadata;
        LoadRequest: new (mediaInfo: CastMediaInfo) => CastLoadRequest;
        PauseRequest: new () => CastPauseRequest;
        PlayRequest: new () => CastPlayRequest;
        SeekRequest: new () => CastSeekRequest;
    };
    SessionRequest: new (applicationId: string) => object;
    ApiConfig: new (
        sessionRequest: object,
        sessionListener: (session: CastSession) => void,
        receiverListener: (availability: string) => void
    ) => CastApiConfig;
    initialize: (
        config: CastApiConfig,
        success: () => void,
        error: (error: CastError) => void
    ) => void;
    requestSession: (
        success: (session: CastSession) => void,
        error: (error: CastError) => void
    ) => void;
}

interface ChromeCastWindow {
    cast?: CastApi;
}

function getCastApi(): CastApi | undefined {
    return (window.chrome as unknown as ChromeCastWindow | undefined)?.cast;
}

export function useChromecast(videoUrl: string, videoTitle: string) {
    const [isAvailable, setIsAvailable] = useState(false);
    const [isCasting, setIsCasting] = useState(false);
    const sessionRef = useRef<CastSession | null>(null);
    const [currentTime, setCurrentTime] = useState(0);

    const onInitSuccess = useCallback(() => {
        setIsAvailable(true);
    }, []);

    const onInitError = useCallback((error: CastError) => {
        console.error('Cast API initialization error:', error);
        setIsAvailable(false);
    }, []);

    const receiverListener = useCallback((availability: string) => {
        setIsAvailable(availability === 'available');
    }, []);

    const loadMedia = useCallback((session: CastSession) => {
        const cast = getCastApi();
        if (!session || !videoUrl || !cast) return;

        const mediaInfo = new cast.media.MediaInfo(videoUrl, 'video/mp4');
        mediaInfo.metadata = new cast.media.GenericMediaMetadata();
        mediaInfo.metadata.title = videoTitle;
        mediaInfo.metadata.subtitle = 'NeoStream IPTV';

        const request = new cast.media.LoadRequest(mediaInfo);
        request.autoplay = true;
        request.currentTime = currentTime;

        session.loadMedia(request).then(
            () => undefined,
            (error: CastError) => {
                console.error('Media load error:', error);
            }
        );
    }, [currentTime, videoTitle, videoUrl]);

    const sessionListener = useCallback((session: CastSession) => {
        sessionRef.current = session;
        setIsCasting(true);

        session.addUpdateListener((isAlive: boolean) => {
            if (!isAlive) {
                setIsCasting(false);
                sessionRef.current = null;
            }
        });

        if (videoUrl) {
            loadMedia(session);
        }
    }, [loadMedia, videoUrl]);

    const initializeCastApi = useCallback(() => {
        const cast = getCastApi();
        if (!cast) return;

        const applicationID = cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
        const sessionRequest = new cast.SessionRequest(applicationID);
        const apiConfig = new cast.ApiConfig(
            sessionRequest,
            sessionListener,
            receiverListener
        );

        cast.initialize(apiConfig, onInitSuccess, onInitError);
    }, [onInitError, onInitSuccess, receiverListener, sessionListener]);

    // Load Google Cast SDK
    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
        script.async = true;
        document.body.appendChild(script);

        window.__onGCastApiAvailable = (available) => {
            if (available) {
                initializeCastApi();
            }
        };

        return () => {
            delete window.__onGCastApiAvailable;
            script.remove();
        };
    }, [initializeCastApi]);

    const startCasting = () => {
        if (!isAvailable) {
            alert('Chromecast não disponível. Certifique-se de que há dispositivos na rede.');
            return;
        }

        const cast = getCastApi();
        if (!cast) return;

        cast.requestSession(
            (session: CastSession) => {
                sessionListener(session);
            },
            (error: CastError) => {
                console.error('Request session error:', error);
            }
        );
    };

    const stopCasting = () => {
        if (sessionRef.current) {
            sessionRef.current.stop(
                () => {
                    setIsCasting(false);
                    sessionRef.current = null;
                },
                (error: CastError) => {
                    console.error('Stop error:', error);
                }
            );
        }
    };

    const pauseCast = () => {
        const currentSession = sessionRef.current;
        const cast = getCastApi();
        if (currentSession && currentSession.media && currentSession.media.length > 0 && cast) {
            currentSession.media[0].pause(
                new cast.media.PauseRequest(),
                () => undefined,
                (error: CastError) => console.error('Pause error:', error)
            );
        }
    };

    const playCast = () => {
        const currentSession = sessionRef.current;
        const cast = getCastApi();
        if (currentSession && currentSession.media && currentSession.media.length > 0 && cast) {
            currentSession.media[0].play(
                new cast.media.PlayRequest(),
                () => undefined,
                (error: CastError) => console.error('Play error:', error)
            );
        }
    };

    const seekCast = (time: number) => {
        const currentSession = sessionRef.current;
        const cast = getCastApi();
        if (currentSession && currentSession.media && currentSession.media.length > 0 && cast) {
            const request = new cast.media.SeekRequest();
            request.currentTime = time;
            currentSession.media[0].seek(
                request,
                () => undefined,
                (error: CastError) => console.error('Seek error:', error)
            );
        }
    };

    return {
        isAvailable,
        isCasting,
        startCasting,
        stopCasting,
        pauseCast,
        playCast,
        seekCast,
        setCurrentTime
    };
}
