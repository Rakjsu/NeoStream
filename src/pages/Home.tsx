import { useState, useEffect, useRef } from 'react';
import { watchProgressService, type SeriesProgress } from '../services/watchProgressService';
import { movieProgressService } from '../services/movieProgressService';
import { ContentDetailModal } from '../components/ContentDetailModal';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { ResumeModal } from '../components/ResumeModal';
import { profileService } from '../services/profileService';
import { indexedDBCache } from '../services/indexedDBCache';
import { searchMovieByName, searchSeriesByName, isKidsFriendly } from '../services/tmdb';
import { useLanguage } from '../services/languageService';

interface ContentCounts {
    live: number;
    vod: number;
    series: number;
}

interface SeriesData {
    series_id: number;
    name: string;
    cover: string;
    rating?: string;
    category_id?: string;
    added?: number; // timestamp when added
}

interface MovieData {
    stream_id: number;
    name: string;
    stream_icon: string;
    cover?: string;
    rating?: string;
    category_id?: string;
    added?: number; // timestamp when added
}

interface ContinueWatchingItem {
    type: 'series' | 'movie';
    id: string;
    name: string;
    cover: string;
    progress?: SeriesProgress;
    movieProgress?: { currentTime: number; duration: number; progress: number };
    hasNewEpisode?: boolean;
}

// Simple in-memory cache for data
const dataCache = {
    series: null as SeriesData[] | null,
    movies: null as MovieData[] | null,
    counts: null as ContentCounts | null,
    timestamp: 0,
    TTL: 5 * 60 * 1000 // 5 minutes
};

const isCacheValid = () => Date.now() - dataCache.timestamp < dataCache.TTL;

