import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchMovieDetails, searchMovieByName, type TMDBMovieDetails, getBackdropUrl } from '../services/tmdb';
import { watchLaterService } from '../services/watchLater';
import { favoritesService } from '../services/favoritesService';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { AnimatedSearchBar } from '../components/AnimatedSearchBar';
import { CategoryMenu } from '../components/CategoryMenu';
import { movieProgressService } from '../services/movieProgressService';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { profileService } from '../services/profileService';
import { indexedDBCache } from '../services/indexedDBCache';
import { downloadService } from '../services/downloadService';
import { searchMovieByName as searchMovie, isKidsFriendly } from '../services/tmdb';
import { parentalService } from '../services/parentalService';
import { HoverPreviewCard, closeAllPreviews } from '../components/HoverPreviewCard';
import { useLanguage } from '../services/languageService';

interface VODStream {
    num: number;
    name: string;
    stream_type: string;
    stream_id: number;
    container_extension: string;
    custom_sid: string;
    direct_source: string;
    added: string;
    category_id: string;
    rating: string;
    rating_5based: number;
    backdrop_path: string[];
    youtube_trailer: string;
    episode_run_time: string;
    stream_icon: string;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    release_date: string;
    tmdb_id: string;
    offlineUrl?: string;
}

// Dynamic card sizing based on container
const CARD_MIN_WIDTH = 180;
const CARD_GAP = 24;

