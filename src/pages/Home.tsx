import { useState, useEffect, useRef } from 'react';
import { watchProgressService, type SeriesProgress } from '../services/watchProgressService';
import { movieProgressService } from '../services/movieProgressService';

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

        // Update time every second
        const interval = setInterval(() => setCurrentTime(new Date()), 1000);
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
    }, [allSeries, allMovies]);

    // Build recommendations based on watched categories
    useEffect(() => {
        if (continueWatching.length === 0 || (allSeries.length === 0 && allMovies.length === 0)) return;

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

        // Shuffle and limit
        const shuffled = recs.sort(() => Math.random() - 0.5);
        setRecommendations(shuffled.slice(0, 30));
    }, [continueWatching, allSeries, allMovies]);

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });
    };

    const getGreeting = () => {
        const hour = currentTime.getHours();
        if (hour < 12) return 'Bom dia';
        if (hour < 18) return 'Boa tarde';
        return 'Boa noite';
    };

    const formatProgress = (currentTime: number, duration: number) => {
        const remaining = Math.max(0, duration - currentTime);
        const minutes = Math.floor(remaining / 60);
        if (minutes < 60) return `${minutes}min restantes`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}min restantes`;
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

    // Content card component with hover preview, lazy loading, remove button
    const ContentCard = ({ item, type, showProgress = false, rating, onRemove }: {
        item: ContinueWatchingItem | SeriesData | MovieData;
        type: 'continue' | 'series' | 'movie';
        showProgress?: boolean;
        rating?: string;
        onRemove?: () => void;
    }) => {
        const [showPreview, setShowPreview] = useState(false);
        const [imageLoaded, setImageLoaded] = useState(false);
        const [imageError, setImageError] = useState(false);
        const imgRef = useRef<HTMLImageElement>(null);

        const isContinue = type === 'continue';
        const continueItem = item as ContinueWatchingItem;
        const seriesItem = item as SeriesData;
        const movieItem = item as MovieData;

        const cover = isContinue ? continueItem.cover :
            type === 'series' ? seriesItem.cover :
                (movieItem.cover || movieItem.stream_icon);
        const name = isContinue ? continueItem.name :
            type === 'series' ? seriesItem.name : movieItem.name;

        // Direct navigation - go to specific content
        const getDirectLink = () => {
            if (isContinue) {
                return continueItem.type === 'series'
                    ? `#/dashboard/series?id=${continueItem.id}`
                    : `#/dashboard/vod?id=${continueItem.id}`;
            }
            return type === 'series'
                ? `#/dashboard/series?id=${seriesItem.series_id}`
                : `#/dashboard/vod?id=${movieItem.stream_id}`;
        };

        const itemRating = rating || (type === 'series' ? seriesItem.rating : movieItem.rating);

        const progress = isContinue && continueItem.type === 'movie'
            ? continueItem.movieProgress?.progress
            : undefined;

        // Lazy loading with IntersectionObserver
        useEffect(() => {
            const img = imgRef.current;
            if (!img || !cover) return;

            const observer = new IntersectionObserver(
                (entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            img.src = cover;
                            observer.disconnect();
                        }
                    });
                },
                { rootMargin: '100px' }
            );

            observer.observe(img);
            return () => observer.disconnect();
        }, [cover]);

        return (
            <div
                style={{
                    position: 'relative',
                    minWidth: 160,
                    maxWidth: 160,
                    borderRadius: '12px',
                    overflow: 'visible',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    transition: 'all 0.3s ease',
                    flexShrink: 0
                }}
                onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)';
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 15px 40px rgba(0, 0, 0, 0.5)';
                    (e.currentTarget as HTMLElement).style.zIndex = '100';
                    setShowPreview(true);
                }}
                onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                    (e.currentTarget as HTMLElement).style.zIndex = '1';
                    setShowPreview(false);
                }}
            >
                {/* Remove button for continue watching */}
                {isContinue && showPreview && (
                    <button
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
                            zIndex: 150,
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        title="Remover de Continue Assistindo"
                    >
                        ✕
                    </button>
                )}

                <a
                    href={getDirectLink()}
                    style={{
                        textDecoration: 'none',
                        display: 'block'
                    }}
                >
                    <div style={{
                        aspectRatio: '2/3',
                        borderRadius: '12px 12px 0 0',
                        position: 'relative',
                        background: imageLoaded ? 'transparent' : 'linear-gradient(135deg, rgba(30,30,50,1) 0%, rgba(50,50,80,1) 100%)',
                        overflow: 'hidden'
                    }}>
                        {/* Lazy loaded image */}
                        <img
                            ref={imgRef}
                            alt={name}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                opacity: imageLoaded ? 1 : 0,
                                transition: 'opacity 0.3s'
                            }}
                            onLoad={() => setImageLoaded(true)}
                            onError={() => setImageError(true)}
                        />

                        {/* Loading shimmer */}
                        {!imageLoaded && !imageError && (
                            <div style={{
                                position: 'absolute',
                                inset: 0,
                                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)',
                                animation: 'shimmer 1.5s infinite'
                            }} />
                        )}

                        {/* Hover Preview Overlay */}
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.95) 100%)',
                            opacity: showPreview ? 1 : 0,
                            transition: 'opacity 0.3s',
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
                                    {type === 'series' || (isContinue && continueItem.type === 'series') ? 'SÉRIE' : 'FILME'}
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
                                S{continueItem.progress.lastWatchedSeason} E{continueItem.progress.lastWatchedEpisode}
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
                                Novo Ep!
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
                </a>
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
        const [scrollPosition, setScrollPosition] = useState(0);
        const containerRef = useRef<HTMLDivElement>(null);

        if (items.length === 0) return null;

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
                        }}>({items.length})</span>
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
                    onScroll={(e) => setScrollPosition(e.currentTarget.scrollLeft)}
                >
                    {items.slice(0, 30).map((item, index) => {
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
                    opacity: scrollPosition > 0 ? 1 : 0,
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
            `}</style>
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
                            O que você quer assistir hoje?
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
                            {loading ? '...' : counts.live.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '12px', color: 'rgba(239, 68, 68, 0.9)', fontWeight: '600' }}>
                            Canais ao Vivo
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
                            {loading ? '...' : counts.vod.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '12px', color: 'rgba(59, 130, 246, 0.9)', fontWeight: '600' }}>
                            Filmes
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
                            {loading ? '...' : counts.series.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '12px', color: 'rgba(139, 92, 246, 0.9)', fontWeight: '600' }}>
                            Séries
                        </div>
                    </a>
                </div>

                {/* Continue Watching Section */}
                <ContentSection
                    title="⏯️ Continue Assistindo"
                    items={continueWatching}
                    type="continue"
                    showProgress={true}
                    sectionIndex={0}
                />

                {/* Recommendations Section */}
                <ContentSection
                    title="💡 Recomendados Para Você"
                    items={recommendations}
                    type="recommendations"
                    sectionIndex={1}
                />

                {/* Recently Added Series */}
                <ContentSection
                    title="🆕 Séries Adicionadas"
                    items={recentSeries}
                    type="series"
                    sectionIndex={2}
                />

                {/* Recently Added Movies */}
                <ContentSection
                    title="🎬 Filmes Adicionados"
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
                        Acesso Rápido
                    </h2>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: '12px',
                        maxWidth: '600px'
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
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>TV ao Vivo</div>
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
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>Filmes</div>
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
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>Séries</div>
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
                            <div style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>Configurações</div>
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
                    <span>v1.0.0</span>
                </div>
            </div>
        </>
    );
}
