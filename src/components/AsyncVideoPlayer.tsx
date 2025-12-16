import { useState, useEffect, useRef } from 'react';
import { VideoPlayer } from './VideoPlayer/VideoPlayer';
import { watchProgressService } from '../services/watchProgressService';
import { movieProgressService } from '../services/movieProgressService';
import { findMovieVersions, type MovieVersion } from '../services/movieVersionService';

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
    // For movie progress tracking
    resumeTime?: number | null;
    onTimeUpdate?: (currentTime: number, duration: number) => void;
    // For PiP expand functionality
    contentId?: string;
    contentType?: 'movie' | 'series' | 'live';
    // For movie version switching
    allMovies?: any[];
    onSwitchVersion?: (movie: any, currentTime: number) => void;
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
    episodeNumber,
    resumeTime: externalResumeTime,
    onTimeUpdate: externalOnTimeUpdate,
    contentId,
    contentType,
    allMovies,
    onSwitchVersion
}: AsyncVideoPlayerProps) {
    const [streamUrl, setStreamUrl] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(true);
    const [resumeTime, setResumeTime] = useState<number | null>(null);
    const urlLoadedRef = useRef(false);
    const lastMovieIdRef = useRef<number | null>(null);
    const lastEpisodeRef = useRef<string | null>(null);

    // Effect 1: Load stream URL (only triggers on movie/episode changes, NOT resumeTime)
    useEffect(() => {
        // Create a unique key for current content (movie ID + episode info for series)
        const currentMovieId = movie.stream_id || movie.id;
        const currentEpisodeKey = seriesId ? `${seriesId}-S${seasonNumber}-E${episodeNumber}` : null;

        // Reset urlLoadedRef if movie changed (for version switching)
        if (lastMovieIdRef.current !== null && lastMovieIdRef.current !== currentMovieId) {
            console.log('[AsyncVideoPlayer] Movie ID changed, resetting URL loader');
            urlLoadedRef.current = false;
        }
        lastMovieIdRef.current = currentMovieId;

        // Reset urlLoadedRef if episode changed (for series navigation)
        if (currentEpisodeKey && lastEpisodeRef.current !== null && lastEpisodeRef.current !== currentEpisodeKey) {
            console.log('[AsyncVideoPlayer] Episode changed, resetting URL loader:', currentEpisodeKey);
            urlLoadedRef.current = false;
        }
        lastEpisodeRef.current = currentEpisodeKey;

        // Skip if already loaded for same content
        if (urlLoadedRef.current && streamUrl) {
            return;
        }

        setLoading(true);
        setError(null);

        buildStreamUrl(movie)
            .then(url => {
                if (!url) {
                    setError('Não foi possível carregar o vídeo. URL inválida.');
                    setLoading(false);
                    return;
                }
                setStreamUrl(url);
                setLoading(false);
                urlLoadedRef.current = true;
            })
            .catch((err) => {
                console.error('Error building stream URL:', err);
                setError('Erro ao carregar o vídeo. Tente novamente.');
                setLoading(false);
            });
    }, [movie, buildStreamUrl, currentEpisode, seriesId, seasonNumber, episodeNumber]);

    // Effect 2: Set resume time (separate from URL loading to avoid remounting)
    useEffect(() => {
        if (!streamUrl || loading) return; // Wait for URL to load

        // Use external resume time if provided (from ResumeModal)
        if (externalResumeTime !== undefined && externalResumeTime !== null && externalResumeTime > 0) {
            setResumeTime(externalResumeTime);
        } else if (seriesId && seasonNumber !== undefined && episodeNumber !== undefined) {
            // Fall back to saved video time for resume
            const savedTime = watchProgressService.getVideoTime(
                seriesId,
                seasonNumber,
                episodeNumber
            );
            if (savedTime) {
                setResumeTime(savedTime);
            } else {
                setResumeTime(null);
            }
        } else if (externalResumeTime !== undefined) {
            // For movies with explicit resume time (even 0)
            setResumeTime(externalResumeTime);
        }
    }, [streamUrl, loading, externalResumeTime, seriesId, seasonNumber, episodeNumber]);

    // Disable animation after it completes
    useEffect(() => {
        const timer = setTimeout(() => setIsAnimating(false), 800);
        return () => clearTimeout(timer);
    }, []);

    const playerStyles = `
        @keyframes playerBackdropReveal {
            from {
                opacity: 0;
            }
            to {
                opacity: 1;
            }
        }

        @keyframes playerContainerReveal {
            0% {
                transform: scale(0.3) rotateX(10deg);
                opacity: 0;
                filter: blur(20px);
            }
            50% {
                filter: blur(5px);
            }
            100% {
                transform: scale(1) rotateX(0);
                opacity: 1;
                filter: blur(0);
            }
        }

        @keyframes loadingPulse {
            0%, 100% { opacity: 0.5; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.05); }
        }

        @keyframes loadingDots {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
        }

        @keyframes loadingGlow {
            0%, 100% { box-shadow: 0 0 20px rgba(168, 85, 247, 0.3); }
            50% { box-shadow: 0 0 40px rgba(168, 85, 247, 0.6), 0 0 60px rgba(236, 72, 153, 0.3); }
        }

        .player-backdrop {
            position: fixed;
            inset: 0;
            z-index: 99999;
            background: radial-gradient(ellipse at center, rgba(15, 15, 26, 0.98) 0%, rgba(0, 0, 0, 0.99) 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            animation: playerBackdropReveal 0.4s ease-out;
        }

        .player-container {
            width: 100vw;
            height: 100vh;
            max-width: 100vw;
            background: #000;
            border-radius: 0;
            overflow: hidden;
            animation: ${isAnimating ? 'playerContainerReveal 0.8s cubic-bezier(0.16, 1, 0.3, 1)' : 'none'};
        }

        .loading-screen {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 24px;
            animation: loadingPulse 2s ease-in-out infinite;
        }

        .loading-icon {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2));
            display: flex;
            align-items: center;
            justify-content: center;
            animation: loadingGlow 2s ease-in-out infinite;
        }

        .loading-icon span {
            font-size: 36px;
        }

        .loading-dots {
            display: flex;
            gap: 8px;
        }

        .loading-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: linear-gradient(135deg, #a855f7, #ec4899);
            animation: loadingDots 1.4s ease-in-out infinite;
        }

        .loading-dot:nth-child(1) { animation-delay: -0.32s; }
        .loading-dot:nth-child(2) { animation-delay: -0.16s; }
        .loading-dot:nth-child(3) { animation-delay: 0s; }

        .loading-text {
            color: rgba(255, 255, 255, 0.8);
            font-size: 16px;
            font-weight: 500;
        }

        .loading-close-btn {
            position: absolute;
            top: 24px;
            right: 24px;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            font-size: 20px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }

        .loading-close-btn:hover {
            background: rgba(239, 68, 68, 0.3);
            border-color: rgba(239, 68, 68, 0.5);
        }

        .error-screen {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
            color: white;
        }

        .error-icon {
            font-size: 48px;
        }

        .error-message {
            font-size: 16px;
            color: rgba(255, 255, 255, 0.7);
            text-align: center;
            max-width: 300px;
        }

        .error-btn {
            padding: 12px 24px;
            background: linear-gradient(135deg, #a855f7, #ec4899);
            border: none;
            border-radius: 8px;
            color: white;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .error-btn:hover {
            transform: scale(1.05);
        }
    `;

    if (error) {
        return (
            <>
                <style>{playerStyles}</style>
                <div className="player-backdrop">
                    <button className="loading-close-btn" onClick={onClose}>✕</button>
                    <div className="error-screen">
                        <div className="error-icon">⚠️</div>
                        <p className="error-message">{error}</p>
                        <button className="error-btn" onClick={onClose}>Fechar</button>
                    </div>
                </div>
            </>
        );
    }

    if (loading || !streamUrl) {
        return (
            <>
                <style>{playerStyles}</style>
                <div className="player-backdrop">
                    <button className="loading-close-btn" onClick={onClose}>✕</button>
                    <div className="loading-screen">
                        <div className="loading-icon">
                            <span>🎬</span>
                        </div>
                        <div className="loading-dots">
                            <div className="loading-dot"></div>
                            <div className="loading-dot"></div>
                            <div className="loading-dot"></div>
                        </div>
                        <span className="loading-text">Preparando seu vídeo...</span>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <style>{playerStyles}</style>
            <div className="player-backdrop">
                <div className="player-container">
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
                        contentId={contentId || seriesId || (movie.stream_id?.toString() || movie.id?.toString())}
                        contentType={contentType || (seriesId ? 'series' : 'movie')}
                        seasonNumber={seasonNumber}
                        episodeNumber={episodeNumber}
                        movieVersions={allMovies && !seriesId ? findMovieVersions(movie, allMovies) : undefined}
                        currentMovieId={movie.stream_id}
                        onSwitchVersion={onSwitchVersion}
                        onTimeUpdate={(currentTime, duration) => {
                            // Call external onTimeUpdate if provided
                            if (externalOnTimeUpdate) {
                                externalOnTimeUpdate(currentTime, duration);
                            }

                            // Save video progress for series every 5 seconds
                            if (seriesId && seasonNumber !== undefined && episodeNumber !== undefined && currentTime % 5 < 0.5) {
                                watchProgressService.saveVideoTime(
                                    seriesId,
                                    seasonNumber,
                                    episodeNumber,
                                    currentTime,
                                    duration
                                );
                            }

                            // Save movie progress every 5 seconds (if not a series)
                            if (!seriesId && movie && currentTime % 5 < 0.5 && duration > 0) {
                                const movieId = movie.stream_id || movie.id || movie.series_id;
                                const movieName = movie.name || movie.title || 'Unknown';
                                if (movieId) {
                                    movieProgressService.saveMovieTime(
                                        String(movieId),
                                        movieName,
                                        currentTime,
                                        duration
                                    );
                                }
                            }
                        }}
                    />
                </div>
            </div>
        </>
    );
}

export default AsyncVideoPlayer;