export function VOD() {
    const [streams, setStreams] = useState<VODStream[]>([]);
    const [_categories, setCategories] = useState<Array<{ category_id: string; category_name: string; parent_id: number }>>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
    const [selectedMovie, setSelectedMovie] = useState<VODStream | null>(null);
    const [tmdbData, setTmdbData] = useState<TMDBMovieDetails | null>(null);
    const [loadingTmdb, setLoadingTmdb] = useState(false);
    const [playingMovie, setPlayingMovie] = useState<VODStream | null>(null);
    const [pipResumeTime, setPipResumeTime] = useState<number | null>(null);
    const [, _setRefresh] = useState(0);
    const [visibleCount, setVisibleCount] = useState(0);
    const [itemsPerPage, setItemsPerPage] = useState(36);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const [hiddenMovies, setHiddenMovies] = useState<Set<string>>(new Set());
    const [blockedCategoryIds, setBlockedCategoryIds] = useState<Set<string>>(new Set());
    const [checkingItem, setCheckingItem] = useState<string | null>(null);
    const [blockMessage, setBlockMessage] = useState<string | null>(null);
    const [cachedRatings, setCachedRatings] = useState<Map<string, string | null>>(new Map());
    const isKidsProfile = profileService.getActiveProfile()?.isKids || false;
    const { t } = useLanguage();

    // Close any open previews when this page mounts
    useEffect(() => {
        closeAllPreviews();
    }, []);

    // Listen for mini player expand event to reopen full player
    useEffect(() => {
        const handleMiniPlayerExpand = (e: CustomEvent) => {
            const { contentId, contentType, currentTime } = e.detail;
            if (contentType === 'movie' && contentId) {
                // Find the movie in our list and set it as playing
                const movie = streams.find((m: VODStream) => m.stream_id.toString() === contentId);
                if (movie) {
                    setPipResumeTime(currentTime || 0);
                    setPlayingMovie(movie);
                }
            }
        };

        window.addEventListener('miniPlayerExpand', handleMiniPlayerExpand as EventListener);
        return () => window.removeEventListener('miniPlayerExpand', handleMiniPlayerExpand as EventListener);
    }, [streams]);

    // Dynamic grid calculation based on window dimensions
    useEffect(() => {
        const calculateGrid = () => {
            // Use window dimensions directly - more reliable
            const availableWidth = window.innerWidth - 100; // sidebar + padding
            const availableHeight = window.innerHeight - 200; // header + details panel buffer

            const cols = Math.max(2, Math.floor(availableWidth / (CARD_MIN_WIDTH + CARD_GAP)));
            const rows = Math.max(3, Math.ceil(availableHeight / 320) + 3); // card height ~280px + gap

            const items = cols * rows;

            setItemsPerPage(items);
            setVisibleCount(items);
        };

        // Initial calculation
        calculateGrid();

        // Recalculate after layout is ready
        setTimeout(calculateGrid, 200);

        // Listen to window resize
        window.addEventListener('resize', calculateGrid);

        return () => {
            window.removeEventListener('resize', calculateGrid);
        };
    }, []);

    useEffect(() => {
        fetchStreams();
        fetchCategories();
    }, []);

    const fetchStreams = async () => {
        setLoading(true);
        setError('');
        try {
            const result = await window.ipcRenderer.invoke('streams:get-vod');
            if (result.success) {
                setStreams(result.data || []);
            } else {
                setError(result.error || 'Failed to load movies');
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to connect to server');
        } finally {
            setLoading(false);
        }
    };

    // Blocked category patterns for Kids profile and Parental Control
    const BLOCKED_CATEGORY_PATTERNS = ['adult', 'adulto', '+18', '18+', 'xxx', 'terror', 'horror', 'erotic', 'erótico'];

    const fetchCategories = async () => {
        try {
            const result = await window.ipcRenderer.invoke('categories:get-vod');
            if (result.success) {
                setCategories(result.data || []);

                // Extract blocked category IDs for Kids profile OR Parental Control
                const parentalConfig = parentalService.getConfig();
                const shouldBlockCategories = isKidsProfile || (parentalConfig.enabled && parentalConfig.blockAdultCategories && !parentalService.isSessionUnlocked());

                if (shouldBlockCategories) {
                    const blockedIds = new Set<string>();
                    (result.data || []).forEach((cat: { category_id: string; category_name: string }) => {
                        const lowerName = cat.category_name.toLowerCase();
                        if (BLOCKED_CATEGORY_PATTERNS.some(p => lowerName.includes(p))) {
                            blockedIds.add(cat.category_id);
                        }
                    });
                    setBlockedCategoryIds(blockedIds);
                } else {
                    setBlockedCategoryIds(new Set());
                }
            }
        } catch (err) {
            console.error('Failed to load categories:', err);
        }
    };

    // Load hidden items from IndexedDB on mount (for Kids profile)
    useEffect(() => {
        if (!isKidsProfile) return;

        const loadHiddenItems = async () => {
            const hidden = await indexedDBCache.getHiddenItems('movie');
            setHiddenMovies(new Set(hidden));
        };
        loadHiddenItems();
    }, [isKidsProfile]);

    // Load cached ratings for parental control filtering
    useEffect(() => {
        const loadCachedRatings = async () => {
            const ratings = await indexedDBCache.getAllCachedMovies();
            setCachedRatings(ratings);
        };
        loadCachedRatings();
    }, [streams]);

    const filteredStreams = streams.filter(stream => {
        const matchesSearch = stream.name.toLowerCase().includes(searchQuery.toLowerCase());
        const normalizedName = stream.name.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ');

        // Parental Control filtering (applies to all profiles)
        if (blockedCategoryIds.has(stream.category_id)) {
            return false;
        }

        // Parental Control: Filter by cached rating
        const parentalConfig = parentalService.getConfig();
        if (parentalConfig.enabled && !parentalService.isSessionUnlocked()) {
            const cachedRating = cachedRatings.get(normalizedName);
            if (cachedRating && parentalService.isContentBlocked(cachedRating)) {
                return false;
            }
        }

        // Kids profile filtering (additional checks)
        if (isKidsProfile) {
            // Block items that have been marked as hidden
            if (hiddenMovies.has(normalizedName)) {
                return false;
            }
        }

        if (selectedCategory === 'CONTINUE_WATCHING') {
            const moviesInProgress = movieProgressService.getMoviesInProgress();
            return matchesSearch && moviesInProgress.includes(stream.stream_id.toString());
        }

        if (selectedCategory === 'WATCHED') {
            const watchedMovies = movieProgressService.getWatchedMovies();
            return matchesSearch && watchedMovies.includes(stream.stream_id.toString());
        }

        const matchesCategory = !selectedCategory || selectedCategory === '' || selectedCategory === 'all' || stream.category_id === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    // Lazy loading scroll handler
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            if (scrollTop + clientHeight >= scrollHeight * 0.85 && visibleCount < filteredStreams.length) {
                setVisibleCount(prev => Math.min(prev + itemsPerPage, filteredStreams.length));
            }
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [filteredStreams.length, visibleCount, itemsPerPage]);

    // Reset on filter change
    useEffect(() => {
        setVisibleCount(itemsPerPage);
        setSelectedMovie(null);
    }, [searchQuery, selectedCategory, itemsPerPage]);

    // Fetch TMDB data
    useEffect(() => {
        if (!selectedMovie) {
            setTmdbData(null);
            return;
        }

        setLoadingTmdb(true);
        const fetchTmdb = async () => {
            try {
                let data: TMDBMovieDetails | null = null;

                // Try by tmdb_id first
                if (selectedMovie.tmdb_id) {
                    data = await fetchMovieDetails(selectedMovie.tmdb_id);
                }

                // Fallback: search by name
                if (!data) {
                    // Extract year from movie name if present (e.g., "Movie Name (2023)")
                    const yearMatch = selectedMovie.name.match(/\((\d{4})\)/);
                    const year = yearMatch ? yearMatch[1] : undefined;
                    data = await searchMovieByName(selectedMovie.name, year);
                }

                setTmdbData(data);
            } catch (err) {
                console.error('Failed to fetch TMDB data:', err);
            } finally {
                setLoadingTmdb(false);
            }
        };
        fetchTmdb();
    }, [selectedMovie]);

    const handleImageError = useCallback((streamId: number) => {
        setBrokenImages(prev => new Set(prev).add(streamId));
    }, []);

    const fixImageUrl = (url: string): string => url?.replace(/\/\/+/g, '/').replace(':/', '://') || '';

    const buildStreamUrl = async (movie: VODStream): Promise<string> => {
        // Check for offline URL first
        if (movie.offlineUrl) {
            return movie.offlineUrl;
        }

        try {
            const result = await window.ipcRenderer.invoke('streams:get-vod-url', {
                streamId: movie.stream_id,
                container: movie.container_extension
            });
            return result.success ? result.url : '';
        } catch (err) {
            console.error('Failed to build stream URL:', err);
            return '';
        }
    };

    const getProgress = (movieId: number) => {
        const progress = movieProgressService.getMoviePositionById(movieId.toString());
        if (!progress || !progress.duration) return 0;
        return Math.round((progress.currentTime / progress.duration) * 100);
    };

    const getMovieProgress = (movieId: number) => {
        return movieProgressService.getMoviePositionById(movieId.toString());
    };

    const formatRemainingTime = (currentTime: number, duration: number) => {
        const remaining = Math.max(0, duration - currentTime);
        const minutes = Math.floor(remaining / 60);
        if (minutes < 60) return `${minutes}min restantes`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}min restantes`;
    };

    // Handle movie card click - check Kids filter and Parental Control, always cache for future use
    const handleMovieClick = async (movie: VODStream) => {
        const normalizedName = movie.name.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ');

        // Check if already hidden for Kids profile
        if (isKidsProfile && hiddenMovies.has(normalizedName)) {
            return;
        }

        // Get parental control config
        const parentalConfig = parentalService.getConfig();
        const isParentalActive = parentalConfig.enabled && !parentalService.isSessionUnlocked();

        // If no restrictions, just open and cache in background
        if (!isKidsProfile && !isParentalActive) {
            setSelectedMovie(movie);

            // Background caching for cross-profile benefit
            (async () => {
                const cached = await indexedDBCache.getCachedMovie(movie.name);
                if (!cached) {
                    const yearMatch = movie.name.match(/\((\d{4})\)/);
                    const year = yearMatch ? yearMatch[1] : undefined;
                    const tmdbResult = await searchMovie(movie.name, year);
                    if (tmdbResult) {
                        await indexedDBCache.setCacheMovie(
                            movie.name,
                            tmdbResult.certification || null,
                            tmdbResult.genres?.map(g => g.name) || []
                        );
                        // If not kids-friendly, hide it for future Kids sessions
                        if (!isKidsFriendly(tmdbResult.certification)) {
                            await indexedDBCache.hideItem('movie', movie.name);
                        }
                    }
                }
            })();
            return;
        }

        // Need to check rating - show loading
        setCheckingItem(movie.name);

        try {
            const cached = await indexedDBCache.getCachedMovie(movie.name);
            let certification: string | null = null;

            if (cached) {
                certification = cached.certification;
            } else {
                const yearMatch = movie.name.match(/\((\d{4})\)/);
                const year = yearMatch ? yearMatch[1] : undefined;
                const tmdbResult = await searchMovie(movie.name, year);

                if (tmdbResult) {
                    certification = tmdbResult.certification || null;
                    await indexedDBCache.setCacheMovie(
                        movie.name,
                        certification,
                        tmdbResult.genres?.map(g => g.name) || []
                    );
                    // Update local cache for immediate filtering
                    setCachedRatings(prev => new Map(prev).set(normalizedName, certification));
                }
            }

            // Check Kids profile restriction
            if (isKidsProfile) {
                if (isKidsFriendly(certification)) {
                    setSelectedMovie(movie);
                } else {
                    setBlockMessage(`"${movie.name}" não está disponível para este perfil`);
                    await indexedDBCache.hideItem('movie', movie.name);
                    setHiddenMovies(prev => new Set(prev).add(normalizedName));
                    setTimeout(() => setBlockMessage(null), 3000);
                }
                return;
            }

            // Check Parental Control restriction
            if (isParentalActive && certification) {
                if (parentalService.isContentBlocked(certification)) {
                    setBlockMessage(`"${movie.name}" está bloqueado pelo controle parental (${certification})`);
                    setTimeout(() => setBlockMessage(null), 3000);
                    return;
                }
            }

            // Allow access
            setSelectedMovie(movie);
        } catch (error) {
            console.error('Error checking movie rating:', error);
            setSelectedMovie(movie);
        } finally {
            setCheckingItem(null);
        }
    };


    // Loading State
    if (loading) return (
        <div className="vod-page">
            <style>{vodStyles}</style>
            <div className="vod-loading">
                <div className="loading-grid">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="skeleton-card" style={{ animationDelay: `${i * 0.05}s` }}>
                            <div className="skeleton-poster" />
                            <div className="skeleton-title" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    // Error State
    if (error) return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 20px',
            background: 'linear-gradient(135deg, #0a0a0f 0%, #0d0d15 50%, #0a0f1a 100%)',
            position: 'relative',
            overflow: 'hidden'
        }}>
            <div style={{
                position: 'absolute',
                width: '400px',
                height: '400px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(239, 68, 68, 0.2) 0%, transparent 70%)',
                filter: 'blur(80px)',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)'
            }} />
            <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: '400px' }}>
                <div style={{
                    width: '80px', height: '80px',
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%)',
                    borderRadius: '20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 24px',
                    border: '1px solid rgba(239, 68, 68, 0.3)'
                }}>
                    <span style={{ fontSize: '36px' }}>🎬</span>
                </div>
                <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'white', margin: '0 0 8px 0' }}>
                    {t('login', 'loadMoviesError')}
                </h2>
                <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: '0 0 8px 0' }}>
                    {t('login', 'connectionErrorDetails')}
                </p>
                <p style={{
                    fontSize: '13px', color: '#f87171', margin: '0 0 32px 0',
                    padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)'
                }}>{error === 'Not authenticated' ? t('login', 'notAuthenticated') : error}</p>
                <button onClick={fetchStreams} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    padding: '14px 28px', background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                    border: 'none', borderRadius: '12px', color: 'white', fontSize: '15px', fontWeight: 600,
                    cursor: 'pointer', boxShadow: '0 8px 32px rgba(239, 68, 68, 0.3)'
                }}>
                    <span>🔄</span> {t('profile', 'tryAgain')}
                </button>
            </div>
        </div>
    );

    const backdropUrl = selectedMovie ? (
        tmdbData?.backdrop_path ? getBackdropUrl(tmdbData.backdrop_path) :
            selectedMovie.cover || fixImageUrl(selectedMovie.stream_icon)
    ) : null;

    return (
        <>
            <style>{vodStyles}</style>
            <div className="vod-page">
                {/* Dynamic Background */}
                {backdropUrl && (
                    <div
                        className="vod-backdrop"
                        style={{ backgroundImage: `url(${backdropUrl})` }}
                    />
                )}

                <AnimatedSearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder={t('login', 'searchMovies')}
                />

                <CategoryMenu
                    onSelectCategory={setSelectedCategory}
                    selectedCategory={selectedCategory}
                    type="vod"
                    isKidsProfile={isKidsProfile}
                />

                <div className="vod-content">
                    {/* Movies Grid */}
                    <div
                        ref={scrollContainerRef}
                        className="movies-scroll-container"
                    >
                        {filteredStreams.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">🎬</div>
                                <h3>Nenhum filme encontrado</h3>
                                <p>Tente buscar por outro termo</p>
                            </div>
                        ) : (
                            <div ref={gridRef} className="movies-grid">
                                {filteredStreams.slice(0, visibleCount).map((stream, index) => {
                                    const progress = getProgress(stream.stream_id);
                                    const movieProgress = getMovieProgress(stream.stream_id);
                                    const isSaved = watchLaterService.has(String(stream.stream_id), 'movie');
                                    const isFavorite = favoritesService.has(String(stream.stream_id), 'movie');
                                    const yearMatch = stream.release_date?.match(/(\d{4})/);
                                    const year = yearMatch ? yearMatch[1] : undefined;
                                    const genres = stream.genre?.split(',').map(g => g.trim()).filter(Boolean);

                                    return (
                                        <div
                                            key={stream.stream_id}
                                            className={checkingItem === stream.name ? 'checking' : ''}
                                            style={{ animationDelay: `${(index % itemsPerPage) * 0.03}s` }}
                                        >
                                            <HoverPreviewCard
                                                type="movie"
                                                id={stream.stream_id}
                                                cover={fixImageUrl(stream.stream_icon) || stream.cover}
                                                backdrop={stream.backdrop_path?.[0] ? `https://image.tmdb.org/t/p/w780${stream.backdrop_path[0]}` : undefined}
                                                title={stream.name}
                                                year={year}
                                                rating={stream.rating}
                                                genres={genres}
                                                plot={stream.plot}
                                                youtubeTrailer={stream.youtube_trailer}
                                                isFavorite={isFavorite}
                                                onPlay={async () => {
                                                    const url = await buildStreamUrl(stream);
                                                    if (url) {
                                                        setPlayingMovie(stream);
                                                    }
                                                }}
                                                onMoreInfo={() => handleMovieClick(stream)}
                                                onToggleFavorite={() => {
                                                    if (isFavorite) {
                                                        favoritesService.remove(String(stream.stream_id), 'movie');
                                                    } else {
                                                        favoritesService.add({
                                                            id: String(stream.stream_id),
                                                            type: 'movie',
                                                            title: stream.name,
                                                            poster: fixImageUrl(stream.stream_icon) || stream.cover,
                                                            streamId: stream.stream_id
                                                        });
                                                    }
                                                    _setRefresh(r => r + 1);
                                                }}
                                            >
                                                {/* Saved Badge */}
                                                {isSaved && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        top: 10,
                                                        right: 10,
                                                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                                        borderRadius: 8,
                                                        padding: '4px 8px',
                                                        fontSize: 14
                                                    }}>🔖</span>
                                                )}

                                                {/* Offline Badge */}
                                                {downloadService.isDownloaded(stream.name, 'movie') && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        top: 10,
                                                        left: 10,
                                                        background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                                                        borderRadius: 8,
                                                        padding: '4px 8px',
                                                        fontSize: 14
                                                    }}>📥</span>
                                                )}

                                                {/* Progress Bar */}
                                                {progress > 0 && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        bottom: 0,
                                                        left: 0,
                                                        right: 0,
                                                        height: 4,
                                                        background: 'rgba(0,0,0,0.6)'
                                                    }}>
                                                        <div style={{
                                                            width: `${progress}%`,
                                                            height: '100%',
                                                            background: 'linear-gradient(90deg, #6366f1, #a855f7)'
                                                        }} />
                                                    </div>
                                                )}

                                                {/* Remaining Time Badge */}
                                                {movieProgress && movieProgress.currentTime > 0 && progress < 95 && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        bottom: 8,
                                                        left: 8,
                                                        background: 'rgba(0,0,0,0.8)',
                                                        padding: '4px 8px',
                                                        borderRadius: 4,
                                                        fontSize: 11,
                                                        color: 'white'
                                                    }}>
                                                        {formatRemainingTime(movieProgress.currentTime, movieProgress.duration)}
                                                    </div>
                                                )}
                                            </HoverPreviewCard>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Kids Block Message Toast */}
            {blockMessage && (
                <div className="kids-block-toast">
                    <span className="toast-icon">🔒</span>
                    <span className="toast-message">{blockMessage}</span>
                </div>
            )}

            {/* Video Player */}
            {playingMovie && (
                <AsyncVideoPlayer
                    movie={playingMovie}
                    buildStreamUrl={buildStreamUrl}
                    onClose={() => {
                        setPlayingMovie(null);
                        setPipResumeTime(null);
                    }}
                    resumeTime={pipResumeTime !== null ? pipResumeTime : (movieProgressService.getMoviePositionById(playingMovie.stream_id.toString())?.currentTime || null)}
                    onTimeUpdate={(currentTime, duration) => {
                        if (Math.floor(currentTime) % 5 === 0) {
                            movieProgressService.saveMovieTime(
                                playingMovie.stream_id.toString(),
                                playingMovie.name,
                                currentTime,
                                duration
                            );
                        }
                    }}
                    allMovies={streams}
                    onSwitchVersion={(newMovie, currentTime) => {
                        // Switch to new movie version while maintaining playback time
                        setPipResumeTime(currentTime);
                        setPlayingMovie(newMovie);
                    }}
                />
            )}

            {/* Content Detail Modal */}
            {selectedMovie && (
                <ContentDetailModal
                    isOpen={!!selectedMovie}
                    onClose={() => setSelectedMovie(null)}
                    contentId={String(selectedMovie.stream_id)}
                    contentType="movie"
                    contentData={{
                        name: selectedMovie.name,
                        cover: selectedMovie.stream_icon,
                        rating: selectedMovie.rating,
                        container_extension: selectedMovie.container_extension,
                        youtube_trailer: selectedMovie.youtube_trailer
                    }}
                    onPlay={(_season, _episode, offlineUrl) => {
                        // Set offline URL if available
                        if (offlineUrl) {
                            setPlayingMovie({ ...selectedMovie, offlineUrl });
                        } else {
                            setPlayingMovie(selectedMovie);
                        }
                        setSelectedMovie(null);
                    }}
                />
            )}
        </>
    );
}

