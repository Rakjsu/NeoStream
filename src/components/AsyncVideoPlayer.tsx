import { useState, useEffect, useMemo, useRef } from 'react';
import { VideoPlayer } from './VideoPlayer/VideoPlayer';
import { watchProgressService } from '../services/watchProgressService';
import { movieProgressService } from '../services/movieProgressService';
import { findMovieVersions } from '../services/movieVersionService';
import { playbackService } from '../services/playbackService';
import MpvPlayerView from './MpvPlayerView';

interface MediaItem {
    id?: number | string;
    stream_id?: number | string;
    series_id?: number | string;
    type?: string;
    season?: number;
    episode?: number;
    name?: string;
    title?: string;
    cover?: string;
    stream_icon?: string;
    tmdb_id?: string | number;
    tmdb?: string | number;
    tmdbId?: string | number;
    imdb_id?: string;
    imdb?: string;
    imdbId?: string;
}

interface LiveQualityVariant<TVersion extends MediaItem> {
    channel: TVersion;
    quality: string;
    priority: number;
    label: string;
}

interface AsyncVideoPlayerProps<TMovie extends MediaItem, TVersion extends MediaItem = TMovie> {
    movie: TMovie;
    buildStreamUrl: (movie: TMovie) => Promise<string>;
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
    allMovies?: TVersion[];
    onSwitchVersion?: (movie: TVersion, currentTime: number) => void;
    // For live TV quality switching
    liveQualityVariants?: LiveQualityVariant<TVersion>[];
    onSwitchQuality?: (channel: TVersion) => void;
    // Live TV zapping (channel list inside the player)
    channelList?: { id: string | number; name: string; logo?: string; num?: number }[];
    onSwitchChannel?: (id: string | number) => void;
    /** End-of-video countdown texts (movie queue). */
    nextCountdownLabel?: string;
    nextActionLabel?: string;
}

