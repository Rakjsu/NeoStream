import { useState, useEffect } from 'react';
import { VideoPlayer } from './VideoPlayer/VideoPlayer';

interface AsyncVideoPlayerProps {
    movie: any;
    buildStreamUrl: (movie: any) => Promise<string>;
    onClose: () => void;
    onNextEpisode?: () => void;
    onPreviousEpisode?: () => void;
    canGoNext?: boolean;
    canGoPrevious?: boolean;
    currentEpisode?: number;
}

function AsyncVideoPlayer({
    movie,
    buildStreamUrl,
    onClose,
    onNextEpisode,
    onPreviousEpisode,
    canGoNext,
    canGoPrevious,
    currentEpisode
}: AsyncVideoPlayerProps) {
    const [streamUrl, setStreamUrl] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [isAnimating, setIsAnimating] = useState(true);

    useEffect(() => {
        buildStreamUrl(movie)
            .then(url => {
                setStreamUrl(url);
                setLoading(false);
            })
            .catch((error) => {
                console.error('Error building stream URL:', error);
                setLoading(false);
            });
    }, [movie, buildStreamUrl]);

    // Disable animation after it completes
    useEffect(() => {
        const timer = setTimeout(() => setIsAnimating(false), 600);
        return () => clearTimeout(timer);
    }, []);

    const fullScreenStyle: React.CSSProperties = {
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    };

    const playerStyle: React.CSSProperties = {
        width: '100vw',
        height: '100vh',
        maxWidth: '100vw',
        background: '#000',
        borderRadius: '0',
        overflow: 'hidden',
        boxShadow: 'none',
        animation: isAnimating ? 'expandPlayer 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none'
    };

    if (loading || !streamUrl) {
        return (
            <div style={fullScreenStyle}>
                <div style={{ color: 'white', fontSize: '18px' }}>Carregando...</div>
            </div>
        );
    }

    return (
        <>
            <style>{`
                @keyframes expandPlayer {
                    from {
                        transform: scale(0.1);
                        opacity: 0;
                        border-radius: 8px;
                    }
                    to {
                        transform: scale(1);
                        opacity: 1;
                        border-radius: 0;
                    }
                }
            `}</style>
            <div style={fullScreenStyle}>
                <div style={playerStyle}>
                    <VideoPlayer
                        src={streamUrl}
                        title={movie.name}
                        poster={movie.cover || movie.stream_icon}
                        onClose={onClose}
                        autoPlay={true}
                        onNextEpisode={onNextEpisode}
                        onPreviousEpisode={onPreviousEpisode}
                        canGoNext={canGoNext}
                        canGoPrevious={canGoPrevious}
                    />
                </div>
            </div>
        </>
    );
}

export default AsyncVideoPlayer;
