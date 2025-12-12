import { useState, useEffect, useRef } from 'react';
import { searchSeriesByName, searchMovieByName, fetchMovieTrailer, fetchSeriesTrailer, type TMDBSeriesDetails, type TMDBMovieDetails } from '../services/tmdb';
import { watchProgressService } from '../services/watchProgressService';
import { movieProgressService } from '../services/movieProgressService';
import { watchLaterService } from '../services/watchLater';
import { favoritesService } from '../services/favoritesService';
import { downloadService } from '../services/downloadService';

interface ContentDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    contentId: string;
    contentType: 'series' | 'movie';
    contentData: {
        name: string;
        cover: string;
        rating?: string;
        plot?: string;
        genre?: string;
        cast?: string;
        director?: string;
        release_date?: string;
        container_extension?: string;
        youtube_trailer?: string;
    };
    onPlay: (season?: number, episode?: number, offlineUrl?: string) => void;
}

export function ContentDetailModal({
    isOpen,
    onClose,
    contentId,
    contentType,
    contentData,
    onPlay
}: ContentDetailModalProps) {
    const [seriesInfo, setSeriesInfo] = useState<any>(null);
    const [tmdbData, setTmdbData] = useState<TMDBSeriesDetails | TMDBMovieDetails | null>(null);
    const [selectedSeason, setSelectedSeason] = useState(1);
    const [selectedEpisode, setSelectedEpisode] = useState(1);
    const [loading, setLoading] = useState(false);
    const [, setRefresh] = useState(0); // Force re-render for button states
    const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'completed'>('idle');
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [showDownloadModal, setShowDownloadModal] = useState(false);
    const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
    const [showTrailerModal, setShowTrailerModal] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    // Fetch series info for episodes
    useEffect(() => {
        if (!isOpen || contentType !== 'series') return;

        setLoading(true);
        window.ipcRenderer.invoke('auth:get-credentials').then(result => {
            if (result.success) {
                const { url, username, password } = result.credentials;
                fetch(`${url}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${contentId}`)
                    .then(res => res.json())
                    .then(data => {
                        setSeriesInfo(data);

                        // Check for existing progress
                        const lastWatched = watchProgressService.getLastWatchedEpisode(contentId);
                        if (lastWatched) {
                            const episodeProgress = watchProgressService.getEpisodeProgress(
                                contentId,
                                lastWatched.season,
                                lastWatched.episode
                            );

                            // Check if the last watched episode is complete (>90% or completed flag)
                            const isComplete = episodeProgress && (
                                episodeProgress.completed ||
                                (episodeProgress.duration > 0 && episodeProgress.currentTime / episodeProgress.duration > 0.9)
                            );

                            if (isComplete) {
                                // Auto-advance to next episode
                                const seasons = Object.keys(data.episodes || {}).map(Number).sort((a, b) => a - b);
                                const currentSeasonIndex = seasons.indexOf(lastWatched.season);
                                const currentSeasonEpisodes = data.episodes?.[lastWatched.season] || [];
                                const totalEpisodesInSeason = currentSeasonEpisodes.length;

                                if (lastWatched.episode < totalEpisodesInSeason) {
                                    // Next episode in same season
                                    setSelectedSeason(lastWatched.season);
                                    setSelectedEpisode(lastWatched.episode + 1);
                                } else if (currentSeasonIndex < seasons.length - 1) {
                                    // First episode of next season
                                    const nextSeason = seasons[currentSeasonIndex + 1];
                                    setSelectedSeason(nextSeason);
                                    setSelectedEpisode(1);
                                } else {
                                    // Last episode of last season - stay on it
                                    setSelectedSeason(lastWatched.season);
                                    setSelectedEpisode(lastWatched.episode);
                                }
                            } else {
                                // Not complete - select the episode to continue watching
                                setSelectedSeason(lastWatched.season);
                                setSelectedEpisode(lastWatched.episode);
                            }
                        } else {
                            setSelectedSeason(1);
                            setSelectedEpisode(1);
                        }
                        setLoading(false);
                    })
                    .catch(() => {
                        setSeriesInfo(null);
                        setLoading(false);
                    });
            }
        });
    }, [isOpen, contentId, contentType]);

    // Fetch TMDB data for extra info
    useEffect(() => {
        if (!isOpen || !contentData.name) return;

        const yearMatch = contentData.name.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : undefined;

        if (contentType === 'series') {
            searchSeriesByName(contentData.name, year)
                .then(data => setTmdbData(data))
                .catch(() => setTmdbData(null));
        } else {
            searchMovieByName(contentData.name, year)
                .then(data => setTmdbData(data))
                .catch(() => setTmdbData(null));
        }
    }, [isOpen, contentData.name, contentType]);

    // Check if content is already downloaded or in queue
    useEffect(() => {
        if (!isOpen) return;
        if (contentType === 'movie') {
            const isAlreadyInQueue = downloadService.isMovieInQueue(contentData.name);
            setDownloadStatus(isAlreadyInQueue ? 'completed' : 'idle');
        }
    }, [isOpen, contentData.name, contentType]);

    // Fetch trailer from TMDB if not provided by API
    useEffect(() => {
        if (!isOpen || !contentData.name) return;

        // If API provided a trailer, use it
        if (contentData.youtube_trailer) {
            setTrailerUrl(contentData.youtube_trailer);
            return;
        }

        // Otherwise, fetch from TMDB
        const yearMatch = contentData.name.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : undefined;

        if (contentType === 'movie') {
            fetchMovieTrailer(contentData.name, year)
                .then(url => setTrailerUrl(url))
                .catch(() => setTrailerUrl(null));
        } else {
            fetchSeriesTrailer(contentData.name, year)
                .then(url => setTrailerUrl(url))
                .catch(() => setTrailerUrl(null));
        }
    }, [isOpen, contentData.name, contentData.youtube_trailer, contentType]);

    // Close on escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    // Close when clicking outside
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === modalRef.current) {
            onClose();
        }
    };

    // Download a single episode
    const downloadSingleEpisode = async (seasonNum: number, episodeNum: number) => {
        // Check if episode is already in queue
        if (downloadService.isEpisodeInQueue(contentData.name, seasonNum, episodeNum)) {
            setShowDownloadModal(false);
            return; // Already downloading or downloaded
        }

        const episodeData = seriesInfo?.episodes?.[seasonNum]?.find(
            (ep: any) => Number(ep.episode_num) === episodeNum
        );
        if (!episodeData) return;

        setDownloadStatus('downloading');
        setShowDownloadModal(false);

        try {
            const result = await window.ipcRenderer.invoke('streams:get-series-url', {
                streamId: episodeData.id,
                container: episodeData.container_extension || 'mp4'
            });

            if (result?.success) {
                const download = await downloadService.addDownload(
                    contentData.name,
                    'episode',
                    result.url,
                    contentData.cover,
                    {
                        seriesName: contentData.name,
                        season: seasonNum,
                        episode: episodeNum
                    },
                    {
                        plot: (tmdbData as any)?.overview || contentData.plot,
                        rating: contentData.rating || (tmdbData as any)?.vote_average?.toFixed(1),
                        year: contentData.release_date?.split('-')[0],
                        genres: (tmdbData as any)?.genres?.map((g: any) => g.name)
                    }
                );

                const handleProgress = (item: any) => {
                    if (item.id === download.id) {
                        setDownloadProgress(item.progress);
                        if (item.status === 'completed') {
                            setDownloadStatus('completed');
                        }
                    }
                };
                downloadService.on('progress', handleProgress);
                downloadService.on('completed', handleProgress);
            }
        } catch (err) {
            console.error('Download error:', err);
            setDownloadStatus('idle');
        }
    };

    if (!isOpen) return null;

    const overview = (tmdbData as any)?.overview || contentData.plot || 'Sem descrição disponível.';
    const rating = contentData.rating || (tmdbData as any)?.vote_average?.toFixed(1);
    const genres = contentData.genre || (tmdbData as any)?.genres?.map((g: any) => g.name).join(', ');
    const seasons = seriesInfo?.episodes ? Object.keys(seriesInfo.episodes).sort((a, b) => Number(a) - Number(b)) : [];
    const episodes = seriesInfo?.episodes?.[selectedSeason] || [];

    // Check movie progress
    const movieProgress = contentType === 'movie' ? movieProgressService.getMoviePositionById(contentId) : null;
    const hasMovieProgress = movieProgress && movieProgress.progress > 0 && movieProgress.progress < 95;

    return (
        <div
            ref={modalRef}
            onClick={handleBackdropClick}
            style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                animation: 'fadeIn 0.2s ease'
            }}
        >
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(40px) scale(0.95); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes ratingPulse {
                    0%, 100% { transform: scale(1); box-shadow: 0 0 0 rgba(251, 191, 36, 0); }
                    50% { transform: scale(1.05); box-shadow: 0 0 20px rgba(251, 191, 36, 0.4); }
                }
                @keyframes starSpin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>

            <div
                style={{
                    position: 'relative',
                    width: '90%',
                    maxWidth: 900,
                    maxHeight: '90vh',
                    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                    borderRadius: 20,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'row',
                    boxShadow: '0 25px 80px rgba(0, 0, 0, 0.6)',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    animation: 'slideUp 0.3s ease'
                }}
            >
                {/* Close Button */}
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: 16,
                        right: 16,
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: 'rgba(0, 0, 0, 0.5)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: 'white',
                        fontSize: 20,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10,
                        transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.5)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)'}
                >
                    ✕
                </button>

                {/* Poster */}
                <div style={{
                    width: 300,
                    minWidth: 300,
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    <img
                        src={contentData.cover}
                        alt={contentData.name}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                        }}
                    />
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'linear-gradient(90deg, transparent 60%, rgba(26, 26, 46, 1) 100%)'
                    }} />
                </div>

                {/* Content */}
                <div style={{
                    flex: 1,
                    padding: 32,
                    overflowY: 'auto',
                    maxHeight: '90vh'
                }}>
                    {/* Title */}
                    <h2 style={{
                        fontSize: 28,
                        fontWeight: 700,
                        color: 'white',
                        marginBottom: 12,
                        lineHeight: 1.2
                    }}>
                        {contentData.name}
                    </h2>

                    {/* Meta Badges */}
                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 10,
                        marginBottom: 16
                    }}>
                        {rating && (
                            <span style={{
                                padding: '6px 12px',
                                borderRadius: 20,
                                background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.3))',
                                color: '#fbbf24',
                                fontSize: 13,
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                animation: 'ratingPulse 2s ease-in-out infinite',
                                border: '1px solid rgba(251, 191, 36, 0.3)'
                            }}>
                                <span style={{
                                    display: 'inline-block',
                                    animation: 'starSpin 3s linear infinite'
                                }}>⭐</span>
                                {rating}
                            </span>
                        )}
                        <span style={{
                            padding: '6px 12px',
                            borderRadius: 20,
                            background: contentType === 'series' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                            color: contentType === 'series' ? '#a78bfa' : '#60a5fa',
                            fontSize: 13,
                            fontWeight: 600
                        }}>
                            {contentType === 'series' ? '📺 Série' : '🎬 Filme'}
                        </span>
                        {contentType === 'series' && seasons.length > 0 && (
                            <span style={{
                                padding: '6px 12px',
                                borderRadius: 20,
                                background: 'rgba(16, 185, 129, 0.2)',
                                color: '#6ee7b7',
                                fontSize: 13,
                                fontWeight: 600
                            }}>
                                {seasons.length} Temporada{seasons.length > 1 ? 's' : ''}
                            </span>
                        )}
                    </div>

                    {/* Genres */}
                    {genres && (
                        <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 8,
                            marginBottom: 16
                        }}>
                            {genres.split(',').map((genre: string, i: number) => (
                                <span key={i} style={{
                                    padding: '4px 10px',
                                    borderRadius: 12,
                                    background: 'rgba(255, 255, 255, 0.08)',
                                    color: 'rgba(255, 255, 255, 0.7)',
                                    fontSize: 12
                                }}>
                                    {genre.trim()}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Overview */}
                    <p style={{
                        color: 'rgba(255, 255, 255, 0.8)',
                        fontSize: 14,
                        lineHeight: 1.7,
                        marginBottom: 20,
                        maxHeight: 100,
                        overflow: 'hidden'
                    }}>
                        {overview}
                    </p>

                    {/* Series: Season & Episode Selector */}
                    {contentType === 'series' && !loading && seasons.length > 0 && (
                        <>
                            {/* Season Tabs */}
                            <div style={{
                                display: 'flex',
                                gap: 8,
                                marginBottom: 12,
                                flexWrap: 'wrap'
                            }}>
                                {seasons.map(season => (
                                    <button
                                        key={season}
                                        onClick={() => {
                                            setSelectedSeason(Number(season));
                                            setSelectedEpisode(1);
                                        }}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: 20,
                                            border: selectedSeason === Number(season)
                                                ? '2px solid #a855f7'
                                                : '2px solid rgba(255, 255, 255, 0.1)',
                                            background: selectedSeason === Number(season)
                                                ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(236, 72, 153, 0.2))'
                                                : 'rgba(255, 255, 255, 0.05)',
                                            color: 'white',
                                            fontSize: 13,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        T{season}
                                    </button>
                                ))}
                            </div>

                            {/* Episode List */}
                            <div style={{
                                maxHeight: 180,
                                overflowY: 'auto',
                                marginBottom: 20,
                                background: 'rgba(0, 0, 0, 0.2)',
                                borderRadius: 12,
                                padding: 8
                            }}>
                                {episodes.map((ep: any, index: number) => {
                                    const epNum = Number(ep.episode_num);
                                    const isSelected = epNum === selectedEpisode;
                                    const isWatched = watchProgressService.isEpisodeWatched(contentId, selectedSeason, epNum);

                                    return (
                                        <div
                                            key={ep.id || index}
                                            onClick={() => setSelectedEpisode(epNum)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 12,
                                                padding: '10px 14px',
                                                borderRadius: 10,
                                                cursor: 'pointer',
                                                background: isSelected
                                                    ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.15))'
                                                    : 'transparent',
                                                border: isSelected ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
                                                opacity: isWatched ? 0.6 : 1,
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            <span style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 8,
                                                background: isWatched
                                                    ? 'linear-gradient(135deg, #10b981, #059669)'
                                                    : 'rgba(168, 85, 247, 0.3)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: 12,
                                                fontWeight: 700,
                                                color: 'white'
                                            }}>
                                                {isWatched ? '✓' : epNum}
                                            </span>
                                            <span style={{
                                                fontSize: 13,
                                                color: 'white',
                                                flex: 1,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap'
                                            }}>
                                                Episódio {epNum}
                                            </span>
                                            {isSelected && (
                                                <span style={{
                                                    width: 24,
                                                    height: 24,
                                                    borderRadius: '50%',
                                                    background: 'linear-gradient(135deg, #a855f7, #ec4899)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: 10,
                                                    color: 'white'
                                                }}>
                                                    ▶
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {/* Loading for series info */}
                    {contentType === 'series' && loading && (
                        <div style={{
                            padding: 20,
                            textAlign: 'center',
                            color: 'rgba(255, 255, 255, 0.5)'
                        }}>
                            Carregando episódios...
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {/* Play Button */}
                        <button
                            onClick={() => {
                                // Check for offline content
                                let offlineUrl: string | undefined;
                                if (contentType === 'movie') {
                                    const localPath = downloadService.getOfflineFilePath(contentData.name, 'movie');
                                    if (localPath) offlineUrl = localPath;
                                } else {
                                    const localPath = downloadService.getOfflineEpisodePath(contentData.name, selectedSeason, selectedEpisode);
                                    if (localPath) offlineUrl = localPath;
                                }

                                onPlay(
                                    contentType === 'series' ? selectedSeason : undefined,
                                    contentType === 'series' ? selectedEpisode : undefined,
                                    offlineUrl
                                );
                            }}
                            style={{
                                flex: 1,
                                minWidth: 200,
                                padding: '14px 24px',
                                borderRadius: 12,
                                border: 'none',
                                background: (contentType === 'movie' && downloadService.isDownloaded(contentData.name, 'movie')) ||
                                    (contentType === 'series' && downloadService.getOfflineEpisodePath(contentData.name, selectedSeason, selectedEpisode))
                                    ? 'linear-gradient(135deg, #06b6d4, #0891b2)'
                                    : 'linear-gradient(135deg, #a855f7, #ec4899)',
                                color: 'white',
                                fontSize: 15,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 10,
                                boxShadow: (contentType === 'movie' && downloadService.isDownloaded(contentData.name, 'movie')) ||
                                    (contentType === 'series' && downloadService.getOfflineEpisodePath(contentData.name, selectedSeason, selectedEpisode))
                                    ? '0 8px 24px rgba(6, 182, 212, 0.4)'
                                    : '0 8px 24px rgba(168, 85, 247, 0.4)',
                                transition: 'all 0.3s'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.transform = 'translateY(0)';
                            }}
                        >
                            <span style={{ fontSize: 18 }}>
                                {(contentType === 'movie' && downloadService.isDownloaded(contentData.name, 'movie')) ||
                                    (contentType === 'series' && downloadService.getOfflineEpisodePath(contentData.name, selectedSeason, selectedEpisode))
                                    ? '📥' : '▶'}
                            </span>
                            {contentType === 'series'
                                ? downloadService.getOfflineEpisodePath(contentData.name, selectedSeason, selectedEpisode)
                                    ? `Offline T${selectedSeason} E${selectedEpisode}`
                                    : `Assistir T${selectedSeason} E${selectedEpisode}`
                                : downloadService.isDownloaded(contentData.name, 'movie')
                                    ? 'Assistir Offline'
                                    : hasMovieProgress
                                        ? 'Continuar Assistindo'
                                        : 'Assistir Filme'
                            }
                        </button>

                        {/* Watch Later Button */}
                        <button
                            onClick={() => {
                                if (watchLaterService.has(contentId, contentType)) {
                                    watchLaterService.remove(contentId, contentType);
                                } else {
                                    watchLaterService.add({
                                        id: contentId,
                                        type: contentType,
                                        name: contentData.name,
                                        cover: contentData.cover
                                    });
                                }
                                setRefresh(r => r + 1); // Force UI update
                            }}
                            style={{
                                padding: '14px 20px',
                                borderRadius: 12,
                                border: watchLaterService.has(contentId, contentType)
                                    ? '2px solid #10b981'
                                    : '2px solid rgba(255, 255, 255, 0.2)',
                                background: watchLaterService.has(contentId, contentType)
                                    ? 'rgba(16, 185, 129, 0.2)'
                                    : 'rgba(255, 255, 255, 0.08)',
                                color: watchLaterService.has(contentId, contentType)
                                    ? '#6ee7b7'
                                    : 'white',
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                transition: 'all 0.2s'
                            }}
                        >
                            {watchLaterService.has(contentId, contentType) ? '✓' : '+'}
                            {watchLaterService.has(contentId, contentType) ? 'Salvo' : 'Assistir Depois'}
                        </button>

                        {/* Download Button (Movies and Series) */}
                        <button
                            onClick={async () => {
                                if (downloadStatus === 'completed') return;
                                if (downloadStatus === 'downloading') return;

                                // For series, open the selection modal
                                if (contentType === 'series') {
                                    setShowDownloadModal(true);
                                    return;
                                }

                                // For movies, download directly
                                setDownloadStatus('downloading');
                                try {
                                    let result;
                                    let downloadName = contentData.name;
                                    let downloadType: 'movie' | 'episode' = 'movie';
                                    let seriesInfo = undefined;

                                    if (contentType === 'movie') {
                                        // Get movie stream URL
                                        result = await window.ipcRenderer.invoke('streams:get-vod-url', {
                                            streamId: contentId,
                                            container: contentData.container_extension || 'mp4'
                                        });
                                    } else {
                                        // Get series episode stream URL
                                        const episodeData = episodes.find((ep: any) => Number(ep.episode_num) === selectedEpisode);
                                        if (episodeData) {
                                            result = await window.ipcRenderer.invoke('streams:get-series-url', {
                                                streamId: episodeData.id,
                                                container: episodeData.container_extension || 'mp4'
                                            });
                                            // Use only the series name for display, store season/episode in seriesInfo
                                            downloadName = contentData.name;
                                            downloadType = 'episode';
                                            seriesInfo = {
                                                seriesName: contentData.name,
                                                season: selectedSeason,
                                                episode: selectedEpisode
                                            };
                                        }
                                    }

                                    if (result?.success) {
                                        // Start download with metadata
                                        const download = await downloadService.addDownload(
                                            downloadName,
                                            downloadType,
                                            result.url,
                                            contentData.cover,
                                            seriesInfo,
                                            {
                                                plot: (tmdbData as any)?.overview || contentData.plot,
                                                rating: contentData.rating || (tmdbData as any)?.vote_average?.toFixed(1),
                                                year: contentData.release_date?.split('-')[0] || (tmdbData as any)?.release_date?.split('-')[0],
                                                genres: (tmdbData as any)?.genres?.map((g: any) => g.name)
                                            }
                                        );

                                        // Listen for progress
                                        const handleProgress = (item: any) => {
                                            if (item.id === download.id) {
                                                setDownloadProgress(item.progress);
                                                if (item.status === 'completed') {
                                                    setDownloadStatus('completed');
                                                }
                                            }
                                        };
                                        downloadService.on('progress', handleProgress);
                                        downloadService.on('completed', handleProgress);
                                    }
                                } catch (err) {
                                    console.error('Download error:', err);
                                    setDownloadStatus('idle');
                                }
                            }}
                            disabled={downloadStatus === 'downloading'}
                            style={{
                                padding: '14px 20px',
                                borderRadius: 12,
                                border: downloadStatus === 'completed'
                                    ? '2px solid #06b6d4'
                                    : '2px solid rgba(255, 255, 255, 0.2)',
                                background: downloadStatus === 'completed'
                                    ? 'rgba(6, 182, 212, 0.2)'
                                    : downloadStatus === 'downloading'
                                        ? 'rgba(6, 182, 212, 0.1)'
                                        : 'rgba(255, 255, 255, 0.08)',
                                color: downloadStatus === 'completed'
                                    ? '#67e8f9'
                                    : 'white',
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: downloadStatus === 'downloading' ? 'wait' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                transition: 'all 0.2s',
                                opacity: downloadStatus === 'downloading' ? 0.7 : 1
                            }}
                            title={downloadStatus === 'completed' ? 'Baixado' : 'Baixar para assistir offline'}
                        >
                            {downloadStatus === 'completed' ? '✓' : downloadStatus === 'downloading' ? '⏳' : '📥'}
                            {downloadStatus === 'completed'
                                ? 'Baixado'
                                : downloadStatus === 'downloading'
                                    ? `${downloadProgress}%`
                                    : 'Baixar'
                            }
                        </button>

                        {/* Ver Trailer Button */}
                        {trailerUrl && (
                            <button
                                onClick={() => setShowTrailerModal(true)}
                                style={{
                                    padding: '14px 20px',
                                    borderRadius: 12,
                                    border: '2px solid rgba(239, 68, 68, 0.4)',
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    color: '#fca5a5',
                                    fontSize: 14,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    transition: 'all 0.2s'
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)';
                                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.6)';
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                                }}
                                title="Assistir trailer"
                            >
                                🎬 Ver Trailer
                            </button>
                        )}

                        {/* Favorite Button */}
                        <button
                            onClick={() => {
                                favoritesService.toggle({
                                    id: contentId,
                                    type: contentType,
                                    title: contentData.name,
                                    poster: contentData.cover,
                                    rating: (tmdbData as any)?.vote_average?.toFixed(1)
                                });
                                setRefresh(r => r + 1); // Force UI update
                            }}
                            style={{
                                width: 50,
                                height: 50,
                                borderRadius: '50%',
                                border: favoritesService.has(contentId, contentType)
                                    ? '2px solid #ef4444'
                                    : '2px solid rgba(255, 255, 255, 0.2)',
                                background: favoritesService.has(contentId, contentType)
                                    ? 'rgba(239, 68, 68, 0.2)'
                                    : 'rgba(255, 255, 255, 0.05)',
                                color: 'white',
                                fontSize: 20,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s'
                            }}
                            title={favoritesService.has(contentId, contentType) ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
                        >
                            {favoritesService.has(contentId, contentType) ? '❤️' : '🤍'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Download Selection Modal */}
            {showDownloadModal && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0, 0, 0, 0.8)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10001
                    }}
                    onClick={() => setShowDownloadModal(false)}
                >
                    <div
                        style={{
                            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                            borderRadius: 20,
                            padding: 32,
                            maxWidth: 400,
                            textAlign: 'center',
                            border: '1px solid rgba(168, 85, 247, 0.3)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 style={{ color: 'white', marginBottom: 16, fontSize: 20 }}>
                            📥 O que deseja baixar?
                        </h3>
                        <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 24, fontSize: 14 }}>
                            {contentData.name} - Temporada {selectedSeason}
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {(() => {
                                const allEps = seriesInfo?.episodes?.[selectedSeason] || [];
                                const remainingEps = allEps.filter((ep: any) =>
                                    !downloadService.isEpisodeInQueue(contentData.name, selectedSeason, Number(ep.episode_num))
                                );
                                const downloadedCount = allEps.length - remainingEps.length;

                                if (allEps.length === downloadedCount) {
                                    return (
                                        <div style={{
                                            padding: '14px 24px',
                                            borderRadius: 12,
                                            background: 'rgba(16, 185, 129, 0.2)',
                                            border: '2px solid rgba(16, 185, 129, 0.4)',
                                            color: '#6ee7b7',
                                            fontSize: 14,
                                            fontWeight: 600,
                                            textAlign: 'center'
                                        }}>
                                            ✓ Temporada {selectedSeason} completa ({downloadedCount} eps em download)
                                        </div>
                                    );
                                }

                                return (
                                    <button
                                        onClick={() => {
                                            remainingEps.forEach((ep: any, idx: number) => {
                                                setTimeout(() => {
                                                    downloadSingleEpisode(selectedSeason, Number(ep.episode_num));
                                                }, idx * 2000);
                                            });
                                            setShowDownloadModal(false);
                                        }}
                                        style={{
                                            padding: '14px 24px',
                                            borderRadius: 12,
                                            border: 'none',
                                            background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
                                            color: 'white',
                                            fontSize: 14,
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        📂 {downloadedCount > 0
                                            ? `Baixar ${remainingEps.length} episódios restantes (${downloadedCount} já na fila)`
                                            : `Temporada ${selectedSeason} (${allEps.length} episódios)`}
                                    </button>
                                );
                            })()}

                            {downloadService.isEpisodeInQueue(contentData.name, selectedSeason, selectedEpisode) ? (
                                <div style={{
                                    padding: '14px 24px',
                                    borderRadius: 12,
                                    background: 'rgba(168, 85, 247, 0.2)',
                                    border: '2px solid rgba(168, 85, 247, 0.4)',
                                    color: '#c4b5fd',
                                    fontSize: 14,
                                    fontWeight: 600,
                                    textAlign: 'center'
                                }}>
                                    ✓ Episódio {selectedEpisode} já está em download
                                </div>
                            ) : (
                                <button
                                    onClick={() => downloadSingleEpisode(selectedSeason, selectedEpisode)}
                                    style={{
                                        padding: '14px 24px',
                                        borderRadius: 12,
                                        border: 'none',
                                        background: 'linear-gradient(135deg, #a855f7, #ec4899)',
                                        color: 'white',
                                        fontSize: 14,
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    📺 Apenas Episódio {selectedEpisode}
                                </button>
                            )}

                            <button
                                onClick={() => setShowDownloadModal(false)}
                                style={{
                                    padding: '14px 24px',
                                    borderRadius: 12,
                                    border: '2px solid rgba(255,255,255,0.2)',
                                    background: 'transparent',
                                    color: 'white',
                                    fontSize: 14,
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Trailer Modal */}
            {showTrailerModal && trailerUrl && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0, 0, 0, 0.95)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10002,
                        animation: 'fadeIn 0.2s ease'
                    }}
                    onClick={() => setShowTrailerModal(false)}
                >
                    <div
                        style={{
                            position: 'relative',
                            width: '90%',
                            maxWidth: 1200,
                            aspectRatio: '16 / 9',
                            background: '#000',
                            borderRadius: 16,
                            overflow: 'hidden',
                            boxShadow: '0 25px 80px rgba(0, 0, 0, 0.8)',
                            border: '2px solid rgba(239, 68, 68, 0.4)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Close Button */}
                        <button
                            onClick={() => setShowTrailerModal(false)}
                            style={{
                                position: 'absolute',
                                top: 16,
                                right: 16,
                                width: 44,
                                height: 44,
                                borderRadius: '50%',
                                background: 'rgba(0, 0, 0, 0.7)',
                                border: '2px solid rgba(255, 255, 255, 0.3)',
                                color: 'white',
                                fontSize: 22,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 10,
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.6)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)';
                            }}
                        >
                            ✕
                        </button>

                        {/* YouTube Embed */}
                        <iframe
                            src={(() => {
                                // Extract video ID from URL
                                const patterns = [
                                    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
                                    /^([a-zA-Z0-9_-]{11})$/
                                ];
                                for (const pattern of patterns) {
                                    const match = trailerUrl.match(pattern);
                                    if (match && match[1]) {
                                        return `https://www.youtube.com/embed/${match[1]}?autoplay=1&rel=0&modestbranding=1`;
                                    }
                                }
                                return '';
                            })()}
                            style={{
                                width: '100%',
                                height: '100%',
                                border: 'none'
                            }}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            title="Trailer"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