export function Home() {
    const [counts, setCounts] = useState<ContentCounts>({ live: 0, vod: 0, series: 0 });
    const [loading, setLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [continueWatching, setContinueWatching] = useState<ContinueWatchingItem[]>([]);
    const [recentSeries, setRecentSeries] = useState<SeriesData[]>([]);
    const [recentMovies, setRecentMovies] = useState<MovieData[]>([]);
    const [allSeries, setAllSeries] = useState<SeriesData[]>([]);
    const [allMovies, setAllMovies] = useState<MovieData[]>([]);
    const [recommendations, setRecommendations] = useState<(SeriesData | MovieData)[]>([]);
    const [isVisible, setIsVisible] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Kids profile state
    const isKidsProfile = profileService.getActiveProfile()?.isKids || false;

    // Language
    const { t } = useLanguage();
    const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set());
    const [checkingItem, setCheckingItem] = useState<string | null>(null);
    const [blockMessage, setBlockMessage] = useState<string | null>(null);

    // Filtered counts for Kids profile
    // For Kids: subtract hidden items from totals
    const filteredCounts = {
        live: isKidsProfile ? Math.max(0, counts.live -
            ([...hiddenItems].filter(key => key.startsWith('live_')).length)) : counts.live,
        vod: isKidsProfile ? Math.max(0, counts.vod -
            ([...hiddenItems].filter(key => key.startsWith('movie_')).length)) : counts.vod,
        series: isKidsProfile ? Math.max(0, counts.series -
            ([...hiddenItems].filter(key => key.startsWith('series_')).length)) : counts.series
    };

    // Modal state for content details
    const [selectedContent, setSelectedContent] = useState<{
        id: string;
        type: 'series' | 'movie';
        name: string;
        cover: string;
        rating?: string;
        plot?: string;
        genre?: string;
    } | null>(null);

    // Playing video state
    const [playingContent, setPlayingContent] = useState<{
        id: string;
        type: 'series' | 'movie';
        name: string;
        season?: number;
        episode?: number;
        episodeData?: any;
        resumeTime?: number;
    } | null>(null);

    // Resume modal state
    const [showResumeModal, setShowResumeModal] = useState(false);
    const [pendingPlay, setPendingPlay] = useState<{
        id: string;
        type: 'series' | 'movie';
        name: string;
        season?: number;
        episode?: number;
        currentTime: number;
        duration: number;
    } | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Check cache first
                if (isCacheValid() && dataCache.series && dataCache.movies && dataCache.counts) {
                    setCounts(dataCache.counts);
                    setAllSeries(dataCache.series);
                    setAllMovies(dataCache.movies);

                    // Sort cached series
                    const sortedSeries = [...dataCache.series].sort((a, b) => {
                        const aDate = a.added || a.series_id;
                        const bDate = b.added || b.series_id;
                        return bDate - aDate;
                    });
                    setRecentSeries(sortedSeries.slice(0, 30));

                    // Sort cached movies
                    const sortedMovies = [...dataCache.movies].sort((a, b) => {
                        const aDate = a.added || a.stream_id;
                        const bDate = b.added || b.stream_id;
                        return bDate - aDate;
                    });
                    setRecentMovies(sortedMovies.slice(0, 30));

                    setLoading(false);
                    setTimeout(() => setIsVisible(true), 100);
                    return;
                }

                // Fetch counts
                const countResult = await window.ipcRenderer.invoke('content:get-counts');
                if (countResult.success && countResult.counts) {
                    const countsData = {
                        live: countResult.counts.live || 0,
                        vod: countResult.counts.vod || 0,
                        series: countResult.counts.series || 0
                    };
                    setCounts(countsData);
                    dataCache.counts = countsData;
                }

                // Fetch series data
                const seriesResult = await window.ipcRenderer.invoke('streams:get-series');
                if (seriesResult.success && seriesResult.data) {
                    setAllSeries(seriesResult.data);
                    dataCache.series = seriesResult.data;
                    // Sort by added date (or stream_id as fallback - higher = newer)
                    const sortedSeries = [...seriesResult.data].sort((a: SeriesData, b: SeriesData) => {
                        const aDate = a.added || a.series_id;
                        const bDate = b.added || b.series_id;
                        return bDate - aDate;
                    });
                    setRecentSeries(sortedSeries.slice(0, 30));
                }

                // Fetch movies data
                const moviesResult = await window.ipcRenderer.invoke('streams:get-vod');
                if (moviesResult.success && moviesResult.data) {
                    setAllMovies(moviesResult.data);
                    dataCache.movies = moviesResult.data;
                    // Sort by added date (or stream_id as fallback - higher = newer)
                    const sortedMovies = [...moviesResult.data].sort((a: MovieData, b: MovieData) => {
                        const aDate = a.added || a.stream_id;
                        const bDate = b.added || b.stream_id;
                        return bDate - aDate;
                    });
                    setRecentMovies(sortedMovies.slice(0, 30));
                }

                // Update cache timestamp
                dataCache.timestamp = Date.now();
            } catch (error) {
                console.error('Failed to fetch data:', error);
            } finally {
                setLoading(false);
                // Trigger entry animation after a small delay
                setTimeout(() => setIsVisible(true), 100);
            }
        };

        fetchData();

        // Update time every minute (not every second to prevent re-renders)
        const interval = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(interval);
    }, []);

    // Build continue watching list
    useEffect(() => {
        if (allSeries.length === 0 && allMovies.length === 0) return;

        const items: ContinueWatchingItem[] = [];

        // Get series in progress (excluding completed)
        const seriesProgress = watchProgressService.getContinueWatching();
        seriesProgress.forEach((progress, seriesId) => {
            // Skip completed series
            if (watchProgressService.isSeriesCompleted(seriesId)) return;

            const seriesData = allSeries.find(s => s.series_id.toString() === seriesId);
            if (seriesData) {
                items.push({
                    type: 'series',
                    id: seriesId,
                    name: seriesData.name,
                    cover: seriesData.cover,
                    progress
                });
            }
        });

        // Get movies in progress
        const moviesInProgress = movieProgressService.getMoviesInProgress();
        moviesInProgress.forEach(movieId => {
            const movieData = allMovies.find(m => m.stream_id.toString() === movieId);
            const progress = movieProgressService.getMoviePositionById(movieId);
            if (movieData && progress) {
                items.push({
                    type: 'movie',
                    id: movieId,
                    name: movieData.name,
                    cover: movieData.cover || movieData.stream_icon,
                    movieProgress: {
                        currentTime: progress.currentTime,
                        duration: progress.duration,
                        progress: progress.progress
                    }
                });
            }
        });

        // Sort by most recently watched
        items.sort((a, b) => {
            const aTime = a.progress?.lastWatchedAt || a.movieProgress?.currentTime || 0;
            const bTime = b.progress?.lastWatchedAt || b.movieProgress?.currentTime || 0;
            return bTime - aTime;
        });

        setContinueWatching(items.slice(0, 30));
    }, [allSeries, allMovies, refreshTrigger]);

    // Build recommendations based on watched categories (only once when data is ready)
    useEffect(() => {
        if (continueWatching.length === 0 || (allSeries.length === 0 && allMovies.length === 0)) return;

        // Only run once when we have data
        if (recommendations.length > 0) return;

        // Get categories from what user is watching
        const watchedCategoryIds = new Set<string>();
        const watchedIds = new Set<string>();

        continueWatching.forEach(item => {
            watchedIds.add(item.id);
            if (item.type === 'series') {
                const series = allSeries.find(s => s.series_id.toString() === item.id);
                if (series?.category_id) watchedCategoryIds.add(series.category_id);
            } else {
                const movie = allMovies.find(m => m.stream_id.toString() === item.id);
                if (movie?.category_id) watchedCategoryIds.add(movie.category_id);
            }
        });

        // Find recommendations from same categories (not already watched/in progress)
        const recs: (SeriesData | MovieData)[] = [];

        // Add series from watched categories
        allSeries.forEach(series => {
            if (series.category_id &&
                watchedCategoryIds.has(series.category_id) &&
                !watchedIds.has(series.series_id.toString())) {
                recs.push(series);
            }
        });

        // Add movies from watched categories
        allMovies.forEach(movie => {
            if (movie.category_id &&
                watchedCategoryIds.has(movie.category_id) &&
                !watchedIds.has(movie.stream_id.toString())) {
                recs.push(movie);
            }
        });

        // Stable shuffle using Fisher-Yates with seed
        const seed = continueWatching.length + allSeries.length;
        let currentIndex = recs.length;
        let randomIndex;
        const seededRandom = (max: number) => Math.floor((seed * 9301 + 49297) % 233280 / 233280 * max);

        while (currentIndex > 0) {
            randomIndex = seededRandom(currentIndex);
            currentIndex--;
            [recs[currentIndex], recs[randomIndex]] = [recs[randomIndex], recs[currentIndex]];
        }

        setRecommendations(recs.slice(0, 30));
    }, [continueWatching.length, allSeries.length, allMovies.length]); // Use .length instead of arrays

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString(t('home', 'locale'), { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString(t('home', 'locale'), {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });
    };

    const getGreeting = () => {
        const hour = currentTime.getHours();
        if (hour < 12) return t('home', 'goodMorning');
        if (hour < 18) return t('home', 'goodAfternoon');
        return t('home', 'goodEvening');
    };

    const formatProgress = (currentTime: number, duration: number) => {
        const remaining = Math.max(0, duration - currentTime);
        const minutes = Math.floor(remaining / 60);
        if (minutes < 60) return `${minutes} ${t('home', 'minRemaining')}`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}min ${t('home', 'hRemaining').replace('h ', '')}`;
    };

    // Load hidden items for Kids profile
    useEffect(() => {
        if (!isKidsProfile) return;
        const loadHiddenItems = async () => {
            const hiddenMovies = await indexedDBCache.getHiddenItems('movie');
            const hiddenSeries = await indexedDBCache.getHiddenItems('series');
            // Store with format type_name for matching
            const movieKeys = hiddenMovies.map(name => `movie_${name}`);
            const seriesKeys = hiddenSeries.map(name => `series_${name}`);
            setHiddenItems(new Set([...movieKeys, ...seriesKeys]));
        };
        loadHiddenItems();
    }, [isKidsProfile]);

    // Handle content click with Kids profile verification
    const handleContentClick = async (
        contentId: string,
        contentType: 'series' | 'movie',
        name: string,
        cover: string,
        rating?: string
    ) => {
        // Use normalized name for key (same as IndexedDB)
        const normalizeName = (n: string) => n.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ');
        const itemKey = `${contentType}_${normalizeName(name)}`;

        // Check if already hidden
        if (isKidsProfile && hiddenItems.has(itemKey)) {
            setBlockMessage(`"${name}" ${t('home', 'notAvailableForProfile')}`);
            setTimeout(() => setBlockMessage(null), 3000);
            return;
        }

        // Check if item is hidden in IndexedDB
        if (isKidsProfile) {
            const isHidden = await indexedDBCache.isItemHidden(contentType, name);
            if (isHidden) {
                setHiddenItems(prev => new Set([...prev, itemKey]));
                setBlockMessage(`"${name}" ${t('home', 'notAvailableForProfile')}`);
                setTimeout(() => setBlockMessage(null), 3000);
                return;
            }
        }

        // Check cache first
        const cached = contentType === 'movie'
            ? await indexedDBCache.getCachedMovie(name)
            : await indexedDBCache.getCachedSeries(name);

        if (cached && cached.certification) {
            const friendly = isKidsFriendly(cached.certification);
            if (isKidsProfile && !friendly) {
                // Block and hide
                await indexedDBCache.hideItem(contentType, name);
                setHiddenItems(prev => new Set([...prev, itemKey]));
                setBlockMessage(`"${name}" ${t('home', 'notSuitableForKids')}`);
                setTimeout(() => setBlockMessage(null), 3000);
                return;
            }
            // Cached and allowed - proceed
            setSelectedContent({ id: contentId, type: contentType, name, cover, rating });
            return;
        }

        // Need to fetch from TMDB
        setCheckingItem(itemKey);

        try {
            const tmdbResult = contentType === 'movie'
                ? await searchMovieByName(name)
                : await searchSeriesByName(name);

            if (tmdbResult && tmdbResult.certification) {
                const friendly = isKidsFriendly(tmdbResult.certification);
                const genreNames = (tmdbResult.genres || []).map((g: { id: number; name: string }) => g.name);

                // Always cache the result
                if (contentType === 'movie') {
                    await indexedDBCache.setCacheMovie(name, tmdbResult.certification, genreNames);
                } else {
                    await indexedDBCache.setCacheSeries(name, tmdbResult.certification, genreNames);
                }

                // If not kid-friendly, mark as hidden for future
                if (!friendly) {
                    await indexedDBCache.hideItem(contentType, name);
                }

                // Block for Kids if not appropriate
                if (isKidsProfile && !friendly) {
                    setHiddenItems(prev => new Set([...prev, itemKey]));
                    setBlockMessage(`"${name}" ${t('home', 'notSuitableForKids')}`);
                    setTimeout(() => setBlockMessage(null), 3000);
                    setCheckingItem(null);
                    return;
                }
            }

            // Allow access
            setSelectedContent({ id: contentId, type: contentType, name, cover, rating });
        } catch (error) {
            console.error('Error checking content rating:', error);
            // On error, allow access but don't cache
            setSelectedContent({ id: contentId, type: contentType, name, cover, rating });
        } finally {
            setCheckingItem(null);
        }
    };

    // Remove from continue watching
    const removeFromContinue = (itemId: string, itemType: 'series' | 'movie') => {
        if (itemType === 'series') {
            watchProgressService.clearSeriesProgress(itemId);
        } else {
            movieProgressService.clearMovieProgress(itemId);
        }
        setContinueWatching(prev => prev.filter(item => item.id !== itemId));
    };

    // Content card component with hover preview - NO STATE to prevent re-renders
    const ContentCard = ({ item, type, showProgress = false, rating, onRemove }: {
        item: ContinueWatchingItem | SeriesData | MovieData;
        type: 'continue' | 'series' | 'movie';
        showProgress?: boolean;
        rating?: string;
        onRemove?: () => void;
    }) => {
        const isContinue = type === 'continue';
        const continueItem = item as ContinueWatchingItem;
        const seriesItem = item as SeriesData;
        const movieItem = item as MovieData;

        const cover = isContinue ? continueItem.cover :
            type === 'series' ? seriesItem.cover :
                (movieItem.cover || movieItem.stream_icon);
        const name = isContinue ? continueItem.name :
            type === 'series' ? seriesItem.name : movieItem.name;


        const itemRating = rating || (type === 'series' ? seriesItem.rating : movieItem.rating);

        const progress = isContinue && continueItem.type === 'movie'
            ? continueItem.movieProgress?.progress
            : undefined;

        return (
            <div
                className="content-card"
                style={{
                    position: 'relative',
                    minWidth: 160,
                    maxWidth: 160,
                    borderRadius: '12px',
                    overflow: 'visible',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    flexShrink: 0
                }}
            >
                {/* Remove button for continue watching */}
                {isContinue && (
                    <button
                        className="remove-btn"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRemove?.();
                        }}
                        style={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: 'rgba(239, 68, 68, 0.9)',
                            border: 'none',
                            color: 'white',
                            fontSize: 14,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 150
                        }}
                        title={t('home', 'removeFromContinue')}
                    >
                        ✕
                    </button>
                )}

                <div
                    onClick={() => {
                        const contentId = isContinue ? continueItem.id :
                            type === 'series' ? String(seriesItem.series_id) : String(movieItem.stream_id);
                        const contentType = isContinue ? continueItem.type :
                            (type === 'series' ? 'series' : 'movie');
                        handleContentClick(contentId, contentType, name, cover, itemRating);
                    }}
                    style={{
                        textDecoration: 'none',
                        display: 'block',
                        cursor: 'pointer'
                    }}
                >
                    <div style={{
                        aspectRatio: '2/3',
                        borderRadius: '12px 12px 0 0',
                        position: 'relative',
                        background: 'linear-gradient(135deg, rgba(30,30,50,1) 0%, rgba(50,50,80,1) 100%)',
                        overflow: 'hidden'
                    }}>
                        {/* Image with native lazy loading */}
                        <img
                            src={cover}
                            alt={name}
                            loading="lazy"
                            style={{
                                position: 'absolute',
                                inset: 0,
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                            }}
                        />

                        {/* Hover Preview Overlay */}
                        <div
                            className="preview-overlay"
                            style={{
                                position: 'absolute',
                                inset: 0,
                                background: 'linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.95) 100%)',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'flex-end',
                                padding: 12,
                                borderRadius: '12px 12px 0 0'
                            }}>
                            {/* Play button */}
                            <div style={{
                                position: 'absolute',
                                top: '40%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                width: 48,
                                height: 48,
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, #a855f7, #ec4899)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 18,
                                color: 'white',
                                boxShadow: '0 4px 20px rgba(168, 85, 247, 0.5)'
                            }}>▶</div>

                            {/* Rating badge */}
                            {itemRating && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    marginBottom: 6
                                }}>
                                    <span style={{ fontSize: 12 }}>⭐</span>
                                    <span style={{
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: '#fbbf24'
                                    }}>{itemRating}</span>
                                </div>
                            )}

                            {/* Type and time info */}
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <div style={{
                                    display: 'inline-flex',
                                    padding: '3px 8px',
                                    background: type === 'series' || (isContinue && continueItem.type === 'series')
                                        ? 'rgba(139, 92, 246, 0.8)'
                                        : 'rgba(59, 130, 246, 0.8)',
                                    borderRadius: 4,
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: 'white'
                                }}>
                                    {type === 'series' || (isContinue && continueItem.type === 'series') ? t('home', 'series') : t('home', 'movie')}
                                </div>
                                {isContinue && continueItem.movieProgress && (
                                    <div style={{
                                        display: 'inline-flex',
                                        padding: '3px 8px',
                                        background: 'rgba(16, 185, 129, 0.8)',
                                        borderRadius: 4,
                                        fontSize: 10,
                                        fontWeight: 600,
                                        color: 'white'
                                    }}>
                                        {formatProgress(continueItem.movieProgress.currentTime, continueItem.movieProgress.duration)}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Progress bar for continue watching */}
                        {showProgress && progress !== undefined && (
                            <div style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: 4,
                                background: 'rgba(0, 0, 0, 0.6)'
                            }}>
                                <div style={{
                                    height: '100%',
                                    width: `${progress}%`,
                                    background: 'linear-gradient(90deg, #a855f7, #ec4899)',
                                    borderRadius: 2
                                }} />
                            </div>
                        )}

                        {/* Series episode info */}
                        {isContinue && continueItem.type === 'series' && continueItem.progress && (
                            <div style={{
                                position: 'absolute',
                                bottom: 8,
                                left: 8,
                                right: 8,
                                background: 'rgba(0, 0, 0, 0.85)',
                                borderRadius: 6,
                                padding: '5px 8px',
                                fontSize: 10,
                                fontWeight: 600,
                                color: 'white'
                            }}>
                                T{continueItem.progress.lastWatchedSeason} E{continueItem.progress.lastWatchedEpisode}
                            </div>
                        )}

                        {/* New Episode badge */}
                        {isContinue && continueItem.hasNewEpisode && (
                            <div style={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                background: 'linear-gradient(135deg, #10b981, #059669)',
                                borderRadius: 4,
                                padding: '4px 8px',
                                fontSize: 9,
                                fontWeight: 700,
                                color: 'white',
                                textTransform: 'uppercase',
                                animation: 'pulse 2s infinite'
                            }}>
                                {t('home', 'newEpisode')}
                            </div>
                        )}
                    </div>
                    <div style={{
                        padding: '10px 12px',
                        background: 'linear-gradient(180deg, rgba(15, 15, 35, 0.9) 0%, rgba(15, 15, 35, 1) 100%)',
                        borderRadius: '0 0 12px 12px'
                    }}>
                        <div style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: 'white',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }}>{name}</div>
                    </div>
                </div>
            </div>
        );
    };

    // Carousel Section component with drag scroll
    const ContentSection = ({ title, items, type, showProgress = false, sectionIndex = 0 }: {
        title: string;
        items: any[];
        type: 'continue' | 'series' | 'movie' | 'recommendations';
        showProgress?: boolean;
        sectionIndex?: number;
    }) => {
        const containerRef = useRef<HTMLDivElement>(null);

        // Filter out hidden items for Kids profile
        // Helper to normalize names (same as indexedDBCache)
        const normalizeName = (name: string) => name.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ');

        const visibleItems = isKidsProfile ? items.filter(item => {
            const isContinue = type === 'continue';
            const isSeriesItem = type === 'series' || type === 'recommendations';

            // Get name from item
            const itemName = isContinue ? (item as ContinueWatchingItem).name :
                isSeriesItem ? (item as SeriesData).name : (item as MovieData).name;
            const contentType = isContinue ? (item as ContinueWatchingItem).type :
                (type === 'series' || (type === 'recommendations' && 'series_id' in item) ? 'series' : 'movie');

            const itemKey = `${contentType}_${normalizeName(itemName)}`;
            return !hiddenItems.has(itemKey);
        }) : items;

        if (visibleItems.length === 0) return null;

        const scroll = (direction: 'left' | 'right') => {
            const container = containerRef.current;
            if (!container) return;
            const scrollAmount = 340; // ~2 cards
            const newPosition = direction === 'left'
                ? Math.max(0, container.scrollLeft - scrollAmount)
                : container.scrollLeft + scrollAmount;
            container.scrollTo({ left: newPosition, behavior: 'smooth' });
        };

        return (
            <div
                style={{
                    marginBottom: 32,
                    position: 'relative',
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? 'translateY(0)' : 'translateY(30px)',
                    transition: `all 0.6s ease ${sectionIndex * 0.15}s`
                }}
            >
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16
                }}>
                    <h2 style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        margin: 0
                    }}>
                        {title}
                        <span style={{
                            fontSize: 12,
                            color: 'rgba(255, 255, 255, 0.5)',
                            fontWeight: 400
                        }}>({visibleItems.length})</span>
                    </h2>

                    {/* Navigation arrows */}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            onClick={() => scroll('left')}
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: '50%',
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                color: 'white',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 16,
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.4)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                        >
                            ←
                        </button>
                        <button
                            onClick={() => scroll('right')}
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: '50%',
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                color: 'white',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 16,
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.4)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                        >
                            →
                        </button>
                    </div>
                </div>

                {/* Carousel container */}
                <div
                    ref={containerRef}
                    style={{
                        display: 'flex',
                        gap: 16,
                        overflowX: 'auto',
                        overflowY: 'visible',
                        paddingBottom: 16,
                        paddingTop: 8,
                        scrollBehavior: 'smooth',
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none'
                    }}
                >
                    {visibleItems.slice(0, 30).map((item, index) => {
                        const isSeries = 'series_id' in item;
                        const isContinueItem = type === 'continue';
                        const continueItem = item as ContinueWatchingItem;
                        const itemId = isContinueItem
                            ? continueItem.id
                            : (isSeries ? (item as SeriesData).series_id : (item as MovieData).stream_id);
                        const cardType = type === 'recommendations'
                            ? (isSeries ? 'series' : 'movie')
                            : type === 'continue' ? type : type;

                        return (
                            <ContentCard
                                key={`${type}-${itemId}-${index}`}
                                item={item}
                                type={cardType as 'continue' | 'series' | 'movie'}
                                showProgress={showProgress}
                                rating={isSeries ? (item as SeriesData).rating : (item as MovieData).rating}
                                onRemove={isContinueItem ? () => removeFromContinue(continueItem.id, continueItem.type) : undefined}
                            />
                        );
                    })}
                </div>

                {/* Gradient fade edges */}
                <div style={{
                    position: 'absolute',
                    top: 48,
                    left: 0,
                    width: 40,
                    height: 'calc(100% - 48px)',
                    background: 'linear-gradient(90deg, rgba(15, 15, 35, 1) 0%, transparent 100%)',
                    pointerEvents: 'none',
                    opacity: 0.5,
                    transition: 'opacity 0.3s'
                }} />
                <div style={{
                    position: 'absolute',
                    top: 48,
                    right: 0,
                    width: 40,
                    height: 'calc(100% - 48px)',
                    background: 'linear-gradient(270deg, rgba(15, 15, 35, 1) 0%, transparent 100%)',
                    pointerEvents: 'none'
                }} />
            </div>
        );
    };

    return (
        <>
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                #carousel-continue::-webkit-scrollbar,
                #carousel-series::-webkit-scrollbar,
                #carousel-movie::-webkit-scrollbar,
                #carousel-recommendations::-webkit-scrollbar {
                    display: none;
                }
                .content-card {
                    transform: scale(1);
                    box-shadow: none;
                    z-index: 1;
                    transition: all 0.3s ease;
                }
                .content-card:hover {
                    transform: scale(1.08);
                    box-shadow: 0 15px 40px rgba(0, 0, 0, 0.5);
                    z-index: 100;
                }
                .content-card .preview-overlay {
                    opacity: 0;
                    transition: opacity 0.3s;
                }
                .content-card:hover .preview-overlay {
                    opacity: 1;
                }
                .content-card .remove-btn {
                    opacity: 0;
                    transition: opacity 0.2s;
                }
                .content-card:hover .remove-btn {
                    opacity: 1;
                }
                .kids-block-toast {
                    position: fixed;
                    bottom: 30px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: linear-gradient(135deg, rgba(239, 68, 68, 0.95) 0%, rgba(185, 28, 28, 0.95) 100%);
                    color: white;
                    padding: 16px 32px;
                    border-radius: 16px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-weight: 600;
                    box-shadow: 0 8px 32px rgba(239, 68, 68, 0.4);
                    z-index: 10000;
                    animation: toastSlideUp 0.3s ease, toastFadeOut 0.5s ease 2.5s forwards;
                }
                @keyframes toastSlideUp {
                    from { transform: translateX(-50%) translateY(100px); opacity: 0; }
                    to { transform: translateX(-50%) translateY(0); opacity: 1; }
                }
                @keyframes toastFadeOut {
                    to { opacity: 0; transform: translateX(-50%) translateY(20px); }
                }
                .content-card.checking {
                    opacity: 0.6;
                    pointer-events: none;
                }
            `}</style>

            {/* Kids Block Toast */}
            {blockMessage && (
                <div className="kids-block-toast">
                    <span style={{ fontSize: '24px' }}>🔒</span>
                    <span>{blockMessage}</span>
                </div>
            )}
            <div style={{
                minHeight: '100vh',
                background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)',
                padding: '40px 40px 40px 40px',
                position: 'relative',
                overflow: 'auto'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'fixed',
                    top: '-200px',
                    right: '-200px',
                    width: '600px',
                    height: '600px',
                    background: 'radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%)',
                    borderRadius: '50%',
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'fixed',
                    bottom: '-150px',
                    left: '-150px',
                    width: '400px',
                    height: '400px',
                    background: 'radial-gradient(circle, rgba(139, 92, 246, 0.08) 0%, transparent 70%)',
                    borderRadius: '50%',
                    pointerEvents: 'none'
                }} />

                {/* Header */}
                <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <div style={{
                            fontSize: '13px',
                            color: 'rgba(156, 163, 175, 1)',
                            marginBottom: '6px',
                            textTransform: 'capitalize'
                        }}>
                            {formatDate(currentTime)}
                        </div>
                        <h1 style={{
                            fontSize: '36px',
                            fontWeight: '700',
                            background: 'linear-gradient(135deg, #ffffff 0%, #94a3b8 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            marginBottom: '6px'
                        }}>
                            {getGreeting()}! 👋
                        </h1>
                        <p style={{
                            fontSize: '14px',
                            color: 'rgba(156, 163, 175, 1)'
                        }}>
                            {t('home', 'whatToWatch')}
                        </p>
                    </div>

                    {/* Clock */}
                    <div style={{ textAlign: 'right' }}>
                        <div style={{
                            fontSize: '48px',
                            fontWeight: '300',
                            color: 'white',
                            letterSpacing: '-2px',
                            lineHeight: 1
                        }}>
                            {formatTime(currentTime)}
                        </div>
                    </div>
                </div>

                {/* Stats Cards */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '16px',
                    marginBottom: '32px',
                    maxWidth: '700px'
                }}>
                    {/* Live TV Card */}
                    <a href="#/dashboard/live" style={{
                        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.05) 100%)',
                        borderRadius: '16px',
                        padding: '20px',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        cursor: 'pointer'
                    }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-4px)';
                            e.currentTarget.style.boxShadow = '0 20px 40px rgba(239, 68, 68, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}>
                        <div style={{ fontSize: '28px', marginBottom: '8px' }}>📺</div>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: 'white', marginBottom: '2px' }}>
                            {loading ? '...' : filteredCounts.live.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '12px', color: 'rgba(239, 68, 68, 0.9)', fontWeight: '600' }}>
                            {t('home', 'channels')}
                        </div>
                    </a>

                    {/* VOD Card */}
                    <a href="#/dashboard/vod" style={{
                        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)',
                        borderRadius: '16px',
                        padding: '20px',
                        border: '1px solid rgba(59, 130, 246, 0.2)',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        cursor: 'pointer'
                    }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-4px)';
                            e.currentTarget.style.boxShadow = '0 20px 40px rgba(59, 130, 246, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}>
                        <div style={{ fontSize: '28px', marginBottom: '8px' }}>🎬</div>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: 'white', marginBottom: '2px' }}>
                            {loading ? '...' : filteredCounts.vod.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '12px', color: 'rgba(59, 130, 246, 0.9)', fontWeight: '600' }}>
                            {t('home', 'movies')}
                        </div>
                    </a>

                    {/* Series Card */}
                    <a href="#/dashboard/series" style={{
                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0.05) 100%)',
                        borderRadius: '16px',
                        padding: '20px',
                        border: '1px solid rgba(139, 92, 246, 0.2)',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        cursor: 'pointer'
                    }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-4px)';
                            e.currentTarget.style.boxShadow = '0 20px 40px rgba(139, 92, 246, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}>
                        <div style={{ fontSize: '28px', marginBottom: '8px' }}>📺</div>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: 'white', marginBottom: '2px' }}>
                            {loading ? '...' : filteredCounts.series.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '12px', color: 'rgba(139, 92, 246, 0.9)', fontWeight: '600' }}>
                            {t('home', 'seriesCount')}
                        </div>
                    </a>
                </div>

                {/* Continue Watching Section */}
                <ContentSection
                    title={`⏯️ ${t('home', 'continueWatching')}`}
                    items={continueWatching}
                    type="continue"
                    showProgress={true}
                    sectionIndex={0}
                />

                {/* Recommendations Section */}
                <ContentSection
                    title={`💡 ${t('home', 'recommendations')}`}
                    items={recommendations}
                    type="recommendations"
                    sectionIndex={1}
                />

                {/* Recently Added Series */}
                <ContentSection
                    title={`🆕 ${t('home', 'recentSeries')}`}
                    items={recentSeries}
                    type="series"
                    sectionIndex={2}
                />

                {/* Recently Added Movies */}
                <ContentSection
                    title={`🎬 ${t('home', 'recentMovies')}`}
                    items={recentMovies}
                    type="movie"
                    sectionIndex={3}
                />

                {/* Quick Access */}
                <div style={{ marginTop: 40 }}>
                    <h2 style={{
                        fontSize: '16px',
                        fontWeight: '600',
                        color: 'white',
                        marginBottom: '16px'
                    }}>
                        {t('home', 'quickAccess')}
                    </h2>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(7, 1fr)',
                        gap: '12px',
                        maxWidth: '900px'
                    }}>
                        <a href="#/dashboard/live" style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '10px',
                            padding: '16px',
                            textAlign: 'center',
                            textDecoration: 'none',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            transition: 'all 0.2s'
                        }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                        >
                            <div style={{ fontSize: '24px', marginBottom: '6px' }}>🔴</div>
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>{t('home', 'liveTV')}</div>
                        </a>
                        <a href="#/dashboard/vod" style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '10px',
                            padding: '16px',
                            textAlign: 'center',
                            textDecoration: 'none',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            transition: 'all 0.2s'
                        }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                        >
                            <div style={{ fontSize: '24px', marginBottom: '6px' }}>🎥</div>
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>{t('home', 'movies')}</div>
                        </a>
                        <a href="#/dashboard/series" style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '10px',
                            padding: '16px',
                            textAlign: 'center',
                            textDecoration: 'none',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            transition: 'all 0.2s'
                        }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                        >
                            <div style={{ fontSize: '24px', marginBottom: '6px' }}>📺</div>
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>{t('home', 'seriesCount')}</div>
                        </a>
                        <a href="#/dashboard/watch-later" style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '10px',
                            padding: '16px',
                            textAlign: 'center',
                            textDecoration: 'none',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            transition: 'all 0.2s'
                        }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                        >
                            <div style={{ fontSize: '24px', marginBottom: '6px' }}>🔖</div>
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>{t('home', 'myList')}</div>
                        </a>
                        <a href="#/dashboard/favorites" style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '10px',
                            padding: '16px',
                            textAlign: 'center',
                            textDecoration: 'none',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            transition: 'all 0.2s'
                        }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                        >
                            <div style={{ fontSize: '24px', marginBottom: '6px' }}>❤️</div>
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>{t('home', 'favorites')}</div>
                        </a>
                        <a href="#/dashboard/downloads" style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '10px',
                            padding: '16px',
                            textAlign: 'center',
                            textDecoration: 'none',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            transition: 'all 0.2s'
                        }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(6, 182, 212, 0.15)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                        >
                            <div style={{ fontSize: '24px', marginBottom: '6px' }}>📥</div>
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>{t('home', 'downloaded')}</div>
                        </a>
                        <a href="#/dashboard/settings" style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '10px',
                            padding: '16px',
                            textAlign: 'center',
                            textDecoration: 'none',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            transition: 'all 0.2s'
                        }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                        >
                            <div style={{ fontSize: '24px', marginBottom: '6px' }}>⚙️</div>
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>{t('home', 'settings')}</div>
                        </a>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    marginTop: '60px',
                    paddingTop: '20px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: 'rgba(156, 163, 175, 0.5)',
                    fontSize: '11px'
                }}>
                    <span>NeoStream IPTV</span>
                    <span>v2.3.0</span>
                </div>
            </div>

            {/* Content Detail Modal */}
            {selectedContent && (
                <ContentDetailModal
                    isOpen={!!selectedContent}
                    onClose={() => setSelectedContent(null)}
                    contentId={selectedContent.id}
                    contentType={selectedContent.type}
                    contentData={selectedContent}
                    onPlay={(season, episode) => {
                        // Check for existing progress
                        if (selectedContent) {
                            if (selectedContent.type === 'series') {
                                const progress = watchProgressService.getEpisodeProgress(
                                    selectedContent.id,
                                    season || 1,
                                    episode || 1
                                );
                                const progressPercent = progress ? Math.round((progress.currentTime / progress.duration) * 100) : 0;

                                if (progress && progress.currentTime > 10 && progressPercent < 95) {
                                    // Show resume modal
                                    setPendingPlay({
                                        id: selectedContent.id,
                                        type: 'series',
                                        name: selectedContent.name,
                                        season: season,
                                        episode: episode,
                                        currentTime: progress.currentTime,
                                        duration: progress.duration
                                    });
                                    setShowResumeModal(true);
                                    setSelectedContent(null);
                                } else {
                                    // No progress, play directly
                                    setPlayingContent({
                                        id: selectedContent.id,
                                        type: 'series',
                                        name: selectedContent.name,
                                        season: season,
                                        episode: episode
                                    });
                                    setSelectedContent(null);
                                }
                            } else {
                                // Movie - auto resume without modal
                                const movieProgress = movieProgressService.getMoviePositionById(selectedContent.id);

                                // Always play, with resumeTime if exists
                                setPlayingContent({
                                    id: selectedContent.id,
                                    type: 'movie',
                                    name: selectedContent.name,
                                    resumeTime: movieProgress?.currentTime || 0
                                });
                                setSelectedContent(null);
                            }
                        }
                    }}
                />
            )}

            {/* Video Player */}
            {playingContent && (
                <AsyncVideoPlayer
                    movie={playingContent}
                    buildStreamUrl={async (content) => {
                        const result = await window.ipcRenderer.invoke('auth:get-credentials');
                        if (result.success) {
                            const { url, username, password } = result.credentials;
                            if (content.type === 'series') {
                                // Fetch episode info for series
                                const seriesInfoRes = await fetch(`${url}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${content.id}`);
                                const seriesInfo = await seriesInfoRes.json();
                                const episodes = seriesInfo?.episodes?.[content.season || 1];
                                const episode = episodes?.find((ep: any) => Number(ep.episode_num) === (content.episode || 1));
                                if (episode) {
                                    const ext = episode.container_extension || 'mp4';
                                    return `${url}/series/${username}/${password}/${episode.id}.${ext}`;
                                }
                                throw new Error('Episode not found');
                            } else {
                                // Movie stream
                                const movieInfoRes = await fetch(`${url}/player_api.php?username=${username}&password=${password}&action=get_vod_info&vod_id=${content.id}`);
                                const movieInfo = await movieInfoRes.json();
                                const ext = movieInfo?.movie_data?.container_extension || 'mp4';
                                return `${url}/movie/${username}/${password}/${content.id}.${ext}`;
                            }
                        }
                        throw new Error('Credentials not found');
                    }}
                    onClose={() => {
                        setPlayingContent(null);
                        // Refresh continue watching list to show updated progress
                        setRefreshTrigger(prev => prev + 1);
                    }}
                    customTitle={playingContent.type === 'series'
                        ? `${playingContent.name} - T${playingContent.season} E${playingContent.episode}`
                        : playingContent.name
                    }
                    seriesId={playingContent.type === 'series' ? playingContent.id : undefined}
                    seasonNumber={playingContent.season}
                    episodeNumber={playingContent.episode}
                    resumeTime={playingContent.resumeTime || null}
                />
            )}

            {/* Resume Modal */}
            {showResumeModal && pendingPlay && (
                <ResumeModal
                    seriesName={pendingPlay.name}
                    seasonNumber={pendingPlay.season || 1}
                    episodeNumber={pendingPlay.episode || 1}
                    currentTime={pendingPlay.currentTime}
                    duration={pendingPlay.duration}
                    onResume={() => {
                        setPlayingContent({
                            id: pendingPlay.id,
                            type: pendingPlay.type,
                            name: pendingPlay.name,
                            season: pendingPlay.season,
                            episode: pendingPlay.episode,
                            resumeTime: pendingPlay.currentTime
                        });
                        setShowResumeModal(false);
                        setPendingPlay(null);
                    }}
                    onRestart={() => {
                        setPlayingContent({
                            id: pendingPlay.id,
                            type: pendingPlay.type,
                            name: pendingPlay.name,
                            season: pendingPlay.season,
                            episode: pendingPlay.episode,
                            resumeTime: 0
                        });
                        setShowResumeModal(false);
                        setPendingPlay(null);
                    }}
                    onCancel={() => {
                        setShowResumeModal(false);
                        setPendingPlay(null);
                    }}
                />
            )}
        </>
    );
}
