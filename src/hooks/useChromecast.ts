import { useState, useEffect, useRef } from 'react';

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

export function useChromecast(videoUrl: string, videoTitle: string) {
    const [isAvailable, setIsAvailable] = useState(false);
    const [isCasting, setIsCasting] = useState(false);
    const sessionRef = useRef<any>(null);
    const [currentTime, setCurrentTime] = useState(0);

    // Load Google Cast SDK
    useEffect(() => {
        // Add Google Cast SDK script
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
            document.body.removeChild(script);
        };
    }, []);

    const initializeCastApi = () => {
        const cast = window.chrome?.cast;
        if (!cast) return;

        const applicationID = cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
        const sessionRequest = new cast.SessionRequest(applicationID);
        const apiConfig = new cast.ApiConfig(
            sessionRequest,
            sessionListener,
            receiverListener
        );

        cast.initialize(apiConfig, onInitSuccess, onInitError);
    };

    const onInitSuccess = () => {
                setIsAvailable(true);
    };

    const onInitError = (error: any) => {
        console.error('❌ Cast API initialization error:', error);
        setIsAvailable(false);
    };

    const sessionListener = (session: any) => {
                sessionRef.current = session;
        setIsCasting(true);

        session.addUpdateListener((isAlive: boolean) => {
            if (!isAlive) {
                setIsCasting(false);
                sessionRef.current = null;
            }
        });

        // Load media if session is active
        if (session && videoUrl) {
            loadMedia(session);
        }
    };

    const receiverListener = (availability: string) => {
                setIsAvailable(availability === 'available');
    };

    const loadMedia = (session: any) => {
        if (!session || !videoUrl) return;

        const mediaInfo = new window.chrome.cast.media.MediaInfo(videoUrl, 'video/mp4');
        mediaInfo.metadata = new window.chrome.cast.media.GenericMediaMetadata();
        mediaInfo.metadata.title = videoTitle;
        mediaInfo.metadata.subtitle = 'NeoStream IPTV';

        const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
        request.autoplay = true;
        request.currentTime = currentTime;

        session.loadMedia(request).then(
            () => {
                            },
            (error: any) => {
                console.error('❌ Media load error:', error);
            }
        );
    };

    const startCasting = () => {
        if (!isAvailable) {
            alert('Chromecast não disponível. Certifique-se de que há dispositivos na rede.');
            return;
        }

        const cast = window.chrome?.cast;
        if (!cast) return;

        cast.requestSession(
            (session: any) => {
                sessionListener(session);
            },
            (error: any) => {
                console.error('❌ Request session error:', error);
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
                (error: any) => {
                    console.error('❌ Stop error:', error);
                }
            );
        }
    };

    const pauseCast = () => {
        const currentSession = sessionRef.current;
        if (currentSession && currentSession.media && currentSession.media.length > 0) {
            currentSession.media[0].pause(
                new window.chrome.cast.media.PauseRequest(),
                () =>         }
    };

    const playCast = () => {
        const currentSession = sessionRef.current;
        if (currentSession && currentSession.media && currentSession.media.length > 0) {
            currentSession.media[0].play(
                new window.chrome.cast.media.PlayRequest(),
                () =>         }
    };

    const seekCast = (time: number) => {
        const currentSession = sessionRef.current;
        if (currentSession && currentSession.media && currentSession.media.length > 0) {
            const request = new window.chrome.cast.media.SeekRequest();
            request.currentTime = time;
            currentSession.media[0].seek(
                request,
                () =>         }
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
