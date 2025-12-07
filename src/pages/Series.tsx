import { useState, useEffect, useRef, useCallback } from 'react';
import { type TMDBSeriesDetails, fetchEpisodeDetails, getBackdropUrl, searchSeriesByName } from '../services/tmdb';
import { watchLaterService } from '../services/watchLater';
import { favoritesService } from '../services/favoritesService';
import { watchProgressService } from '../services/watchProgressService';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { AnimatedSearchBar } from '../components/AnimatedSearchBar';
import { CategoryMenu } from '../components/CategoryMenu';
import { ResumeModal } from '../components/ResumeModal';
import { ProgressBar } from '../components/ProgressBar';
import { ContentDetailModal } from '../components/ContentDetailModal';

interface Series {
    num: number;
    name: string;
    series_id: number;
    stream_icon: string;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    release_date: string;
    last_modified: string;
    rating: string;
    rating_5based: number;
    backdrop_path: string[];
    youtube_trailer: string;
    episode_run_time: string;
    category_id: string | string[];
    tmdb_id: string;
}

const CARD_MIN_WIDTH = 180;
const CARD_GAP = 24;

export function Series() {
    const [series, setSeries] = useState<Series[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
    const [selectedSeries, setSelectedSeries] = useState<Series | null>(null);
    const [tmdbData, setTmdbData] = useState<TMDBSeriesDetails | null>(null);
    const [loadingTmdb, setLoadingTmdb] = useState(false);
    const [playingSeries, setPlayingSeries] = useState<Series | null>(null);
    const [selectedSeason, setSelectedSeason] = useState<number>(1);
    const [selectedEpisode, setSelectedEpisode] = useState<number>(1);
    const [seriesInfo, setSeriesInfo] = useState<any>(null);
    const [tmdbEpisodeCache, setTmdbEpisodeCache] = useState<Map<string, string>>(new Map());
    const [, setRefresh] = useState(0);
    const [visibleCount, setVisibleCount] = useState(0);
    const [itemsPerPage, setItemsPerPage] = useState(36);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const seasonTabsRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStartX, setDragStartX] = useState(0);
    const [scrollStartX, setScrollStartX] = useState(0);

    // Resume modal state
    const [showResumeModal, setShowResumeModal] = useState(false);
    const [resumeModalData, setResumeModalData] = useState<{
        currentTime: number;
        duration: number;
    } | null>(null);

    // Clear history confirmation
    const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);

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

    useEffect(() => { fetchSeries(); }, []);

    const fetchSeries = async () => {
        setLoading(true);
        setError('');
        try {
            const result = await window.ipcRenderer.invoke('streams:get-series');
            if (result.success) {
                setSeries(result.data || []);
            } else {
                setError(result.error || 'Failed to load series');
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to connect to server');
        } finally {
            setLoading(false);
        }
    };

    const filteredSeries = series.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());

        if (selectedCategory === 'CONTINUE_WATCHING') {
            const progressMap = watchProgressService.getContinueWatching();
            return matchesSearch && progressMap.has(String(s.series_id));
        }

        if (selectedCategory === 'COMPLETED') {
            return matchesSearch && watchProgressService.isSeriesCompleted(String(s.series_id));
        }

        const categories = Array.isArray(s.category_id) ? s.category_id : [s.category_id];
        const matchesCategory = !selectedCategory || selectedCategory === '' || selectedCategory === 'all' || categories.includes(selectedCategory);
        return matchesSearch && matchesCategory;
    });

    // Lazy loading scroll handler
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            if (scrollTop + clientHeight >= scrollHeight * 0.85 && visibleCount < filteredSeries.length) {
                setVisibleCount(prev => Math.min(prev + itemsPerPage, filteredSeries.length));
            }
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [filteredSeries.length, visibleCount, itemsPerPage]);

    // Reset on filter change
    useEffect(() => {
        setVisibleCount(itemsPerPage);
        setSelectedSeries(null);
    }, [searchQuery, selectedCategory, itemsPerPage]);

    const handleImageError = useCallback((seriesId: number) => {
        setBrokenImages(prev => new Set(prev).add(seriesId));
    }, []);

    const fixImageUrl = (url: string): string => url && url.startsWith('http') ? url : `https://${url}`;

    const extractYearFromName = (name: string): string => {
        const match = name.match(/\((\d{4})\)/);
        return match ? match[1] : '';
    };

    // Fetch TMDB data
    useEffect(() => {
        if (!selectedSeries) {
            setTmdbData(null);
            return;
        }

        const year = extractYearFromName(selectedSeries.name);
        setLoadingTmdb(true);
        setTmdbData(null);

        searchSeriesByName(selectedSeries.name, year)
            .then(data => { setTmdbData(data); setLoadingTmdb(false); })
            .catch(() => setLoadingTmdb(false));
    }, [selectedSeries]);

    const handlePlaySeries = (seriesItem: Series) => {
        // Check for existing progress
        const progress = watchProgressService.getEpisodeProgress(
            String(seriesItem.series_id),
            selectedSeason,
            selectedEpisode
        );
        const progressPercent = progress ? Math.round((progress.currentTime / progress.duration) * 100) : 0;
        if (progress && progress.currentTime > 10 && progressPercent < 95) {
            // Has meaningful progress, show resume modal
            setResumeModalData({
                currentTime: progress.currentTime,
                duration: progress.duration
            });
            setShowResumeModal(true);
        } else {
            // No progress or completed, play directly
            setPlayingSeries(seriesItem);
        }
    };

    // Episode title handling
    const isValidEpisodeTitle = (cleanTitle: string): boolean => {
        const genericPatterns = [
            /^s\d+\s*e\d+$/i,
            /^episode\s*\d+$/i,
            /^ep\s*\d+$/i,
            /^\d+$/,
            /^temporada\s*\d+\s*episodio\s*\d+$/i
        ];
        return !genericPatterns.some(pattern => pattern.test(cleanTitle));
    };

    const getEpisodeTitle = (fullTitle: string, episodeNum: number, season: number = selectedSeason): string => {
        let cleanTitle = fullTitle
            .replace(/^(.*?)[\s\-–—]*S\d+[\s\-:\.]*E\d+[\s\-:\.–—]*/i, '')
            .replace(/\s*[\[\(]?S\d+[\s\.\-]*E\d+[\]\)]?\s*/gi, '')
            .replace(/\s*-\s*Temporada\s*\d+\s*Epis[oó]dio\s*\d+\s*/gi, '')
            .replace(/\s*Temp\s*\d+\s*Ep\s*\d+\s*/gi, '')
            .trim();

        if (cleanTitle && isValidEpisodeTitle(cleanTitle)) {
            return `Episódio ${episodeNum} - ${cleanTitle}`;
        }

        // Check cache for TMDB title
        const cacheKey = `${selectedSeries?.tmdb_id || selectedSeries?.series_id}-${season}-${episodeNum}`;
        const cachedTitle = tmdbEpisodeCache.get(cacheKey);
        if (cachedTitle) {
            return `Episódio ${episodeNum} - ${cachedTitle}`;
        }

        // Fetch from TMDB if we have tmdb_id
        if (selectedSeries?.tmdb_id && tmdbData) {
            fetchEpisodeDetails(selectedSeries.tmdb_id, season, episodeNum)
                .then(epDetails => {
                    if (epDetails?.name) {
                        setTmdbEpisodeCache(prev => new Map(prev).set(cacheKey, epDetails.name));
                    }
                })
                .catch(() => { });
        }

        return `Episódio ${episodeNum}`;
    };

    const buildSeriesStreamUrl = async (_seriesItem: Series): Promise<string> => {
        try {
            const credResult = await window.ipcRenderer.invoke('auth:get-credentials');
            if (credResult.success) {
                const { url, username, password } = credResult.credentials;
                const episodes = seriesInfo?.episodes?.[selectedSeason];
                const episode = episodes?.find((ep: any) => Number(ep.episode_num) === selectedEpisode);

                if (episode) {
                    const ext = episode.container_extension || 'mp4';
                    return `${url}/series/${username}/${password}/${episode.id}.${ext}`;
                }
            }
            throw new Error('Credenciais não encontradas');
        } catch (error) {
            console.error('❌ Error building series stream URL:', error);
            throw error;
        }
    };

    // Fetch series info when series is selected
    useEffect(() => {
        if (selectedSeries) {
            window.ipcRenderer.invoke('auth:get-credentials').then(result => {
                if (result.success) {
                    const { url, username, password } = result.credentials;
                    fetch(`${url}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${selectedSeries.series_id}`)
                        .then(res => res.json())
                        .then(data => {
                            setSeriesInfo(data);
                            const lastWatched = watchProgressService.getLastWatchedEpisode(String(selectedSeries.series_id));
                            if (lastWatched) {
                                setSelectedSeason(lastWatched.season);
                                setSelectedEpisode(lastWatched.episode);
                            } else {
                                setSelectedSeason(1);
                                setSelectedEpisode(1);
                            }
                        })
                        .catch(() => setSeriesInfo(null));
                }
            });
        } else {
            setSeriesInfo(null);
        }
    }, [selectedSeries]);

    // Loading State
    if (loading) return (
        <div className="series-page">
            <style>{seriesStyles}</style>
            <div className="series-loading">
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
        <div className="series-page">
            <style>{seriesStyles}</style>
            <div className="series-error">
                <div className="error-icon">📺</div>
                <h2>Erro ao carregar séries</h2>
                <p>{error}</p>
                <button onClick={fetchSeries} className="retry-btn">
                    Tentar novamente
                </button>
            </div>
        </div>
    );

    const backdropUrl = selectedSeries ? (
        tmdbData?.backdrop_path ? getBackdropUrl(tmdbData.backdrop_path) :
            selectedSeries.cover || fixImageUrl(selectedSeries.stream_icon)
    ) : null;

    return (
        <>
            <style>{seriesStyles}</style>
            <div className="series-page">
                {/* Dynamic Background */}
                {backdropUrl && (
                    <div
                        className="series-backdrop"
                        style={{ backgroundImage: `url(${backdropUrl})` }}
                    />
                )}

                <AnimatedSearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Buscar séries..."
                />

                <CategoryMenu
                    onSelectCategory={setSelectedCategory}
                    selectedCategory={selectedCategory}
                    type="series"
                />

                <div className="series-content">
                    {/* Series Details Panel */}
                    {selectedSeries && (
                        <div className="series-details-panel" style={{ display: 'none' }}>
                            <div className="details-content">
                                {/* Meta Info */}
                                <div className="meta-badges">
                                    {loadingTmdb ? (
                                        <span className="badge shimmer">Carregando...</span>
                                    ) : (
                                        <>
                                            {tmdbData?.first_air_date && (
                                                <span className="badge date-badge">
                                                    📅 {new Date(tmdbData.first_air_date).getFullYear()}
                                                </span>
                                            )}
                                            {tmdbData?.vote_average ? (
                                                <span className="badge rating-badge">
                                                    ⭐ {tmdbData.vote_average.toFixed(1)}
                                                </span>
                                            ) : null}
                                            {seriesInfo?.episodes && (
                                                <span className="badge seasons-badge">
                                                    📺 {Object.keys(seriesInfo.episodes).length} Temporadas
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>

                                {/* Title */}
                                <h1 className="series-title">{selectedSeries.name}</h1>

                                {/* Genres */}
                                {loadingTmdb ? (
                                    <p className="loading-text">Carregando gêneros...</p>
                                ) : tmdbData?.genres && tmdbData.genres.length > 0 ? (
                                    <div className="genre-tags">
                                        {tmdbData.genres.slice(0, 4).map(genre => (
                                            <span key={genre.id} className="genre-tag">{genre.name}</span>
                                        ))}
                                    </div>
                                ) : null}

                                {/* Overview */}
                                {loadingTmdb ? (
                                    <p className="loading-text">Carregando sinopse...</p>
                                ) : tmdbData?.overview ? (
                                    <p className="series-overview">{tmdbData.overview}</p>
                                ) : null}

                                {/* Season Tabs Carousel */}
                                <div className="season-carousel-wrapper">
                                    <button
                                        className="season-nav-btn season-nav-left"
                                        onClick={() => {
                                            if (seasonTabsRef.current) {
                                                seasonTabsRef.current.scrollBy({ left: -200, behavior: 'smooth' });
                                            }
                                        }}
                                    >
                                        ‹
                                    </button>
                                    <div
                                        className={`season-tabs-container ${isDragging ? 'dragging' : ''}`}
                                        ref={seasonTabsRef}
                                        onMouseDown={(e) => {
                                            setIsDragging(true);
                                            setDragStartX(e.pageX);
                                            setScrollStartX(seasonTabsRef.current?.scrollLeft || 0);
                                        }}
                                        onMouseMove={(e) => {
                                            if (!isDragging) return;
                                            e.preventDefault();
                                            const delta = e.pageX - dragStartX;
                                            if (seasonTabsRef.current) {
                                                seasonTabsRef.current.scrollLeft = scrollStartX - delta;
                                            }
                                        }}
                                        onMouseUp={() => setIsDragging(false)}
                                        onMouseLeave={() => setIsDragging(false)}
                                    >
                                        <div className="season-tabs">
                                            {seriesInfo?.episodes ? Object.keys(seriesInfo.episodes).sort((a, b) => Number(a) - Number(b)).map((season: string, index: number) => (
                                                <button
                                                    key={season}
                                                    className={`season-tab ${selectedSeason === Number(season) ? 'active' : ''}`}
                                                    onClick={() => {
                                                        if (!isDragging) {
                                                            setSelectedSeason(Number(season));
                                                            setSelectedEpisode(1);
                                                        }
                                                    }}
                                                    style={{ animationDelay: `${index * 0.05}s` }}
                                                >
                                                    <span className="season-tab-number">T{season}</span>
                                                    <span className="season-tab-label">Temporada {season}</span>
                                                </button>
                                            )) : (
                                                <button className="season-tab active">
                                                    <span className="season-tab-number">T1</span>
                                                    <span className="season-tab-label">Temporada 1</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        className="season-nav-btn season-nav-right"
                                        onClick={() => {
                                            if (seasonTabsRef.current) {
                                                seasonTabsRef.current.scrollBy({ left: 200, behavior: 'smooth' });
                                            }
                                        }}
                                    >
                                        ›
                                    </button>
                                </div>

                                {/* Episode List */}
                                <div className="episode-list-container">
                                    <div className="episode-list">
                                        {seriesInfo?.episodes?.[selectedSeason] ? seriesInfo.episodes[selectedSeason].map((episode: any, index: number) => {
                                            const episodeNum = Number(episode.episode_num);
                                            const progress = watchProgressService.getEpisodeProgress(String(selectedSeries.series_id), selectedSeason, episodeNum);
                                            const isSelected = selectedEpisode === episodeNum;
                                            const isWatched = progress?.completed;
                                            const progressPercent = progress ? Math.round((progress.currentTime / progress.duration) * 100) : 0;

                                            return (
                                                <div
                                                    key={episode.id}
                                                    className={`episode-card ${isSelected ? 'selected' : ''} ${isWatched ? 'watched' : ''}`}
                                                    onClick={() => setSelectedEpisode(episodeNum)}
                                                    style={{ animationDelay: `${index * 0.03}s` }}
                                                >
                                                    <div className="episode-number-badge">
                                                        {isWatched ? '✓' : episodeNum}
                                                    </div>
                                                    <div className="episode-info">
                                                        <div className="episode-title-row">
                                                            <span className="episode-title">{getEpisodeTitle(episode.title, episodeNum)}</span>
                                                        </div>
                                                        {episode.info?.duration && (
                                                            <span className="episode-duration">{episode.info.duration}</span>
                                                        )}
                                                        {progressPercent > 0 && progressPercent < 95 && (
                                                            <div className="episode-progress-bar">
                                                                <div className="episode-progress-fill" style={{ width: `${progressPercent}%` }} />
                                                            </div>
                                                        )}
                                                    </div>
                                                    {isSelected && (
                                                        <div className="episode-play-indicator">▶</div>
                                                    )}
                                                </div>
                                            );
                                        }) : (
                                            <div className="episode-card selected">
                                                <div className="episode-number-badge">1</div>
                                                <div className="episode-info">
                                                    <span className="episode-title">Episódio 1</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="action-buttons">
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => handlePlaySeries(selectedSeries)}
                                    >
                                        <span className="btn-icon">▶</span>
                                        <span>Assistir</span>
                                    </button>

                                    <button
                                        className={`btn btn-secondary ${watchLaterService.has(String(selectedSeries.series_id), 'series') ? 'saved' : ''}`}
                                        onClick={() => {
                                            if (watchLaterService.has(String(selectedSeries.series_id), 'series')) {
                                                watchLaterService.remove(String(selectedSeries.series_id), 'series');
                                            } else {
                                                watchLaterService.add({
                                                    id: String(selectedSeries.series_id),
                                                    type: 'series',
                                                    name: selectedSeries.name,
                                                    cover: selectedSeries.cover || selectedSeries.stream_icon
                                                });
                                            }
                                            setRefresh(r => r + 1);
                                        }}
                                    >
                                        <span className="btn-icon">
                                            {watchLaterService.has(String(selectedSeries.series_id), 'series') ? '✓' : '+'}
                                        </span>
                                        <span>{watchLaterService.has(String(selectedSeries.series_id), 'series') ? 'Salvo' : 'Minha Lista'}</span>
                                    </button>

                                    <button
                                        className={`btn btn-favorite ${favoritesService.has(String(selectedSeries.series_id), 'series') ? 'favorited' : ''}`}
                                        onClick={() => {
                                            favoritesService.toggle({
                                                id: String(selectedSeries.series_id),
                                                type: 'series',
                                                title: selectedSeries.name,
                                                poster: selectedSeries.cover || selectedSeries.stream_icon,
                                                rating: tmdbData?.vote_average?.toFixed(1),
                                                year: tmdbData?.first_air_date ? new Date(tmdbData.first_air_date).getFullYear().toString() : undefined,
                                                seriesId: selectedSeries.series_id
                                            });
                                            setRefresh(r => r + 1);
                                        }}
                                        title={favoritesService.has(String(selectedSeries.series_id), 'series') ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
                                    >
                                        <span className="btn-icon">
                                            {favoritesService.has(String(selectedSeries.series_id), 'series') ? '❤️' : '🤍'}
                                        </span>
                                    </button>

                                    {watchProgressService.getSeriesProgress(String(selectedSeries.series_id), selectedSeries.name) && (
                                        <button
                                            className="btn btn-danger"
                                            onClick={() => setShowClearHistoryConfirm(true)}
                                        >
                                            <span className="btn-icon">🗑️</span>
                                            <span>Limpar Histórico</span>
                                        </button>
                                    )}

                                    <button
                                        className="btn btn-close"
                                        onClick={() => setSelectedSeries(null)}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Series Grid */}
                    <div
                        ref={scrollContainerRef}
                        className={`series-scroll-container ${selectedSeries ? 'with-details' : ''}`}
                    >
                        {filteredSeries.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">📺</div>
                                <h3>Nenhuma série encontrada</h3>
                                <p>Tente buscar por outro termo</p>
                            </div>
                        ) : (
                            <div ref={gridRef} className="series-grid">
                                {filteredSeries.slice(0, visibleCount).map((s, index) => {
                                    const isSelected = selectedSeries?.series_id === s.series_id;
                                    const isSaved = watchLaterService.has(String(s.series_id), 'series');
                                    const hasProgress = watchProgressService.getSeriesProgress(String(s.series_id), s.name);
                                    const isCompleted = watchProgressService.isSeriesCompleted(String(s.series_id));

                                    return (
                                        <div
                                            key={s.series_id}
                                            className={`series-card ${isSelected ? 'selected' : ''}`}
                                            onClick={() => setSelectedSeries(s)}
                                            style={{ animationDelay: `${(index % itemsPerPage) * 0.03}s` }}
                                        >
                                            {/* Poster */}
                                            <div className="card-poster">
                                                {(s.cover || s.stream_icon) && !brokenImages.has(s.series_id) ? (
                                                    <img
                                                        loading="lazy"
                                                        src={fixImageUrl(s.cover || s.stream_icon)}
                                                        alt={s.name}
                                                        onError={() => handleImageError(s.series_id)}
                                                    />
                                                ) : (
                                                    <div className="poster-fallback">
                                                        <span>📺</span>
                                                    </div>
                                                )}

                                                {/* Overlay */}
                                                <div className="card-overlay">
                                                    <div className="play-icon">▶</div>
                                                </div>

                                                {/* Saved Badge */}
                                                {isSaved && (
                                                    <div className="saved-badge">🔖</div>
                                                )}

                                                {/* Completed Badge */}
                                                {isCompleted && (
                                                    <div className="completed-badge">✓</div>
                                                )}

                                                {/* Episode Badge */}
                                                {hasProgress && !isCompleted && (
                                                    <div className="episode-badge">
                                                        T{hasProgress.lastWatchedSeason} E{hasProgress.lastWatchedEpisode}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Title & Progress */}
                                            <div className="card-info">
                                                <h4 className="card-title">{s.name}</h4>
                                                {hasProgress && (
                                                    <ProgressBar
                                                        progress={100}
                                                        completed={isCompleted}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Video Player */}
            {playingSeries && (
                <AsyncVideoPlayer
                    movie={playingSeries}
                    buildStreamUrl={buildSeriesStreamUrl}
                    onClose={() => setPlayingSeries(null)}
                    seriesId={String(playingSeries.series_id)}
                    seasonNumber={selectedSeason}
                    episodeNumber={selectedEpisode}
                    onNextEpisode={() => {
                        watchProgressService.markEpisodeWatched(
                            String(playingSeries.series_id),
                            selectedSeason,
                            selectedEpisode
                        );

                        const episodes = seriesInfo?.episodes?.[selectedSeason];
                        if (episodes && selectedEpisode < episodes.length) {
                            setSelectedEpisode(selectedEpisode + 1);
                        } else if (seriesInfo?.episodes?.[selectedSeason + 1]) {
                            setSelectedSeason(selectedSeason + 1);
                            setSelectedEpisode(1);
                        }
                    }}
                    onPreviousEpisode={() => {
                        if (selectedEpisode > 1) {
                            setSelectedEpisode(selectedEpisode - 1);
                        } else if (selectedSeason > 1) {
                            const prevSeasonEpisodes = seriesInfo?.episodes?.[selectedSeason - 1];
                            if (prevSeasonEpisodes) {
                                setSelectedSeason(selectedSeason - 1);
                                setSelectedEpisode(prevSeasonEpisodes.length);
                            }
                        }
                    }}
                    canGoNext={
                        (seriesInfo?.episodes?.[selectedSeason] &&
                            selectedEpisode < seriesInfo.episodes[selectedSeason].length) ||
                        !!seriesInfo?.episodes?.[selectedSeason + 1]
                    }
                    canGoPrevious={selectedEpisode > 1 || selectedSeason > 1}
                    currentEpisode={selectedEpisode}
                    customTitle={(() => {
                        const currentEp = seriesInfo?.episodes?.[selectedSeason]?.find(
                            (ep: any) => Number(ep.episode_num) === selectedEpisode
                        );
                        const episodeName = currentEp ? getEpisodeTitle(currentEp.title, selectedEpisode, selectedSeason) : `Episódio ${selectedEpisode}`;
                        return `${playingSeries.name} - ${episodeName}`;
                    })()}
                />
            )}

            {/* Resume Modal */}
            {showResumeModal && resumeModalData && selectedSeries && (
                <ResumeModal
                    seriesName={selectedSeries.name}
                    seasonNumber={selectedSeason}
                    episodeNumber={selectedEpisode}
                    currentTime={resumeModalData.currentTime}
                    duration={resumeModalData.duration}
                    onResume={() => {
                        setShowResumeModal(false);
                        setPlayingSeries(selectedSeries);
                    }}
                    onRestart={() => {
                        watchProgressService.clearEpisodeProgress(
                            String(selectedSeries.series_id),
                            selectedSeason,
                            selectedEpisode
                        );
                        setShowResumeModal(false);
                        setPlayingSeries(selectedSeries);
                    }}
                    onCancel={() => {
                        setShowResumeModal(false);
                        setResumeModalData(null);
                    }}
                />
            )}

            {/* Clear History Confirmation Modal */}
            {showClearHistoryConfirm && selectedSeries && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h2>Limpar Histórico?</h2>
                        <p>
                            Tem certeza que deseja limpar todo o histórico de visualização de <strong>{selectedSeries.name}</strong>? Esta ação não pode ser desfeita.
                        </p>
                        <div className="modal-buttons">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowClearHistoryConfirm(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                className="btn btn-danger"
                                onClick={() => {
                                    watchProgressService.clearSeriesProgress(String(selectedSeries.series_id));
                                    setShowClearHistoryConfirm(false);
                                    setRefresh(r => r + 1);
                                }}
                            >
                                Limpar Histórico
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Content Detail Modal */}
            {selectedSeries && (
                <ContentDetailModal
                    isOpen={!!selectedSeries}
                    onClose={() => setSelectedSeries(null)}
                    contentId={String(selectedSeries.series_id)}
                    contentType="series"
                    contentData={{
                        name: selectedSeries.name,
                        cover: selectedSeries.cover || selectedSeries.stream_icon,
                        rating: selectedSeries.rating
                    }}
                    onPlay={(season, episode) => {
                        setSelectedSeason(season || 1);
                        setSelectedEpisode(episode || 1);
                        handlePlaySeries(selectedSeries);
                    }}
                />
            )}
        </>
    );
}

// CSS Styles
const seriesStyles = `
/* Page Container */
.series-page {
    position: relative;
    height: 100vh;
    overflow: hidden;
    background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
}

/* Dynamic Backdrop */
.series-backdrop {
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
.series-content {
    position: relative;
    z-index: 10;
    padding: 24px 32px;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 24px;
}

/* Series Details Panel */
.series-details-panel {
    flex-shrink: 0;
    background: linear-gradient(135deg, rgba(15, 15, 26, 0.9) 0%, rgba(26, 26, 46, 0.85) 100%);
    backdrop-filter: blur(24px);
    border-radius: 24px;
    border: 1px solid rgba(168, 85, 247, 0.2);
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
    background: linear-gradient(90deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2), rgba(168, 85, 247, 0.2));
    background-size: 200% 100%;
    animation: shimmerBadge 1.5s ease infinite;
    color: rgba(255, 255, 255, 0.6);
}

@keyframes shimmerBadge {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

.date-badge {
    background: rgba(168, 85, 247, 0.2);
    color: #c4b5fd;
    border: 1px solid rgba(168, 85, 247, 0.3);
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

.seasons-badge {
    background: rgba(16, 185, 129, 0.2);
    color: #6ee7b7;
    border: 1px solid rgba(16, 185, 129, 0.3);
}

/* Title */
.series-title {
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
    background: rgba(168, 85, 247, 0.2);
    border-color: rgba(168, 85, 247, 0.4);
}

/* Overview */
.series-overview {
    font-size: 16px;
    line-height: 1.8;
    color: rgba(255, 255, 255, 0.85);
    margin-bottom: 20px;
    max-width: 700px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.loading-text {
    color: rgba(255, 255, 255, 0.5);
    font-style: italic;
    margin-bottom: 12px;
}

/* Season Carousel */
.season-carousel-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    position: relative;
}

.season-nav-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 50%;
    color: white;
    font-size: 20px;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
    opacity: 0.7;
}

.season-nav-btn:hover {
    background: rgba(168, 85, 247, 0.3);
    border-color: rgba(168, 85, 247, 0.5);
    opacity: 1;
    transform: scale(1.1);
}

.season-nav-btn:active {
    transform: scale(0.95);
}

/* Season Tabs */
.season-tabs-container {
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    cursor: grab;
    user-select: none;
    scroll-behavior: smooth;
}

.season-tabs-container.dragging {
    cursor: grabbing;
    scroll-behavior: auto;
}

.season-tabs-container::-webkit-scrollbar {
    display: none;
}

.season-tabs {
    display: flex;
    gap: 10px;
    padding: 4px 8px;
    animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateX(-20px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.season-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 30px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s ease;
    white-space: nowrap;
}

.season-tab:hover {
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.4);
    color: white;
}

.season-tab.active {
    background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
    border-color: transparent;
    color: white;
    box-shadow: 0 4px 15px rgba(168, 85, 247, 0.4);
}

.season-tab-number {
    display: none;
}

.season-tab-label {
    font-weight: 600;
}

/* Episode List */
.episode-list-container {
    max-height: 280px;
    overflow-y: auto;
    margin-bottom: 20px;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.2);
    padding: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(168, 85, 247, 0.4) transparent;
}

.episode-list-container::-webkit-scrollbar {
    width: 6px;
}

.episode-list-container::-webkit-scrollbar-track {
    background: transparent;
}

.episode-list-container::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #a855f7, #ec4899);
    border-radius: 3px;
}

.episode-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.episode-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    animation: episodeFadeIn 0.3s ease-out backwards;
}

@keyframes episodeFadeIn {
    from {
        opacity: 0;
        transform: translateX(-10px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.episode-card:hover {
    background: rgba(168, 85, 247, 0.1);
    border-color: rgba(168, 85, 247, 0.3);
    transform: translateX(4px);
}

.episode-card.selected {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(236, 72, 153, 0.15) 100%);
    border-color: rgba(168, 85, 247, 0.5);
    box-shadow: 0 4px 20px rgba(168, 85, 247, 0.2);
}

.episode-card.watched {
    opacity: 0.7;
}

.episode-card.watched .episode-number-badge {
    background: linear-gradient(135deg, #10b981, #059669);
}

.episode-number-badge {
    min-width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(168, 85, 247, 0.3);
    border-radius: 10px;
    font-size: 14px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
}

.episode-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.episode-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.episode-title {
    font-size: 14px;
    font-weight: 500;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.episode-duration {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
}

.episode-progress-bar {
    height: 3px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
    margin-top: 4px;
}

.episode-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #a855f7, #ec4899);
    border-radius: 3px;
    transition: width 0.3s ease;
}

.episode-play-indicator {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #a855f7, #ec4899);
    border-radius: 50%;
    font-size: 12px;
    color: white;
    flex-shrink: 0;
    animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
}

/* Keep old styles for backwards compatibility */
.episode-selectors {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 20px;
}

.episode-select {
    padding: 12px 20px;
    background: rgba(30, 30, 50, 0.9);
    color: white;
    font-size: 15px;
    font-weight: 600;
    border-radius: 12px;
    border: 2px solid rgba(168, 85, 247, 0.4);
    cursor: pointer;
    outline: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 150px;
    transition: all 0.2s ease;
}

.episode-select:hover {
    border-color: rgba(168, 85, 247, 0.7);
    background: rgba(40, 40, 60, 0.9);
}

.episode-select:focus {
    border-color: #a855f7;
    box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.2);
}

.episode-dropdown {
    min-width: 250px;
}


/* Action Buttons */
.action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
}

.btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 24px;
    font-size: 15px;
    font-weight: 600;
    border-radius: 12px;
    border: none;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.btn-icon {
    font-size: 18px;
}

.btn-primary {
    background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
    color: white;
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.4);
}

.btn-primary:hover {
    transform: translateY(-3px) scale(1.02);
    box-shadow: 0 12px 32px rgba(168, 85, 247, 0.5);
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

.btn-danger {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border: 2px solid rgba(239, 68, 68, 0.4);
}

.btn-danger:hover {
    background: rgba(239, 68, 68, 0.3);
    border-color: rgba(239, 68, 68, 0.6);
}

.btn-close {
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.6);
    font-size: 18px;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.btn-close:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.4);
}

.btn-favorite {
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.6);
    font-size: 20px;
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

/* Series Scroll Container */
.series-scroll-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(168, 85, 247, 0.4) transparent;
}

.series-scroll-container::-webkit-scrollbar {
    width: 6px;
}

.series-scroll-container::-webkit-scrollbar-track {
    background: transparent;
}

.series-scroll-container::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #a855f7, #ec4899);
    border-radius: 3px;
}

/* Series Grid - Responsive */
.series-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 24px;
    padding-bottom: 32px;
}

@media (max-width: 768px) {
    .series-grid {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 16px;
    }
}

@media (max-width: 480px) {
    .series-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
    }
}

/* Series Card */
.series-card {
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

.series-card:hover {
    transform: translateY(-8px) scale(1.03);
    border-color: rgba(168, 85, 247, 0.4);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4),
                0 0 40px rgba(168, 85, 247, 0.15);
}

.series-card.selected {
    border-color: #a855f7;
    box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.3),
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

.series-card:hover .card-poster img {
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

.series-card:hover .card-overlay {
    opacity: 1;
}

.play-icon {
    width: 60px;
    height: 60px;
    background: rgba(168, 85, 247, 0.9);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    color: white;
    transform: scale(0);
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.5);
}

.series-card:hover .play-icon {
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

/* Completed Badge */
.completed-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    color: white;
    font-weight: bold;
    box-shadow: 0 4px 12px rgba(168, 85, 247, 0.4);
}

/* Episode Badge */
.episode-badge {
    position: absolute;
    bottom: 8px;
    left: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.85);
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 11px;
    font-weight: 600;
    color: white;
    text-align: center;
}

@keyframes badgePop {
    from { transform: scale(0); }
    to { transform: scale(1); }
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
    margin: 0 0 8px 0;
    transition: color 0.2s ease;
}

.series-card:hover .card-title {
    color: #c4b5fd;
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
.series-loading {
    padding: 32px;
}

.loading-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 24px;
}

.skeleton-card {
    animation: skeletonPulse 1.5s ease-in-out infinite;
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
.series-error {
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

.series-error h2 {
    font-size: 28px;
    color: #f87171;
    margin-bottom: 12px;
}

.series-error p {
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

/* Modal */
.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    animation: fadeIn 0.2s ease;
}

.modal-content {
    background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
    border-radius: 20px;
    padding: 32px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-content h2 {
    color: white;
    font-size: 24px;
    font-weight: bold;
    margin-bottom: 16px;
}

.modal-content p {
    color: #9ca3af;
    margin-bottom: 24px;
    line-height: 1.6;
}

.modal-content strong {
    color: white;
}

.modal-buttons {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
}

/* Helper animation */
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

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
`;
