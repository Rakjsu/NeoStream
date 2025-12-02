import { useState, useEffect } from 'react';
import { VideoPlayer } from './VideoPlayer/VideoPlayer';
import { watchProgressService } from '../services/watchProgressService';

interface AsyncVideoPlayerProps {
    movie: any;
    buildStreamUrl: (movie: any) => Promise<string>;
    onClose: () => void;
    onNextEpisode?: () => void;
    onPreviousEpisode?: () => void;
    canGoNext?: boolean;
    canGoPrevious?: boolean;
    currentEpisode?: number;
    customTitle?: string;
    // For video resume tracking
    seriesId?: string;
    seasonNumber?: number;
    episodeNumber?: number;
}

function AsyncVideoPlayer({
    movie,
    buildStreamUrl,
    onClose,
    onNextEpisode,
    onPreviousEpisode,
    canGoNext,
    canGoPrevious,
    currentEpisode,
    customTitle,
    seriesId,
    seasonNumber,
    episodeNumber
}: AsyncVideoPlayerProps) {
    const [streamUrl, setStreamUrl] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [isAnimating, setIsAnimating] = useState(true);
    const [resumeTime, setResumeTime] = useState<number | null>(null);

    useEffect(() => {
        setLoading(true);
        buildStreamUrl(movie)
            .then(url => {
                setStreamUrl(url);
                setLoading(false);

                // Load saved video time for resume
                if (seriesId && seasonNumber !== undefined && episodeNumber !== undefined) {
                    const savedTime = watchProgressService.getVideoTime(
                        seriesId,
                        seasonNumber,
                        episodeNumber
                    );
                    console.log(`[AsyncVideoPlayer] Loaded resume time for S${seasonNumber}E${episodeNumber}:`, savedTime);
                    if (savedTime) {
                        setResumeTime(savedTime);
                    } else {
                        setResumeTime(null);
                    }
                }
            })
            .catch((error) => {
                console.error('Error building stream URL:', error);
                setLoading(false);
            });
    }, [movie, buildStreamUrl, currentEpisode, seriesId, seasonNumber, episodeNumber]);

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
                        title={customTitle || movie.name}
                        poster={movie.cover || movie.stream_icon}
                        onClose={onClose}
                        autoPlay={true}
                        onNextEpisode={onNextEpisode}
                        onPreviousEpisode={onPreviousEpisode}
                        canGoNext={canGoNext}
                        canGoPrevious={canGoPrevious}
                        resumeTime={resumeTime}
                        onTimeUpdate={(currentTime, duration) => {
                            // Save video progress every 5 seconds
                            if (seriesId && seasonNumber !== undefined && episodeNumber !== undefined && currentTime % 5 < 0.5) {
                                watchProgressService.saveVideoTime(
                                    seriesId,
                                    seasonNumber,
                                    episodeNumber,
                                    currentTime,
                                    duration
                                );
                            }
                        }}
                    />
                </div>
            </div>
        </>
    );
}

export default AsyncVideoPlayer;