function AsyncVideoPlayer<TMovie extends MediaItem, TVersion extends MediaItem = TMovie>({
    movie,
    buildStreamUrl,
    onClose,
    onNextEpisode,
    onPreviousEpisode,
    canGoNext,
    canGoPrevious,
    nextCountdownLabel,
    nextActionLabel,
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
    onSwitchVersion,
    liveQualityVariants,
    onSwitchQuality,
    channelList,
    onSwitchChannel
}: AsyncVideoPlayerProps<TMovie, TVersion>) {
    const [streamUrl, setStreamUrl] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(true);
    const urlLoadedRef = useRef(false);
    const lastMovieIdRef = useRef<string | number | null>(null);
    const lastEpisodeRef = useRef<string | null>(null);

    // EXPERIMENTAL — MPV phase 2. When the toggle is on, live channels, movies
    // AND series episodes are handed to a pseudo-embedded MPV window with
    // in-app controls (MpvPlayerView) instead of the internal player.
    // Read once on mount so the choice is stable for this playback session.
    const [mpvRequested] = useState<boolean>(() => playbackService.getConfig().mpvEnabled);
    // Set when mpv turns out to be missing/broken — falls back to the internal player.
    const [mpvFailed, setMpvFailed] = useState(false);
    const useMpv = mpvRequested && !mpvFailed;

    // Effect 1: Load stream URL (only triggers on movie/episode changes, NOT resumeTime)
    useEffect(() => {
        // Create a unique key for current content (movie ID + episode info for series)
        const currentMovieId = movie.stream_id || movie.id || null;
        const currentEpisodeKey = seriesId ? `${seriesId}-S${seasonNumber}-E${episodeNumber}` : null;

        // Reset urlLoadedRef if movie changed (for version switching)
        if (lastMovieIdRef.current !== null && lastMovieIdRef.current !== currentMovieId) {
            urlLoadedRef.current = false;
        }
        lastMovieIdRef.current = currentMovieId;

        // Reset urlLoadedRef if episode changed (for series navigation)
        if (currentEpisodeKey && lastEpisodeRef.current !== null && lastEpisodeRef.current !== currentEpisodeKey) {
            urlLoadedRef.current = false;
        }
        lastEpisodeRef.current = currentEpisodeKey;

        // Skip if already loaded for this content. Uses the ref only (not the
        // streamUrl closure) so a re-run can never re-enter the load path once
        // the URL is in — re-entering would setLoading(true) and, under the
        // experimental MPV path, unmount MpvPlayerView right after it launched.
        if (urlLoadedRef.current) {
            return;
        }

        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;
            setLoading(true);
            setError(null);

            buildStreamUrl(movie)
                .then(url => {
                    if (cancelled) return;
                    if (!url) {
                        setError('Nao foi possivel carregar o video. URL invalida.');
                        setLoading(false);
                        return;
                    }
                    setStreamUrl(url);
                    setLoading(false);
                    urlLoadedRef.current = true;
                })
                .catch((err) => {
                    if (cancelled) return;
                    console.error('Error building stream URL:', err);
                    setError('Erro ao carregar o video. Tente novamente.');
                    setLoading(false);
                });
        });

        return () => {
            cancelled = true;
        };
        // Re-run only when the CONTENT changes (movie/episode), not when the
        // parent re-creates buildStreamUrl or when streamUrl is set — those
        // caused the effect to churn (cancel + restart the load) on every
        // parent render. buildStreamUrl is intentionally omitted.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [movie, currentEpisode, seriesId, seasonNumber, episodeNumber]);

    const resumeTime = useMemo(() => {
        if (!streamUrl || loading) return null;

        if (externalResumeTime !== undefined && externalResumeTime !== null && externalResumeTime > 0) {
            return externalResumeTime;
        }

        if (seriesId && seasonNumber !== undefined && episodeNumber !== undefined) {
            return watchProgressService.getVideoTime(seriesId, seasonNumber, episodeNumber) || null;
        }

        if (externalResumeTime !== undefined) {
            return externalResumeTime;
        }

        return null;
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
            0%, 100% { box-shadow: 0 0 20px rgba(var(--ns-accent-rgb), 0.3); }
            50% { box-shadow: 0 0 40px rgba(var(--ns-accent-rgb), 0.6), 0 0 60px rgba(var(--ns-accent-grad-to-rgb), 0.3); }
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
            background: linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.2), rgba(var(--ns-accent-grad-to-rgb), 0.2));
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
            background: linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to));
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
            background: linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to));
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

    // EXPERIMENTAL — MPV phase 2: hand the stream to the pseudo-embedded MPV
    // window and render the in-app controls bar instead of the internal player.
    if (useMpv) {
        const mpvIsSeries = Boolean(seriesId) && seasonNumber !== undefined && episodeNumber !== undefined;
        const mpvMovieId = movie.stream_id || movie.id || movie.series_id;
        return (
            <MpvPlayerView
                streamUrl={streamUrl}
                title={customTitle || movie.name || movie.title || 'NeoStream'}
                startSeconds={resumeTime}
                movieId={contentType !== 'live' && !mpvIsSeries && mpvMovieId ? String(mpvMovieId) : undefined}
                movieName={movie.name || movie.title}
                seriesId={mpvIsSeries ? seriesId : undefined}
                seasonNumber={mpvIsSeries ? seasonNumber : undefined}
                episodeNumber={mpvIsSeries ? episodeNumber : undefined}
                isLive={contentType === 'live'}
                onClose={onClose}
                onFallback={() => setMpvFailed(true)}
            />
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
                        nextCountdownLabel={nextCountdownLabel}
                        nextActionLabel={nextActionLabel}
                        onPreviousEpisode={onPreviousEpisode}
                        canGoNext={canGoNext}
                        canGoPrevious={canGoPrevious}
                        resumeTime={resumeTime}
                        contentId={contentId || seriesId || (movie.stream_id?.toString() || movie.id?.toString())}
                        contentType={contentType || (seriesId ? 'series' : 'movie')}
                        seasonNumber={seasonNumber}
                        episodeNumber={episodeNumber}
                        movieVersions={
                            // For live TV, convert quality variants to MovieVersion format
                            liveQualityVariants && liveQualityVariants.length > 0
                                ? liveQualityVariants.map(v => ({
                                    movie: v.channel,
                                    quality: v.quality.toLowerCase().includes('4k') || v.quality.toLowerCase().includes('uhd') ? '4k' : '1080p',
                                    audio: 'dubbed' as const,
                                    label: v.label
                                }))
                                : allMovies && !seriesId ? findMovieVersions(movie as unknown as TVersion, allMovies) : undefined
                        }
                        currentMovieId={Number(movie.stream_id || movie.id)}
                        onSwitchVersion={contentType === 'live' && onSwitchQuality
                            ? (channel: TVersion) => onSwitchQuality(channel)
                            : onSwitchVersion
                        }
                        tmdbId={movie.tmdb_id || movie.tmdb || movie.tmdbId}
                        imdbId={movie.imdb_id || movie.imdb || movie.imdbId}
                        isSubtitled={/\[L\]/i.test(movie.name || customTitle || '')}
                        liveQualityVariants={liveQualityVariants}
                        currentQualityIndex={liveQualityVariants ? liveQualityVariants.findIndex(v => v.channel.stream_id === movie.stream_id) : 0}
                        channelList={channelList}
                        onSwitchChannel={onSwitchChannel}
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
