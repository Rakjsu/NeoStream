import { useState, useEffect, useRef, useMemo } from 'react';
import { searchSeriesByName, searchMovieByName, fetchMovieTrailer, fetchSeriesTrailer, fetchCollection, fetchSimilarByTmdbId, fetchCastByTmdbId, fetchPersonFilmography, type TMDBSeriesDetails, type TMDBMovieDetails, type TMDBCollection, type TMDBSimilarItem, type TMDBCastMember } from '../services/tmdb';
import { allTags, getMark, setRating, toggleTag } from '../services/personalMarksService';
import { watchProgressService } from '../services/watchProgressService';
import { movieProgressService } from '../services/movieProgressService';
import { profileService } from '../services/profileService';
import { watchLaterService } from '../services/watchLater';
import { queueService } from '../services/queueService';
import { favoritesService } from '../services/favoritesService';
import { isTraktConnected, traktRate } from '../services/traktService';
import { downloadService } from '../services/downloadService';
import type { CastQueueItem } from '../services/castQueue';
import { CastDeviceSelector } from './CastDeviceSelector';
import { useLanguage } from '../services/languageService';
import { extractYouTubeId } from '../utils/youtube';
import { episodeDisplayTitle, sortedSeasonKeys } from '../utils/seriesEpisodes';

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
    /** 🎞️ Item 45: versões do mesmo filme (4K/FHD/HD/legendado) pros chips. */
    versions?: { id: string; label: string }[];
    activeVersionId?: string;
    onSelectVersion?: (id: string) => void;
}

interface SeriesEpisode {
    id: number | string;
    episode_num: number | string;
    title?: string;
    container_extension?: string;
}

interface SeriesInfo {
    episodes?: Record<string, SeriesEpisode[]>;
}

interface TmdbGenre {
    name: string;
}

type TmdbDetails = (TMDBSeriesDetails | TMDBMovieDetails) & {
    overview?: string;
    vote_average?: number;
    release_date?: string;
    genres?: TmdbGenre[];
}

interface DownloadProgressItem {
    id: string;
    progress: number;
    status?: string;
}

