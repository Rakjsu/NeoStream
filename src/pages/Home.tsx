import { useState, useEffect } from 'react';
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
}

interface MovieData {
    stream_id: number;
    name: string;
    stream_icon: string;
    cover?: string;
    rating?: string;
    category_id?: string;
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

export function Home() {
    const [counts, setCounts] = useState<ContentCounts>({ live: 0, vod: 0, series: 0 });
    const [loading, setLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [continueWatching, setContinueWatching] = useState<ContinueWatchingItem[]>([]);
    const [recentSeries, setRecentSeries] = useState<SeriesData[]>([]);
    const [recentMovies, setRecentMovies] = useState<MovieData[]>([]);
    const [allSeries, setAllSeries] = useState<SeriesData[]>([]);
    const [allMovies, setAllMovies] = useState<MovieData[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch counts
                const countResult = await window.ipcRenderer.invoke('content:get-counts');
                if (countResult.success && countResult.counts) {
                    setCounts({
                        live: countResult.counts.live || 0,
                        vod: countResult.counts.vod || 0,
                        series: countResult.counts.series || 0
                    });
                }

                // Fetch series data
                const seriesResult = await window.ipcRenderer.invoke('streams:get-series');
                if (seriesResult.success && seriesResult.data) {
                    setAllSeries(seriesResult.data);
                    // Get most recent 30 series (assuming they come in order)
                    setRecentSeries(seriesResult.data.slice(0, 30));
                }

                // Fetch movies data
                const moviesResult = await window.ipcRenderer.invoke('streams:get-vod');
                if (moviesResult.success && moviesResult.data) {
                    setAllMovies(moviesResult.data);
                    // Get most recent 30 movies
                    setRecentMovies(moviesResult.data.slice(0, 30));
                }
            } catch (error) {
                console.error('Failed to fetch data:', error);
            } finally {
                setLoading(false);
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

    // Content card component with hover preview
    const ContentCard = ({ item, type, showProgress = false, rating }: {
        item: ContinueWatchingItem | SeriesData | MovieData;
        type: 'continue' | 'series' | 'movie';
        showProgress?: boolean;
        rating?: string;
    }) => {
        const [showPreview, setShowPreview] = useState(false);
        const isContinue = type === 'continue';
        const continueItem = item as ContinueWatchingItem;
        const seriesItem = item as SeriesData;
        const movieItem = item as MovieData;

        const cover = isContinue ? continueItem.cover :
            type === 'series' ? seriesItem.cover :
                (movieItem.cover || movieItem.stream_icon);
        const name = isContinue ? continueItem.name :
            type === 'series' ? seriesItem.name : movieItem.name;
        const href = isContinue ?
            (continueItem.type === 'series' ? '#/dashboard/series' : '#/dashboard/vod') :
            (type === 'series' ? '#/dashboard/series' : '#/dashboard/vod');
        const itemRating = rating || (type === 'series' ? seriesItem.rating : movieItem.rating);

        const progress = isContinue && continueItem.type === 'movie'
            ? continueItem.movieProgress?.progress
            : undefined;

        return (
            <a
                href={href}
                style={{
                    position: 'relative',
                    minWidth: 160,
                    maxWidth: 160,
                    borderRadius: '12px',
                    overflow: 'visible',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    textDecoration: 'none',
                    transition: 'all 0.3s ease',
                    display: 'block',
                    flexShrink: 0
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.08)';
                    e.currentTarget.style.boxShadow = '0 15px 40px rgba(0, 0, 0, 0.5)';
                    e.currentTarget.style.zIndex = '100';
                    setShowPreview(true);
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.zIndex = '1';
                    setShowPreview(false);
                }}
            >
                <div style={{
                    aspectRatio: '2/3',
                    background: `url(${cover}) center/cover`,
                    borderRadius: '12px 12px 0 0',
                    position: 'relative'
                }}>
                    {/* Hover Preview Overlay */}
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.95) 100%)',
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
                            top: '50%',
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

                        {/* Type badge */}
                        <div style={{
                            display: 'inline-flex',
                            padding: '3px 8px',
                            background: type === 'series' || (isContinue && continueItem.type === 'series')
                                ? 'rgba(139, 92, 246, 0.8)'
                                : 'rgba(59, 130, 246, 0.8)',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 600,
                            color: 'white',
                            width: 'fit-content'
                        }}>
                            {type === 'series' || (isContinue && continueItem.type === 'series') ? 'SÉRIE' : 'FILME'}
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
                    {showProgress && continueItem.movieProgress && (
                        <div style={{
                            fontSize: 10,
                            color: 'rgba(255, 255, 255, 0.6)',
                            marginTop: 4
                        }}>
                            {formatProgress(continueItem.movieProgress.currentTime, continueItem.movieProgress.duration)}
                        </div>
                    )}
                </div>
            </a>
        );
    };

    // Carousel Section component
    const ContentSection = ({ title, items, type, showProgress = false }: {
        title: string;
        items: any[];
        type: 'continue' | 'series' | 'movie';
        showProgress?: boolean;
    }) => {
        const [scrollPosition, setScrollPosition] = useState(0);

        if (items.length === 0) return null;

        const scroll = (direction: 'left' | 'right') => {
            const container = document.getElementById(`carousel-${type}`);
            if (!container) return;
            const scrollAmount = 340; // ~2 cards
            const newPosition = direction === 'left'
                ? Math.max(0, scrollPosition - scrollAmount)
                : scrollPosition + scrollAmount;
            container.scrollTo({ left: newPosition, behavior: 'smooth' });
            setScrollPosition(newPosition);
        };

        return (
            <div style={{ marginBottom: 32, position: 'relative' }}>
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
                    id={`carousel-${type}`}
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
                    {items.slice(0, 30).map((item) => (
                        <ContentCard
                            key={type === 'continue' ? (item as ContinueWatchingItem).id :
                                type === 'series' ? (item as SeriesData).series_id :
                                    (item as MovieData).stream_id}
                            item={item}
                            type={type}
                            showProgress={showProgress}
                            rating={type === 'series' ? (item as SeriesData).rating : (item as MovieData).rating}
                        />
                    ))}
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
                #carousel-continue::-webkit-scrollbar,
                #carousel-series::-webkit-scrollbar,
                #carousel-movie::-webkit-scrollbar {
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
                />

                {/* Recently Added Series */}
                <ContentSection
                    title="🆕 Séries Adicionadas"
                    items={recentSeries}
                    type="series"
                />

                {/* Recently Added Movies */}
                <ContentSection
                    title="🎬 Filmes Adicionados"
                    items={recentMovies}
                    type="movie"
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
