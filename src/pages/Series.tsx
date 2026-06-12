import { useState, useEffect, useRef } from 'react';
import { getBackdropUrl } from '../services/tmdb';
import { watchLaterService } from '../services/watchLater';
import { favoritesService } from '../services/favoritesService';
import { watchProgressService } from '../services/watchProgressService';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { AnimatedSearchBar } from '../components/AnimatedSearchBar';
import { CategoryMenu } from '../components/CategoryMenu';
import { ResumeModal } from '../components/ResumeModal';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { profileService } from '../services/profileService';
import { SeriesDetailPanel, type SeriesEpisode, type SeriesInfo } from '../components/SeriesDetailPanel';
import { useSeriesMetadata } from '../hooks/useSeriesMetadata';
import { useContentFiltering } from '../hooks/useContentFiltering';
import { useWindowedGrid } from '../hooks/useWindowedGrid';
import { HoverPreviewCard } from '../components/HoverPreviewCard';
import { closeAllPreviews } from '../components/hoverPreviewActions';
import { useLanguage } from '../services/languageService';
import { GLOBAL_SEARCH_TERM_KEY, GLOBAL_SEARCH_EVENT } from '../components/GlobalSearch';

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
    const [selectedSeries, setSelectedSeries] = useState<Series | null>(null);
    const [playingSeries, setPlayingSeries] = useState<Series | null>(null);
    const [pipResumeTime, setPipResumeTime] = useState<number | null>(null);
    const [selectedSeason, setSelectedSeason] = useState<number>(1);
    const [selectedEpisode, setSelectedEpisode] = useState<number>(1);
    const [seriesInfo, setSeriesInfo] = useState<SeriesInfo | null>(null);
    const [, setRefresh] = useState(0);
    const [visibleCount, setVisibleCount] = useState(0);
    const [itemsPerPage, setItemsPerPage] = useState(36);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    // Resume modal state
    const [showResumeModal, setShowResumeModal] = useState(false);
    const [resumeModalData, setResumeModalData] = useState<{
        currentTime: number;
        duration: number;
    } | null>(null);

    // Clear history confirmation
    const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);
    const isKidsProfile = profileService.getActiveProfile()?.isKids || false;
    const { t } = useLanguage();

    // TMDB metadata + episode title resolution for the selected series
    const { tmdbData, loadingTmdb, getEpisodeTitle } = useSeriesMetadata(selectedSeries, selectedSeason);

    // Kids profile + Parental Control filtering and click-gating
    const {
        checkingItem,
        blockMessage,
        isItemVisible,
        handleItemClick: handleSeriesClick
    } = useContentFiltering<Series>({
        contentType: 'series',
        isKidsProfile,
        items: series,
        getItemName: (s) => s.name,
        getItemCategoryIds: (s) => Array.isArray(s.category_id) ? s.category_id : [s.category_id],
        onAllowed: setSelectedSeries
    });

    // Close any open previews when this page mounts
    useEffect(() => {
        closeAllPreviews();
    }, []);

    // Global search term-bridge: consume (read + remove) the term stored by
    // the Ctrl+K overlay, both on mount (cross-page navigation) and on the
    // event (already on this page).
    useEffect(() => {
        const consumeGlobalSearchTerm = () => {
            const term = sessionStorage.getItem(GLOBAL_SEARCH_TERM_KEY);
            if (term !== null) {
                sessionStorage.removeItem(GLOBAL_SEARCH_TERM_KEY);
                setSearchQuery(term);
            }
        };
        consumeGlobalSearchTerm();
        window.addEventListener(GLOBAL_SEARCH_EVENT, consumeGlobalSearchTerm);
        return () => window.removeEventListener(GLOBAL_SEARCH_EVENT, consumeGlobalSearchTerm);
    }, []);

    // Listen for mini player expand event to reopen full player
    useEffect(() => {
        const handleMiniPlayerExpand = (e: CustomEvent) => {
            const { contentId, contentType, currentTime, seasonNumber: season, episodeNumber: episode } = e.detail;
            if (contentType === 'series' && contentId) {
                // Find the series in our list
                const foundSeries = series.find((s: Series) => s.series_id.toString() === contentId);
                if (foundSeries) {
                    // Set the season and episode to match PiP state
                    if (season !== undefined) setSelectedSeason(season);
                    if (episode !== undefined) setSelectedEpisode(episode);
                    setPipResumeTime(currentTime || 0);
                    setPlayingSeries(foundSeries);
                }
            }
        };

        window.addEventListener('miniPlayerExpand', handleMiniPlayerExpand as EventListener);
        return () => window.removeEventListener('miniPlayerExpand', handleMiniPlayerExpand as EventListener);
    }, [series]);

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
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to connect to server');
        } finally {
            setLoading(false);
        }
    };

    const filteredSeries = series.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());

        // Kids profile + Parental Control filtering
        if (!isItemVisible(s)) {
            return false;
        }

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

    // Windowed rendering (same mechanism as VOD): spacer rows keep the
    // scrollbar honest while only ~3 screens of cards stay mounted.
    const gridWindow = useWindowedGrid({
        scrollRef: scrollContainerRef,
        gridRef,
        itemCount: filteredSeries.length
    });
    const windowStart = gridWindow.ready ? gridWindow.start : 0;
    const windowEnd = gridWindow.ready ? gridWindow.end : Math.min(visibleCount, filteredSeries.length);

    // Reset on filter change
    useEffect(() => {
        setVisibleCount(itemsPerPage);
        setSelectedSeries(null);
        if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    }, [searchQuery, selectedCategory, itemsPerPage]);

    const fixImageUrl = (url: string): string => url && url.startsWith('http') ? url : `https://${url}`;

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

    const buildSeriesStreamUrl = async (seriesItem: Series): Promise<string> => {
        void seriesItem;
        try {
            const credResult = await window.ipcRenderer.invoke('auth:get-credentials');
            if (credResult.success) {
                const { url, username, password } = credResult.credentials;
                const episodes = seriesInfo?.episodes?.[selectedSeason];
                const episode = episodes?.find((ep) => Number(ep.episode_num) === selectedEpisode);

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
                    <span style={{ fontSize: '36px' }}>📺</span>
                </div>
                <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'white', margin: '0 0 8px 0' }}>
                    {t('login', 'loadSeriesError')}
                </h2>
                <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: '0 0 8px 0' }}>
                    {t('login', 'connectionErrorDetails')}
                </p>
                <p style={{
                    fontSize: '13px', color: '#f87171', margin: '0 0 32px 0',
                    padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)'
                }}>{error === 'Not authenticated' ? t('login', 'notAuthenticated') : error}</p>
                <button onClick={fetchSeries} style={{
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
                    placeholder={t('login', 'searchSeries')}
                />

                <CategoryMenu
                    onSelectCategory={setSelectedCategory}
                    selectedCategory={selectedCategory}
                    type="series"
                    isKidsProfile={isKidsProfile}
                />

                <div className="series-content">
                    {/* Series Details Panel */}
                    {selectedSeries && (
                        <SeriesDetailPanel
                            series={selectedSeries}
                            tmdbData={tmdbData}
                            loadingTmdb={loadingTmdb}
                            seriesInfo={seriesInfo}
                            selectedSeason={selectedSeason}
                            selectedEpisode={selectedEpisode}
                            getEpisodeTitle={getEpisodeTitle}
                            onSelectSeason={(season) => {
                                setSelectedSeason(season);
                                setSelectedEpisode(1);
                            }}
                            onSelectEpisode={setSelectedEpisode}
                            onPlay={() => handlePlaySeries(selectedSeries)}
                            onClearHistory={() => setShowClearHistoryConfirm(true)}
                            onClose={() => setSelectedSeries(null)}
                            onRefresh={() => setRefresh(r => r + 1)}
                        />
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
                                {gridWindow.topSpacer > 0 && (
                                    <div data-spacer="true" style={{ gridColumn: '1 / -1', height: gridWindow.topSpacer }} />
                                )}
                                {filteredSeries.slice(windowStart, windowEnd).map((s, index) => {
                                    const isSaved = watchLaterService.has(String(s.series_id), 'series');
                                    const isFavorite = favoritesService.has(String(s.series_id), 'series');
                                    const hasProgress = watchProgressService.getSeriesProgress(String(s.series_id), s.name);
                                    const isCompleted = watchProgressService.isSeriesCompleted(String(s.series_id));
                                    const yearMatch = s.release_date?.match(/(\d{4})/);
                                    const year = yearMatch ? yearMatch[1] : undefined;
                                    const genres = s.genre?.split(',').map(g => g.trim()).filter(Boolean);

                                    return (
                                        <div
                                            key={s.series_id}
                                            className={checkingItem === s.name ? 'checking' : ''}
                                            style={{ animationDelay: gridWindow.ready ? '0s' : `${(index % itemsPerPage) * 0.03}s` }}
                                        >
                                            <HoverPreviewCard
                                                type="series"
                                                id={s.series_id}
                                                cover={fixImageUrl(s.cover || s.stream_icon)}
                                                backdrop={s.backdrop_path?.[0] ? `https://image.tmdb.org/t/p/w780${s.backdrop_path[0]}` : undefined}
                                                title={s.name}
                                                year={year}
                                                rating={s.rating}
                                                genres={genres}
                                                plot={s.plot}
                                                youtubeTrailer={s.youtube_trailer}
                                                isFavorite={isFavorite}
                                                onPlay={() => {
                                                    handleSeriesClick(s);
                                                }}
                                                onMoreInfo={() => handleSeriesClick(s)}
                                                onToggleFavorite={() => {
                                                    if (isFavorite) {
                                                        favoritesService.remove(String(s.series_id), 'series');
                                                    } else {
                                                        favoritesService.add({
                                                            id: String(s.series_id),
                                                            type: 'series',
                                                            title: s.name,
                                                            poster: fixImageUrl(s.cover || s.stream_icon),
                                                            seriesId: s.series_id
                                                        });
                                                    }
                                                    setRefresh(r => r + 1);
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
                                                        fontSize: 14,
                                                        zIndex: 5
                                                    }}>🔖</span>
                                                )}

                                                {/* Completed Badge */}
                                                {isCompleted && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        top: 10,
                                                        left: 10,
                                                        background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)',
                                                        borderRadius: 8,
                                                        padding: '4px 8px',
                                                        fontSize: 14,
                                                        zIndex: 5
                                                    }}>✓</span>
                                                )}

                                                {/* Episode Progress Badge */}
                                                {hasProgress && !isCompleted && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        bottom: 50,
                                                        left: 8,
                                                        right: 8,
                                                        background: 'rgba(0, 0, 0, 0.85)',
                                                        borderRadius: 6,
                                                        padding: '5px 8px',
                                                        fontSize: 11,
                                                        fontWeight: 600,
                                                        color: '#c4b5fd',
                                                        textAlign: 'center',
                                                        zIndex: 5
                                                    }}>
                                                        T{hasProgress.lastWatchedSeason} E{hasProgress.lastWatchedEpisode}
                                                    </span>
                                                )}
                                            </HoverPreviewCard>
                                        </div>
                                    );
                                })}
                                {gridWindow.bottomSpacer > 0 && (
                                    <div data-spacer="true" style={{ gridColumn: '1 / -1', height: gridWindow.bottomSpacer }} />
                                )}
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
            {playingSeries && (
                <AsyncVideoPlayer
                    movie={playingSeries}
                    buildStreamUrl={buildSeriesStreamUrl}
                    onClose={() => {
                        setPlayingSeries(null);
                        setPipResumeTime(null);
                    }}
                    seriesId={String(playingSeries.series_id)}
                    seasonNumber={selectedSeason}
                    episodeNumber={selectedEpisode}
                    resumeTime={pipResumeTime}
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
                            (ep: SeriesEpisode) => Number(ep.episode_num) === selectedEpisode
                        );
                        const episodeName = currentEp ? getEpisodeTitle(currentEp.title || '', selectedEpisode, selectedSeason) : `Episódio ${selectedEpisode}`;
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
                        rating: selectedSeries.rating,
                        youtube_trailer: selectedSeries.youtube_trailer
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
    padding: 16px;
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

/* Series card checking state */
.series-card.checking {
    opacity: 0.6;
    pointer-events: none;
}

.series-card.checking::after {
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