export function ContentDetailModal({
    isOpen,
    onClose,
    contentId,
    contentType,
    contentData,
    onPlay, versions, activeVersionId, onSelectVersion }: ContentDetailModalProps) {
    const [seriesInfo, setSeriesInfo] = useState<SeriesInfo | null>(null);
    const [tmdbData, setTmdbData] = useState<TMDBSeriesDetails | TMDBMovieDetails | null>(null);
    // 🎬 Coleção (franquia) do filme e títulos parecidos, ambos via TMDB.
    const [collection, setCollection] = useState<TMDBCollection | null>(null);
    const [similar, setSimilar] = useState<TMDBSimilarItem[]>([]);
    const [castList, setCastList] = useState<TMDBCastMember[]>([]);
    const [filmography, setFilmography] = useState<{ name: string; items: TMDBSimilarItem[] } | null>(null);
    const [tagInput, setTagInput] = useState('');
    const [selectedSeason, setSelectedSeason] = useState(1);
    const [selectedEpisode, setSelectedEpisode] = useState(1);
    const [castSeasonMsg, setCastSeasonMsg] = useState<string | null>(null);
    const [castingSeason, setCastingSeason] = useState(false);
    // When the resolved season queue is ready, this opens the device picker.
    const [seasonQueue, setSeasonQueue] = useState<CastQueueItem[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);
    const [refresh, setRefresh] = useState(0); // Force re-render for button states
    // 📱 Feedback do "tocar no celular" (app pareado no controle web).
    const [mobileMsg, setMobileMsg] = useState('');
    const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'completed'>('idle');
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [showDownloadModal, setShowDownloadModal] = useState(false);
    const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
    const trailerFrameRef = useRef<HTMLIFrameElement>(null);
    // Trailer sound preference, remembered per profile (default muted so autoplay works).
    const soundPrefKey = () => `neostream_trailer_muted_${profileService.getActiveProfile()?.id ?? 'default'}`;
    const [trailerMuted, setTrailerMuted] = useState<boolean>(() => {
        try { return localStorage.getItem(`neostream_trailer_muted_${profileService.getActiveProfile()?.id ?? 'default'}`) !== '0'; } catch { return true; }
    });
    // Narrow window → stack episodes below the trailer instead of beside it.
    const [narrow, setNarrow] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth < 900);
    // Lightweight windowing for long episode lists (uniform-height rows).
    const [epScroll, setEpScroll] = useState({ top: 0, height: 0 });
    const modalRef = useRef<HTMLDivElement>(null);
    const { t } = useLanguage();

    // Mute/unmute the YouTube trailer in place via the IFrame API (no reload).
    const sendToTrailer = (func: 'mute' | 'unMute') => {
        trailerFrameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
    };
    const toggleTrailerSound = () => {
        setTrailerMuted(prev => {
            const next = !prev;
            sendToTrailer(next ? 'mute' : 'unMute');
            try { localStorage.setItem(soundPrefKey(), next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
    };

    // Fetch series info for episodes
    useEffect(() => {
        if (!isOpen || contentType !== 'series') return;

        queueMicrotask(() => {
            setLoading(true);
            setLoadError(false);
        });
        // Episodes come via IPC: the main process proxies get_series_info for
        // Xtream and builds the same shape from the parsed list for M3U.
        window.ipcRenderer.invoke('series:get-info', { seriesId: contentId }).then(result => {
            if ((result as { success: boolean }).success) {
                Promise.resolve((result as { info: SeriesInfo }).info)
                    .then((data: SeriesInfo) => {
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
                        setLoadError(true);
                        setLoading(false);
                    });
            } else {
                setLoadError(true);
                setLoading(false);
            }
        });
    }, [isOpen, contentId, contentType, retryNonce]);

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

    // 🎬 Coleção + similares: dependem do id TMDB resolvido pela busca acima.
    useEffect(() => {
        if (!isOpen) {
            queueMicrotask(() => { setCollection(null); setSimilar([]); setCastList([]); setFilmography(null); });
            return;
        }
        const tmdbId = tmdbData?.id;
        if (!tmdbId) {
            queueMicrotask(() => { setCollection(null); setSimilar([]); setCastList([]); setFilmography(null); });
            return;
        }
        let cancelled = false;
        const collectionRef = contentType === 'movie'
            ? (tmdbData as TMDBMovieDetails).belongs_to_collection
            : null;
        if (collectionRef?.id) {
            void fetchCollection(String(collectionRef.id)).then(result => {
                if (!cancelled) setCollection(result);
            });
        } else {
            queueMicrotask(() => setCollection(null));
        }
        void fetchSimilarByTmdbId(String(tmdbId), contentType).then(result => {
            if (!cancelled) setSimilar(result);
        });
        // 🎭 Elenco clicável (filmografia): mesma vida do rail de similares.
        queueMicrotask(() => setFilmography(null));
        void fetchCastByTmdbId(String(tmdbId), contentType).then(result => {
            if (!cancelled) setCastList(result);
        });
        return () => { cancelled = true; };
    }, [isOpen, tmdbData, contentType]);

    // Check if content is already downloaded or in queue
    useEffect(() => {
        if (!isOpen) return;
        if (contentType === 'movie') {
            const isAlreadyInQueue = downloadService.isMovieInQueue(contentData.name);
            queueMicrotask(() => setDownloadStatus(isAlreadyInQueue ? 'completed' : 'idle'));
        }
    }, [isOpen, contentData.name, contentType]);

    // Helper function to get clean episode title
    const getEpisodeTitle = (ep: SeriesEpisode): string =>
        episodeDisplayTitle(ep.title, Number(ep.episode_num));

    // Fetch trailer from TMDB if not provided by API
    useEffect(() => {
        if (!isOpen || !contentData.name) return;

        // If API provided a trailer, use it
        if (contentData.youtube_trailer) {
            queueMicrotask(() => setTrailerUrl(contentData.youtube_trailer || null));
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

    // Stack episodes below the trailer on narrow windows.
    useEffect(() => {
        const onResize = () => setNarrow(window.innerWidth < 900);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // Keyboard: ↑/↓ move the selected episode, Enter plays it (series only).
    useEffect(() => {
        if (!isOpen || contentType !== 'series') return;
        const onKey = (e: KeyboardEvent) => {
            const eps = seriesInfo?.episodes?.[selectedSeason] || [];
            if (!eps.length) return;
            const idx = eps.findIndex(ep => Number(ep.episode_num) === selectedEpisode);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextEp = eps[Math.min(idx + 1, eps.length - 1)];
                if (nextEp) setSelectedEpisode(Number(nextEp.episode_num));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevEp = eps[Math.max(idx - 1, 0)];
                if (prevEp) setSelectedEpisode(Number(prevEp.episode_num));
            } else if (e.key === 'Enter') {
                onPlay(selectedSeason, selectedEpisode);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, contentType, seriesInfo, selectedSeason, selectedEpisode, onPlay]);

    // Close when clicking outside
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === modalRef.current) {
            onClose();
        }
    };

    // Download a single episode
    // Resolve every episode URL of the selected season (Xtream/M3U/Stalker, in
    // order) and open the device picker so the user chooses WHERE to cast —
    // Chromecast (whole queue via QUEUE_LOAD) or DLNA/AirPlay (first episode).
    // Fetch subtitles for the first few queued episodes CONCURRENTLY, with an
    // overall time cap so a slow/rate-limited OpenSubtitles lookup can't block
    // the cast. Bounded (not the whole season) to avoid hammering the service;
    // items keep their reference, so any subtitle that lands before the user
    // picks a device still rides along. Failures degrade to "no subtitle".
    const prefetchQueueSubtitles = async (queue: CastQueueItem[]) => {
        const PREFETCH_MAX = 8;
        try {
            const { autoFetchSubtitle, cleanupSubtitleUrl } = await import('../services/subtitleService');
            const jobs = queue.slice(0, PREFETCH_MAX).map(async (item) => {
                try {
                    const r = await autoFetchSubtitle({ title: item.title });
                    if (r?.vttContent) { item.subtitleVtt = r.vttContent; cleanupSubtitleUrl(r.url); }
                } catch { /* this episode just casts without a prefetched subtitle */ }
            });
            await Promise.race([
                Promise.allSettled(jobs),
                new Promise<void>((resolve) => setTimeout(resolve, 6000)),
            ]);
        } catch { /* subtitleService unavailable — cast without subtitles */ }
    };

    const castSeason = async () => {
        const eps = seriesInfo?.episodes?.[selectedSeason] || [];
        if (eps.length === 0) return;
        setCastingSeason(true);
        setCastSeasonMsg(t('contentModal', 'castResolving'));
        try {
            const queue: CastQueueItem[] = [];
            for (const ep of eps) {
                const res = await window.ipcRenderer.invoke('streams:get-series-url', {
                    streamId: ep.id,
                    container: ep.container_extension || 'mp4',
                }).catch(() => null) as { success: boolean; url?: string } | null;
                if (res?.success && res.url) queue.push({ url: res.url, title: getEpisodeTitle(ep) });
            }
            if (queue.length === 0) {
                setCastSeasonMsg(t('contentModal', 'castNoUrls'));
                setTimeout(() => setCastSeasonMsg(null), 6000);
            } else {
                await prefetchQueueSubtitles(queue);
                setCastSeasonMsg(null);
                setSeasonQueue(queue); // opens <CastDeviceSelector>
            }
        } finally {
            setCastingSeason(false);
        }
    };

    const downloadSingleEpisode = async (seasonNum: number, episodeNum: number) => {
        // Check if episode is already in queue
        if (downloadService.isEpisodeInQueue(contentData.name, seasonNum, episodeNum)) {
            setShowDownloadModal(false);
            return; // Already downloading or downloaded
        }

        const episodeData = seriesInfo?.episodes?.[seasonNum]?.find(
            (ep) => Number(ep.episode_num) === episodeNum
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
                        plot: (tmdbData as TmdbDetails | null)?.overview || contentData.plot,
                        rating: contentData.rating || (tmdbData as TmdbDetails | null)?.vote_average?.toFixed(1),
                        year: contentData.release_date?.split('-')[0],
                        genres: (tmdbData as TmdbDetails | null)?.genres?.map((g) => g.name)
                    }
                );

                const handleProgress = (item: DownloadProgressItem) => {
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

    // Per-episode watch state for the selected season, computed once per
    // change instead of two service lookups per row per render.
    const episodeProgressMap = useMemo(() => {
        const map = new Map<number, { watched: boolean; pct: number }>();
        if (contentType !== 'series') return map;
        const eps = seriesInfo?.episodes?.[selectedSeason] || [];
        for (const ep of eps) {
            const epNum = Number(ep.episode_num);
            const watched = watchProgressService.isEpisodeWatched(contentId, selectedSeason, epNum);
            const prog = watched ? null : watchProgressService.getEpisodeProgress(contentId, selectedSeason, epNum);
            const pct = (prog && prog.duration > 0) ? Math.min(100, (prog.currentTime / prog.duration) * 100) : 0;
            map.set(epNum, { watched, pct });
        }
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contentType, seriesInfo, selectedSeason, contentId, isOpen, refresh]);

    if (!isOpen) return null;

    const tmdbDetails = tmdbData as TmdbDetails | null;
    const overview = tmdbDetails?.overview || contentData.plot || t('contentModal', 'noDescription');
    const rating = contentData.rating || tmdbDetails?.vote_average?.toFixed(1);
    const genres = contentData.genre || tmdbDetails?.genres?.map((g) => g.name).join(', ');
    const seasons = sortedSeasonKeys(seriesInfo?.episodes);
    const episodes = seriesInfo?.episodes?.[selectedSeason] || [];

    // Windowing for long seasons: uniform rows → render only the visible
    // slice with top/bottom spacers keeping the scrollbar honest.
    const EP_ROW_H = 52;
    const EP_OVERSCAN = 8;
    const windowEpisodes = episodes.length > 60;
    const epStart = windowEpisodes ? Math.max(0, Math.floor(epScroll.top / EP_ROW_H) - EP_OVERSCAN) : 0;
    const epEnd = windowEpisodes
        ? Math.min(episodes.length, Math.ceil((epScroll.top + (epScroll.height || 360)) / EP_ROW_H) + EP_OVERSCAN)
        : episodes.length;
    const visibleEpisodes = episodes.slice(epStart, epEnd);

    // Check movie progress
    const movieProgress = contentType === 'movie' ? movieProgressService.getMoviePositionById(contentId) : null;
    const hasMovieProgress = movieProgress && movieProgress.progress > 0 && movieProgress.progress < 95;

    return (
        <div
            ref={modalRef}
            onClick={handleBackdropClick}
            data-overlay="modal"
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
                    from { opacity: 0; transform: translateY(30px) scale(0.85); }
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
                    width: '68%',
                    maxWidth: 1040,
                    maxHeight: '92vh',
                    background: 'linear-gradient(135deg, var(--ns-bg-panel) 0%, var(--ns-bg-tint) 100%)',
                    borderRadius: 18,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 30px 70px rgba(0, 0, 0, 0.6)',
                    border: '1px solid rgba(var(--ns-accent-rgb), 0.3)',
                    animation: 'slideUp 0.34s cubic-bezier(.32,1.28,.5,1)'
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

                {/* Top row: trailer on the left, episodes beside it (series); stacks on narrow */}
                <div style={{
                    display: 'flex',
                    flexDirection: (contentType === 'series' && narrow) ? 'column' : 'row',
                    alignItems: 'stretch',
                    flexShrink: 0
                }}>
                {/* Hero: trailer (autoplay, muted) or poster fallback */}
                <div style={{
                    position: 'relative',
                    flex: '1 1 0',
                    minWidth: 0,
                    aspectRatio: '16 / 9',
                    background: '#000',
                    overflow: 'hidden'
                }}>
                    {(() => {
                        const trailerId = extractYouTubeId(trailerUrl);
                        if (trailerId) {
                            return (
                                <iframe
                                    ref={trailerFrameRef}
                                    src={`https://www.youtube-nocookie.com/embed/${trailerId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1&loop=1&playlist=${trailerId}&enablejsapi=1`}
                                    title={`${contentData.name} trailer`}
                                    referrerPolicy="strict-origin-when-cross-origin"
                                    allow="autoplay; encrypted-media; picture-in-picture"
                                    onLoad={() => { if (!trailerMuted) window.setTimeout(() => sendToTrailer('unMute'), 600); }}
                                    style={{
                                        position: 'absolute',
                                        top: '50%',
                                        left: '50%',
                                        width: '100%',
                                        height: '100%',
                                        transform: 'translate(-50%, -50%) scale(1.02)',
                                        border: 'none',
                                        pointerEvents: 'none'
                                    }}
                                />
                            );
                        }
                        return (
                            <img
                                src={contentData.cover}
                                alt={contentData.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                        );
                    })()}

                    {/* Fade into the content below */}
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        background: 'linear-gradient(to bottom, transparent 55%, var(--ns-bg-panel) 100%)'
                    }} />

                    {/* ⛶ Trailer em tela cheia com 1 clique (ESC volta) */}
                    {extractYouTubeId(trailerUrl) && (
                        <button
                            onClick={() => { void trailerFrameRef.current?.requestFullscreen().catch(() => undefined); }}
                            title={t('contentModal', 'trailerFullscreen')}
                            aria-label={t('contentModal', 'trailerFullscreen')}
                            style={{
                                position: 'absolute',
                                bottom: 14,
                                right: 62,
                                width: 40,
                                height: 40,
                                borderRadius: '50%',
                                background: 'rgba(0, 0, 0, 0.55)',
                                border: '1px solid rgba(255, 255, 255, 0.35)',
                                color: 'white',
                                fontSize: 16,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 5
                            }}
                        >
                            ⛶
                        </button>
                    )}

                    {/* Mute / unmute toggle (only when a trailer is playing) */}
                    {extractYouTubeId(trailerUrl) && (
                        <button
                            onClick={toggleTrailerSound}
                            title={trailerMuted ? t('contentModal', 'unmute') : t('contentModal', 'mute')}
                            aria-label={trailerMuted ? 'Ativar som' : 'Silenciar'}
                            style={{
                                position: 'absolute',
                                bottom: 14,
                                right: 14,
                                width: 40,
                                height: 40,
                                borderRadius: '50%',
                                background: 'rgba(0, 0, 0, 0.55)',
                                border: '1px solid rgba(255, 255, 255, 0.35)',
                                color: 'white',
                                fontSize: 16,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 5
                            }}
                        >
                            {trailerMuted ? '🔇' : '🔊'}
                        </button>
                    )}
                </div>

                {/* Episodes beside the trailer (series only) */}
                {contentType === 'series' && (
                <div style={narrow ? {
                    width: '100%',
                    flexShrink: 0,
                    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                    background: 'rgba(0, 0, 0, 0.25)'
                } : {
                    width: 320,
                    flexShrink: 0,
                    position: 'relative',
                    borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
                    background: 'rgba(0, 0, 0, 0.25)'
                }}>
                    {/* Wide: absolute inner takes the trailer's height then scrolls. Narrow: normal flow with its own cap. */}
                    <div style={narrow ? {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        padding: 14,
                        maxHeight: 300
                    } : {
                        position: 'absolute',
                        inset: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12
                    }}>
                        {!loading && seasons.length > 0 && (
                            <>
                                {/* Season Tabs */}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
                                    {seasons.map(season => (
                                        <button
                                            key={season}
                                            onClick={() => { setSelectedSeason(Number(season)); setSelectedEpisode(1); }}
                                            style={{
                                                padding: '6px 14px',
                                                borderRadius: 20,
                                                border: selectedSeason === Number(season) ? '2px solid var(--ns-accent)' : '2px solid rgba(255, 255, 255, 0.1)',
                                                background: selectedSeason === Number(season) ? 'linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.3), rgba(var(--ns-accent-grad-to-rgb), 0.2))' : 'rgba(255, 255, 255, 0.05)',
                                                color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
                                            }}
                                        >
                                            T{season}
                                        </button>
                                    ))}
                                </div>

                                {/* Cast the whole season to a Chromecast (QUEUE_LOAD) */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                                    <button
                                        onClick={() => void castSeason()}
                                        disabled={castingSeason || episodes.length === 0}
                                        style={{
                                            padding: '6px 14px', borderRadius: 20, border: '2px solid rgba(var(--ns-accent-rgb), 0.4)',
                                            background: 'rgba(var(--ns-accent-rgb), 0.12)', color: 'var(--ns-accent-light)',
                                            fontSize: 12, fontWeight: 700, cursor: castingSeason ? 'default' : 'pointer',
                                            opacity: castingSeason || episodes.length === 0 ? 0.6 : 1
                                        }}
                                    >
                                        📡 {t('contentModal', 'castSeason').replace('{season}', String(selectedSeason))}
                                    </button>
                                    {castSeasonMsg && (
                                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{castSeasonMsg}</span>
                                    )}
                                </div>

                                {/* Episode List (fills the remaining height, scrolls; windowed for long seasons) */}
                                <div
                                    style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'rgba(0, 0, 0, 0.2)', borderRadius: 12, padding: 8 }}
                                    onScroll={windowEpisodes ? (e) => {
                                        const el = e.currentTarget;
                                        setEpScroll({ top: el.scrollTop, height: el.clientHeight });
                                    } : undefined}
                                >
                                    {windowEpisodes && epStart > 0 && (
                                        <div style={{ height: epStart * EP_ROW_H }} aria-hidden="true" />
                                    )}
                                    {visibleEpisodes.map((ep: SeriesEpisode, index: number) => {
                                        const epNum = Number(ep.episode_num);
                                        const isSelected = epNum === selectedEpisode;
                                        const state = episodeProgressMap.get(epNum);
                                        const isWatched = state?.watched ?? false;
                                        const pct = state?.pct ?? 0;
                                        return (
                                            <div key={ep.id || (epStart + index)} onClick={() => setSelectedEpisode(epNum)}
                                                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                                                    background: isSelected ? 'linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.2), rgba(var(--ns-accent-grad-to-rgb), 0.15))' : 'transparent',
                                                    border: isSelected ? '1px solid rgba(var(--ns-accent-rgb), 0.4)' : '1px solid transparent', opacity: isWatched ? 0.6 : 1, transition: 'all 0.2s' }}>
                                                <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: isWatched ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(var(--ns-accent-rgb), 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'white' }}>
                                                    {isWatched ? '✓' : epNum}
                                                </span>
                                                <span style={{ fontSize: 13, color: 'white', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {getEpisodeTitle(ep)}
                                                </span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (isWatched) watchProgressService.clearEpisodeProgress(contentId, selectedSeason, epNum);
                                                        else watchProgressService.markEpisodeWatched(contentId, selectedSeason, epNum);
                                                        setRefresh(r => r + 1);
                                                    }}
                                                    title={isWatched ? t('contentModal', 'unmarkWatched') : t('contentModal', 'markWatched')}
                                                    style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, border: '1px solid rgba(255,255,255,0.2)', background: isWatched ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.05)', color: isWatched ? '#10b981' : 'rgba(255,255,255,0.5)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                >
                                                    ✓
                                                </button>
                                                {isSelected && (
                                                    <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'white' }}>▶</span>
                                                )}
                                                {pct > 0 && (
                                                    <div style={{ position: 'absolute', left: 14, right: 14, bottom: 3, height: 3, borderRadius: 2, background: 'rgba(255, 255, 255, 0.15)' }}>
                                                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: 'var(--ns-accent)' }} />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {windowEpisodes && epEnd < episodes.length && (
                                        <div style={{ height: (episodes.length - epEnd) * EP_ROW_H }} aria-hidden="true" />
                                    )}
                                </div>
                            </>
                        )}

                        {/* Loading */}
                        {loading && (
                            <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)', fontSize: 13 }}>Carregando episódios...</div>
                        )}

                        {/* Error / retry */}
                        {!loading && loadError && (
                            <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(255, 255, 255, 0.7)', fontSize: 13 }}>
                                <p style={{ marginBottom: 12 }}>⚠️ Não foi possível carregar os episódios.</p>
                                <button onClick={() => setRetryNonce(n => n + 1)} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(var(--ns-accent-rgb), 0.6)', background: 'rgba(var(--ns-accent-rgb), 0.25)', color: 'white', cursor: 'pointer', fontWeight: 600 }}>Tentar novamente</button>
                            </div>
                        )}
                    </div>
                </div>
                )}
                </div>
                {/* End top row */}

                {/* Content */}
                <div style={{
                    flex: 1,
                    minHeight: 0,
                    padding: 32,
                    overflowY: 'auto'
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
                            {contentType === 'series' ? `📺 ${t('contentModal', 'series')}` : `🎬 ${t('contentModal', 'movie')}`}
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
                                {seasons.length} {seasons.length > 1 ? t('contentModal', 'seasonsPlural') : t('contentModal', 'seasons')}
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

                    {/* 🎞️ Item 45: seletor de versão (4K/FHD/HD/legendado) */}
                    {versions && versions.length > 1 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                            {versions.map(version => {
                                const isActive = version.id === activeVersionId;
                                return (
                                    <button
                                        key={version.id}
                                        onClick={() => { if (!isActive) onSelectVersion?.(version.id); }}
                                        style={{
                                            padding: '6px 14px',
                                            borderRadius: 16,
                                            fontSize: 13,
                                            fontWeight: 600,
                                            cursor: isActive ? 'default' : 'pointer',
                                            border: isActive ? '1px solid var(--ns-accent)' : '1px solid rgba(255,255,255,0.25)',
                                            background: isActive ? 'rgba(var(--ns-accent-rgb), 0.3)' : 'rgba(255,255,255,0.08)',
                                            color: 'white'
                                        }}
                                    >
                                        {version.label}
                                    </button>
                                );
                            })}
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
                                    : 'linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to))',
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
                                    : '0 8px 24px rgba(var(--ns-accent-rgb), 0.4)',
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
                                    ? `${t('contentModal', 'offlineSeason')}${selectedSeason} ${t('contentModal', 'episode')}${selectedEpisode}`
                                    : `${(episodeProgressMap.get(selectedEpisode)?.pct ?? 0) > 0 ? t('contentModal', 'continueSeason') : t('contentModal', 'watchSeason')}${selectedSeason} ${t('contentModal', 'episode')}${selectedEpisode}${(episodeProgressMap.get(selectedEpisode)?.pct ?? 0) > 0 ? ` · ${Math.round(episodeProgressMap.get(selectedEpisode)!.pct)}%` : ''}`
                                : downloadService.isDownloaded(contentData.name, 'movie')
                                    ? t('contentModal', 'watchOffline')
                                    : hasMovieProgress
                                        ? `${t('contentModal', 'continueWatching')} · ${Math.round(movieProgress!.progress)}%`
                                        : t('contentModal', 'watchMovie')
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
                            {watchLaterService.has(contentId, contentType) ? t('contentModal', 'saved') : t('contentModal', 'watchLater')}
                        </button>
                        {/* 🎞️ Item 30: fila manual de reprodução (só filmes) */}
                        {contentType === 'movie' && (
                            <button
                                onClick={() => {
                                    if (queueService.has(contentId)) queueService.remove(contentId);
                                    else queueService.add({ id: contentId, name: contentData.name, cover: contentData.cover });
                                    setRefresh(r => r + 1);
                                }}
                                style={{
                                    padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                    border: queueService.has(contentId) ? '1px solid var(--ns-accent, #7c3aed)' : '1px solid rgba(255,255,255,0.25)',
                                    background: queueService.has(contentId) ? 'rgba(124, 58, 237, 0.25)' : 'transparent',
                                    color: 'white',
                                }}
                                title={queueService.has(contentId) ? t('contentModal', 'queueRemove') : t('contentModal', 'queueAdd')}
                            >
                                🎞️ {queueService.has(contentId) ? t('contentModal', 'queued') : t('contentModal', 'queueAdd')}
                            </button>
                        )}

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
                                        const episodeData = episodes.find((ep) => Number(ep.episode_num) === selectedEpisode);
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
                                                plot: tmdbDetails?.overview || contentData.plot,
                                                rating: contentData.rating || tmdbDetails?.vote_average?.toFixed(1),
                                                year: contentData.release_date?.split('-')[0] || tmdbDetails?.release_date?.split('-')[0],
                                                genres: tmdbDetails?.genres?.map((g) => g.name)
                                            }
                                        );

                                        // Listen for progress
                                        const handleProgress = (item: DownloadProgressItem) => {
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
                            title={downloadStatus === 'completed' ? t('contentModal', 'downloaded') : t('contentModal', 'downloadTooltip')}
                        >
                            {downloadStatus === 'completed' ? '✓' : downloadStatus === 'downloading' ? '⏳' : '📥'}
                            {downloadStatus === 'completed'
                                ? t('contentModal', 'downloaded')
                                : downloadStatus === 'downloading'
                                    ? `${downloadProgress}%`
                                    : t('contentModal', 'download')
                            }
                        </button>

                        {/* 📱 Tocar no celular pareado (app conectado no controle web) */}
                        <button
                            onClick={async () => {
                                const payload = contentType === 'series'
                                    ? (() => {
                                        const ep = episodes.find(e => Number(e.episode_num) === selectedEpisode);
                                        if (!ep) return null;
                                        return {
                                            kind: 'series',
                                            sid: String(ep.id),
                                            container: ep.container_extension || 'mp4',
                                            name: `${contentData.name} · S${selectedSeason}E${selectedEpisode}`
                                        };
                                    })()
                                    : {
                                        kind: 'movie',
                                        sid: contentId,
                                        container: contentData.container_extension || 'mp4',
                                        name: contentData.name
                                    };
                                if (!payload) return;
                                const result = await window.ipcRenderer.invoke('web-remote:play-vod-on-mobile', payload) as { success: boolean };
                                setMobileMsg(t('contentModal', result?.success ? 'sentToPhone' : 'noPhoneConnected'));
                                setTimeout(() => setMobileMsg(''), 4000);
                            }}
                            style={{
                                width: 50,
                                height: 50,
                                borderRadius: '50%',
                                border: '2px solid rgba(255, 255, 255, 0.2)',
                                background: 'rgba(255, 255, 255, 0.05)',
                                color: 'white',
                                fontSize: 20,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s'
                            }}
                            title={t('contentModal', 'sendToPhone')}
                        >
                            📱
                        </button>

                        {/* ✓ Marcar visto manual (filmes; episódios têm o ✓ por linha) */}
                        {contentType === 'movie' && (
                            <button
                                onClick={() => {
                                    if (movieProgress?.completed) {
                                        movieProgressService.clearMovieProgress(contentId);
                                    } else {
                                        // 100% assistido sem reprodução: completed = progress >= 95.
                                        movieProgressService.saveMovieTime(contentId, contentData.name, 5400, 5400);
                                    }
                                    setRefresh(r => r + 1);
                                }}
                                style={{
                                    width: 50,
                                    height: 50,
                                    borderRadius: '50%',
                                    border: movieProgress?.completed
                                        ? '2px solid #10b981'
                                        : '2px solid rgba(255, 255, 255, 0.2)',
                                    background: movieProgress?.completed
                                        ? 'rgba(16, 185, 129, 0.2)'
                                        : 'rgba(255, 255, 255, 0.05)',
                                    color: 'white',
                                    fontSize: 20,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s'
                                }}
                                title={movieProgress?.completed ? t('contentModal', 'unmarkWatched') : t('contentModal', 'markWatched')}
                            >
                                {movieProgress?.completed ? '✅' : '☑️'}
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
                                    rating: tmdbDetails?.vote_average?.toFixed(1)
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
                            title={favoritesService.has(contentId, contentType) ? t('contentModal', 'removeFromFavorites') : t('contentModal', 'addToFavorites')}
                        >
                            {favoritesService.has(contentId, contentType) ? '❤️' : '🤍'}
                        </button>
                    </div>

                    {mobileMsg && (
                        <p style={{ color: 'var(--ns-accent-light)', fontSize: 12, marginTop: 10 }}>{mobileMsg}</p>
                    )}

                    {/* ⭐ Minha nota + 🏷️ tags pessoais (locais à máquina) */}
                    <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
                        <div title={t('contentModal', 'myRating')} style={{ whiteSpace: 'nowrap' }}>
                            {[1, 2, 3, 4, 5].map(star => (
                                <button
                                    key={star}
                                    onClick={() => {
                                        const current = getMark(contentType, contentId).rating ?? 0;
                                        const next = current === star ? 0 : star;
                                        setRating(contentType, contentId, next);
                                        // ⭐ Item 36: espelha no Trakt (2–10; 0 remove) — fire-and-forget.
                                        if (isTraktConnected()) void traktRate(contentType, contentData.name, next);
                                        setRefresh(r => r + 1);
                                    }}
                                    aria-label={`${t('contentModal', 'myRating')}: ${star}`}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 2, opacity: (getMark(contentType, contentId).rating ?? 0) >= star ? 1 : 0.25 }}
                                >
                                    ⭐
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {(getMark(contentType, contentId).tags ?? []).map(tag => (
                                <button
                                    key={tag}
                                    onClick={() => { toggleTag(contentType, contentId, tag); setRefresh(r => r + 1); }}
                                    title={tag}
                                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.85)', borderRadius: 999, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                                >
                                    🏷️ {tag} ✕
                                </button>
                            ))}
                            <input
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && tagInput.trim()) {
                                        toggleTag(contentType, contentId, tagInput);
                                        setTagInput('');
                                        setRefresh(r => r + 1);
                                    }
                                }}
                                placeholder={t('contentModal', 'tagPlaceholder')}
                                list="ns-known-tags"
                                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'white', borderRadius: 999, padding: '5px 10px', fontSize: 12, width: 90 }}
                            />
                            <datalist id="ns-known-tags">
                                {allTags().map(tag => <option key={tag} value={tag} />)}
                            </datalist>
                        </div>
                    </div>

                    {/* 🎬 Coleção TMDB (franquia) */}
                    {contentType === 'movie' && collection && collection.parts.length > 1 && (
                        <div style={{ marginTop: 24 }}>
                            <h3 style={{ color: 'white', fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
                                🎬 {collection.name}
                            </h3>
                            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
                                {collection.parts.map(part => (
                                    <div key={part.id} style={{ width: 92, flexShrink: 0 }} title={part.title}>
                                        {part.poster_path ? (
                                            <img
                                                src={`https://image.tmdb.org/t/p/w185${part.poster_path}`}
                                                alt={part.title}
                                                loading="lazy"
                                                style={{
                                                    width: 92, height: 138, objectFit: 'cover', borderRadius: 8,
                                                    border: part.id === tmdbDetails?.id
                                                        ? '2px solid var(--ns-accent)'
                                                        : '2px solid transparent'
                                                }}
                                            />
                                        ) : (
                                            <div style={{ width: 92, height: 138, borderRadius: 8, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🎬</div>
                                        )}
                                        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {part.title}{part.release_date ? ` (${part.release_date.slice(0, 4)})` : ''}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 🍿 Parecidos com este (TMDB /similar) */}
                    {similar.length > 0 && (
                        <div style={{ marginTop: 24 }}>
                            <h3 style={{ color: 'white', fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
                                🍿 {t('contentModal', 'similarTitle')}
                            </h3>
                            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
                                {similar.map(item => (
                                    <div key={item.id} style={{ width: 92, flexShrink: 0 }} title={item.title}>
                                        <img
                                            src={`https://image.tmdb.org/t/p/w185${item.poster_path}`}
                                            alt={item.title}
                                            loading="lazy"
                                            style={{ width: 92, height: 138, objectFit: 'cover', borderRadius: 8 }}
                                        />
                                        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {item.title}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {/* 🎭 Elenco (clicável → filmografia da pessoa) */}
                    {castList.length > 0 && (
                        <div style={{ marginTop: 24 }}>
                            <h3 style={{ color: 'white', fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
                                🎭 {t('contentModal', 'castTitle')}
                            </h3>
                            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
                                {castList.map(member => (
                                    <button
                                        key={member.id}
                                        onClick={() => { void fetchPersonFilmography(member.id).then(items => setFilmography({ name: member.name, items })); }}
                                        title={member.character ? `${member.name} (${member.character})` : member.name}
                                        style={{ width: 84, flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'center' }}
                                    >
                                        {member.profile_path ? (
                                            <img
                                                src={`https://image.tmdb.org/t/p/w185${member.profile_path}`}
                                                alt={member.name}
                                                loading="lazy"
                                                style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: '50%' }}
                                            />
                                        ) : (
                                            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: 24 }}>🎭</div>
                                        )}
                                        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {member.name}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 🎬 Filmografia da pessoa clicada */}
                    {filmography && filmography.items.length > 0 && (
                        <div style={{ marginTop: 16 }}>
                            <h3 style={{ color: 'white', fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
                                🎬 {t('contentModal', 'filmographyOf').replace('{name}', filmography.name)}
                            </h3>
                            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
                                {filmography.items.map(item => (
                                    <div key={item.id} style={{ width: 92, flexShrink: 0 }} title={item.title}>
                                        <img
                                            src={`https://image.tmdb.org/t/p/w185${item.poster_path}`}
                                            alt={item.title}
                                            loading="lazy"
                                            style={{ width: 92, height: 138, objectFit: 'cover', borderRadius: 8 }}
                                        />
                                        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {item.title}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
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
                            background: 'linear-gradient(135deg, var(--ns-bg-panel) 0%, var(--ns-bg-tint) 100%)',
                            borderRadius: 20,
                            padding: 32,
                            maxWidth: 400,
                            textAlign: 'center',
                            border: '1px solid rgba(var(--ns-accent-rgb), 0.3)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 style={{ color: 'white', marginBottom: 16, fontSize: 20 }}>
                            📥 {t('contentModal', 'whatToDownload')}
                        </h3>
                        <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 24, fontSize: 14 }}>
                            {contentData.name} - {t('contentModal', 'season')} {selectedSeason}
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {(() => {
                                const allEps = seriesInfo?.episodes?.[selectedSeason] || [];
                                const remainingEps = allEps.filter((ep) =>
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
                                            ✓ {t('contentModal', 'seasonComplete').replace('{season}', String(selectedSeason)).replace('{count}', String(downloadedCount))}
                                        </div>
                                    );
                                }

                                return (
                                    <button
                                        onClick={() => {
                                            remainingEps.forEach((ep, idx: number) => {
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
                                            ? t('contentModal', 'downloadRemaining').replace('{count}', String(remainingEps.length)).replace('{downloaded}', String(downloadedCount))
                                            : t('contentModal', 'downloadSeason').replace('{season}', String(selectedSeason)).replace('{count}', String(allEps.length))}
                                    </button>
                                );
                            })()}

                            {downloadService.isEpisodeInQueue(contentData.name, selectedSeason, selectedEpisode) ? (
                                <div style={{
                                    padding: '14px 24px',
                                    borderRadius: 12,
                                    background: 'rgba(var(--ns-accent-rgb), 0.2)',
                                    border: '2px solid rgba(var(--ns-accent-rgb), 0.4)',
                                    color: 'var(--ns-accent-light)',
                                    fontSize: 14,
                                    fontWeight: 600,
                                    textAlign: 'center'
                                }}>
                                    ✓ {t('contentModal', 'episodeAlreadyDownloading').replace('{episode}', String(selectedEpisode))}
                                </div>
                            ) : (
                                <button
                                    onClick={() => downloadSingleEpisode(selectedSeason, selectedEpisode)}
                                    style={{
                                        padding: '14px 24px',
                                        borderRadius: 12,
                                        border: 'none',
                                        background: 'linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to))',
                                        color: 'white',
                                        fontSize: 14,
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    📺 {t('contentModal', 'onlyEpisode').replace('{episode}', String(selectedEpisode))}
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
                                {t('contentModal', 'cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Device picker for casting the whole season (Chromecast/DLNA/AirPlay) */}
            {seasonQueue && (
                <CastDeviceSelector
                    videoUrl={seasonQueue[0]?.url || ''}
                    videoTitle={contentData.name}
                    queue={seasonQueue}
                    onClose={() => setSeasonQueue(null)}
                    onDeviceSelected={(device) => {
                        setCastSeasonMsg(
                            t('contentModal', 'castQueued')
                                .replace('{n}', String(seasonQueue.length))
                                .replace('{device}', device.name));
                        setSeasonQueue(null);
                        setTimeout(() => setCastSeasonMsg(null), 6000);
                    }}
                />
            )}

        </div>
    );
}
