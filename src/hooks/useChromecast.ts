import { useState, useEffect, useRef } from 'react';

declare global {
    interface Window {
        chrome?: any;
        __onGCastApiAvailable?: (isAvailable: boolean, reason?: string) => void;
    }
}

export interface CastDevice {
    friendlyName: string;
    capabilities: string[];
}

export function useChromecast(videoUrl: string, videoTitle: string) {
    const [isAvailable, setIsAvailable] = useState(false);
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
    console.log('✅ Cast API initialized');
    setIsAvailable(true);
};

const onInitError = (error: any) => {
    console.error('❌ Cast API initialization error:', error);
    setIsAvailable(false);
};

const sessionListener = (session: any) => {
    console.log('🔗 Session listener:', session);
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
    console.log('📡 Receiver availability:', availability);
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
            console.log('✅ Media loaded successfully');
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
                console.log('✅ Session stopped');
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
            () => console.log('⏸️ Paused'),
            (error: any) => console.error('❌ Pause error:', error)
        );
    }
};

const playCast = () => {
    const currentSession = sessionRef.current;
    if (currentSession && currentSession.media && currentSession.media.length > 0) {
        currentSession.media[0].play(
            new window.chrome.cast.media.PlayRequest(),
            () => console.log('▶️ Playing'),
            (error: any) => console.error('❌ Play error:', error)
        );
    }
};

const seekCast = (time: number) => {
    const currentSession = sessionRef.current;
    if (currentSession && currentSession.media && currentSession.media.length > 0) {
        const request = new window.chrome.cast.media.SeekRequest();
        request.currentTime = time;
        currentSession.media[0].seek(
            request,
            () => console.log('⏩ Seeked to', time),
            (error: any) => console.error('❌ Seek error:', error)
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