// CSS Styles
const vodStyles = `
/* Page Container */
.vod-page {
    position: relative;
    height: 100vh;
    overflow: hidden;
    background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
}

/* Dynamic Backdrop */
.vod-backdrop {
    position: fixed;
    inset: 0;
    background-size: cover;
    background-position: center;
    opacity: 0.25;
    filter: blur(20px) saturate(1.2);
    transform: scale(1.1);
    transition: opacity 0.5s ease, background-image 0.8s ease;
    pointer-events: none;
    z-index: 0;
}

/* Content Area */
.vod-content {
    position: relative;
    z-index: 10;
    padding: 24px 32px;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 24px;
}

/* Movie Details Panel */
.movie-details-panel {
    flex-shrink: 0;
    background: linear-gradient(135deg, rgba(15, 15, 26, 0.9) 0%, rgba(26, 26, 46, 0.85) 100%);
    backdrop-filter: blur(24px);
    border-radius: 24px;
    border: 1px solid rgba(99, 102, 241, 0.2);
    padding: 32px;
    animation: slideDown 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4), 
                inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

@keyframes slideDown {
    from { 
        opacity: 0; 
        transform: translateY(-30px) scale(0.98);
    }
    to { 
        opacity: 1; 
        transform: translateY(0) scale(1);
    }
}

.details-content {
    max-width: 900px;
}

/* Meta Badges */
.meta-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;
}

.badge {
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    backdrop-filter: blur(10px);
    animation: fadeInUp 0.3s ease;
}

.badge.shimmer {
    background: linear-gradient(90deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2), rgba(99, 102, 241, 0.2));
    background-size: 200% 100%;
    animation: shimmerBadge 1.5s ease infinite;
    color: rgba(255, 255, 255, 0.6);
}

@keyframes shimmerBadge {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

.date-badge {
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
    border: 1px solid rgba(99, 102, 241, 0.3);
}

.rating-badge {
    background: linear-gradient(135deg, rgba(251, 191, 36, 0.25) 0%, rgba(245, 158, 11, 0.2) 100%);
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.4);
    animation: ratingGlow 2s ease-in-out infinite, fadeInUp 0.3s ease;
    position: relative;
    overflow: hidden;
}

.rating-badge::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 50%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
    animation: ratingShine 3s ease-in-out infinite;
}

@keyframes ratingGlow {
    0%, 100% { 
        box-shadow: 0 0 8px rgba(251, 191, 36, 0.3);
    }
    50% { 
        box-shadow: 0 0 20px rgba(251, 191, 36, 0.6), 0 0 30px rgba(251, 191, 36, 0.3);
    }
}

@keyframes ratingShine {
    0% { left: -100%; }
    50%, 100% { left: 150%; }
}

.runtime-badge {
    background: rgba(16, 185, 129, 0.2);
    color: #6ee7b7;
    border: 1px solid rgba(16, 185, 129, 0.3);
}

/* Title */
.movie-title {
    font-size: clamp(32px, 5vw, 56px);
    font-weight: 800;
    color: white;
    margin-bottom: 12px;
    line-height: 1.1;
    text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    letter-spacing: -0.02em;
}

/* Genre Tags */
.genre-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
}

.genre-tag {
    padding: 6px 14px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.8);
    transition: all 0.2s ease;
}

.genre-tag:hover {
    background: rgba(99, 102, 241, 0.2);
    border-color: rgba(99, 102, 241, 0.4);
}

/* Overview */
.movie-overview {
    font-size: 16px;
    line-height: 1.8;
    color: rgba(255, 255, 255, 0.85);
    margin-bottom: 24px;
    max-width: 700px;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

/* Action Buttons */
.action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
}

.btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 28px;
    font-size: 16px;
    font-weight: 600;
    border-radius: 14px;
    border: none;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.btn-icon {
    font-size: 18px;
}

.btn-primary {
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    color: white;
    box-shadow: 0 8px 24px rgba(99, 102, 241, 0.4);
}

.btn-primary:hover {
    transform: translateY(-3px) scale(1.02);
    box-shadow: 0 12px 32px rgba(99, 102, 241, 0.5);
}

.btn-primary:active {
    transform: translateY(0) scale(0.98);
}

.btn-secondary {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    border: 2px solid rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(10px);
}

.btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.25);
    transform: translateY(-2px);
}

.btn-secondary.saved {
    background: rgba(16, 185, 129, 0.2);
    border-color: #10b981;
    color: #6ee7b7;
}

.btn-close {
    width: 48px;
    height: 48px;
    padding: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.6);
    font-size: 20px;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.btn-close:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.4);
}

.btn-favorite {
    width: 48px;
    height: 48px;
    padding: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.6);
    font-size: 22px;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: all 0.3s ease;
}

.btn-favorite:hover {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
    transform: scale(1.1);
}

.btn-favorite.favorited {
    background: rgba(239, 68, 68, 0.25);
    border-color: #ef4444;
    animation: heartBeat 0.6s ease;
}

@keyframes heartBeat {
    0%, 100% { transform: scale(1); }
    25% { transform: scale(1.2); }
    50% { transform: scale(1); }
    75% { transform: scale(1.15); }
}

/* Movies Scroll Container */
.movies-scroll-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(99, 102, 241, 0.4) transparent;
}

.movies-scroll-container::-webkit-scrollbar {
    width: 6px;
}

.movies-scroll-container::-webkit-scrollbar-track {
    background: transparent;
}

.movies-scroll-container::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #6366f1, #a855f7);
    border-radius: 3px;
}

/* Movies Grid - Responsive */
.movies-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 24px;
    padding: 16px;
    padding-bottom: 32px;
}

@media (max-width: 768px) {
    .movies-grid {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 16px;
    }
}

@media (max-width: 480px) {
    .movies-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
    }
}

/* Movie Card */
.movie-card {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.03);
    border: 2px solid transparent;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    animation: cardFadeIn 0.4s ease backwards;
}

@keyframes cardFadeIn {
    from {
        opacity: 0;
        transform: translateY(20px) scale(0.95);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.movie-card:hover {
    transform: translateY(-8px) scale(1.03);
    border-color: rgba(99, 102, 241, 0.4);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4),
                0 0 40px rgba(99, 102, 241, 0.15);
}

.movie-card.selected {
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.3),
                0 20px 40px rgba(0, 0, 0, 0.4);
}

/* Card Poster */
.card-poster {
    position: relative;
    aspect-ratio: 2 / 3;
    overflow: hidden;
    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
}

.card-poster img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.4s ease;
}

.movie-card:hover .card-poster img {
    transform: scale(1.08);
}

.poster-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1e1e3f 0%, #0f0f1a 100%);
    font-size: 48px;
}

/* Card Overlay */
.card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
        to top,
        rgba(0, 0, 0, 0.8) 0%,
        transparent 50%,
        transparent 100%
    );
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.3s ease;
}

.movie-card:hover .card-overlay {
    opacity: 1;
}

.play-icon {
    width: 60px;
    height: 60px;
    background: rgba(99, 102, 241, 0.9);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    color: white;
    transform: scale(0);
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 8px 24px rgba(99, 102, 241, 0.5);
}

.movie-card:hover .play-icon {
    transform: scale(1);
}

/* Saved Badge */
.saved-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    animation: badgePop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes badgePop {
    from { transform: scale(0); }
    to { transform: scale(1); }
}

/* Offline Badge */
.offline-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(6, 182, 212, 0.4);
    animation: badgePop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Card Progress Bar */
.card-progress-container {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: rgba(0, 0, 0, 0.6);
}

.card-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #6366f1, #a855f7);
    transition: width 0.3s ease;
}

/* Remaining Time Badge */
.remaining-time-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    padding: 6px 10px;
    background: rgba(16, 185, 129, 0.9);
    backdrop-filter: blur(4px);
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    color: white;
    opacity: 0;
    transform: translateY(-5px);
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    z-index: 15;
}

.movie-card:hover .remaining-time-badge {
    opacity: 1;
    transform: translateY(0);
}

/* Card Info */
.card-info {
    padding: 14px;
    background: linear-gradient(to top, rgba(15, 15, 26, 0.98), rgba(26, 26, 46, 0.9));
}

.card-title {
    font-size: 14px;
    font-weight: 600;
    color: white;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
    transition: color 0.2s ease;
}

.movie-card:hover .card-title {
    color: #a5b4fc;
}

/* Empty State */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 60vh;
    text-align: center;
    color: rgba(255, 255, 255, 0.6);
}

.empty-icon {
    font-size: 80px;
    margin-bottom: 24px;
    opacity: 0.5;
}

.empty-state h3 {
    font-size: 24px;
    margin-bottom: 8px;
    color: white;
}

.empty-state p {
    font-size: 16px;
}

/* Loading State */
.vod-loading {
    padding: 32px;
}

.loading-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 24px;
}

.skeleton-card {
    animation: skeletonPulse 1.5s ease-in-out infinite;
    animation-delay: var(--delay);
}

@keyframes skeletonPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.skeleton-poster {
    aspect-ratio: 2 / 3;
    background: linear-gradient(135deg, #2a2a4a 0%, #1a1a2e 100%);
    border-radius: 16px 16px 0 0;
}

.skeleton-title {
    height: 50px;
    background: linear-gradient(135deg, #1a1a2e 0%, #2a2a4a 100%);
    border-radius: 0 0 16px 16px;
}

/* Error State */
.vod-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 80vh;
    text-align: center;
    padding: 32px;
}

.error-icon {
    font-size: 80px;
    margin-bottom: 24px;
    opacity: 0.5;
}

.vod-error h2 {
    font-size: 28px;
    color: #f87171;
    margin-bottom: 12px;
}

.vod-error p {
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 24px;
}

.retry-btn {
    padding: 14px 32px;
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: white;
    font-weight: 600;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.retry-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(239, 68, 68, 0.4);
}

/* Helper animation */
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* Kids Block Toast */
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

.kids-block-toast .toast-icon {
    font-size: 24px;
}

.kids-block-toast .toast-message {
    font-size: 15px;
}

@keyframes toastSlideUp {
    from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
}

@keyframes toastFadeOut {
    to {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
    }
}

/* Movie card checking state */
.movie-card.checking {
    opacity: 0.6;
    pointer-events: none;
}

.movie-card.checking::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 32px;
    height: 32px;
    margin: -16px 0 0 -16px;
    border: 3px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}
`;
