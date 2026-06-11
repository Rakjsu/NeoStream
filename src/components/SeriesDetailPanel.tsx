import { useState, useRef } from 'react';
import { type TMDBSeriesDetails } from '../services/tmdb';
import { watchLaterService } from '../services/watchLater';
import { favoritesService } from '../services/favoritesService';
import { watchProgressService } from '../services/watchProgressService';

export interface SeriesEpisode {
    id: number | string;
    episode_num: number | string;
    title?: string;
    info?: {
        duration?: string;
    };
    container_extension?: string;
}

export interface SeriesInfo {
    episodes?: Record<string, SeriesEpisode[]>;
}

interface SeriesDetailPanelSeries {
    name: string;
    series_id: number;
    cover: string;
    stream_icon: string;
}

interface SeriesDetailPanelProps {
    series: SeriesDetailPanelSeries;
    tmdbData: TMDBSeriesDetails | null;
    loadingTmdb: boolean;
    seriesInfo: SeriesInfo | null;
    selectedSeason: number;
    selectedEpisode: number;
    getEpisodeTitle: (fullTitle: string, episodeNum: number, season?: number) => string;
    onSelectSeason: (season: number) => void;
    onSelectEpisode: (episode: number) => void;
    onPlay: () => void;
    onClearHistory: () => void;
    onClose: () => void;
    onRefresh: () => void;
}

export function SeriesDetailPanel({
    series,
    tmdbData,
    loadingTmdb,
    seriesInfo,
    selectedSeason,
    selectedEpisode,
    getEpisodeTitle,
    onSelectSeason,
    onSelectEpisode,
    onPlay,
    onClearHistory,
    onClose,
    onRefresh
}: SeriesDetailPanelProps) {
    const seasonTabsRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStartX, setDragStartX] = useState(0);
    const [scrollStartX, setScrollStartX] = useState(0);

    return (
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
                <h1 className="series-title">{series.name}</h1>

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
                                            onSelectSeason(Number(season));
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
                        {seriesInfo?.episodes?.[selectedSeason] ? seriesInfo.episodes[selectedSeason].map((episode: SeriesEpisode, index: number) => {
                            const episodeNum = Number(episode.episode_num);
                            const progress = watchProgressService.getEpisodeProgress(String(series.series_id), selectedSeason, episodeNum);
                            const isSelected = selectedEpisode === episodeNum;
                            const isWatched = progress?.completed;
                            const progressPercent = progress ? Math.round((progress.currentTime / progress.duration) * 100) : 0;

                            return (
                                <div
                                    key={episode.id}
                                    className={`episode-card ${isSelected ? 'selected' : ''} ${isWatched ? 'watched' : ''}`}
                                    onClick={() => onSelectEpisode(episodeNum)}
                                    style={{ animationDelay: `${index * 0.03}s` }}
                                >
                                    <div className="episode-number-badge">
                                        {isWatched ? '✓' : episodeNum}
                                    </div>
                                    <div className="episode-info">
                                        <div className="episode-title-row">
                                            <span className="episode-title">{getEpisodeTitle(episode.title || '', episodeNum)}</span>
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
                        onClick={onPlay}
                    >
                        <span className="btn-icon">▶</span>
                        <span>Assistir</span>
                    </button>

                    <button
                        className={`btn btn-secondary ${watchLaterService.has(String(series.series_id), 'series') ? 'saved' : ''}`}
                        onClick={() => {
                            if (watchLaterService.has(String(series.series_id), 'series')) {
                                watchLaterService.remove(String(series.series_id), 'series');
                            } else {
                                watchLaterService.add({
                                    id: String(series.series_id),
                                    type: 'series',
                                    name: series.name,
                                    cover: series.cover || series.stream_icon
                                });
                            }
                            onRefresh();
                        }}
                    >
                        <span className="btn-icon">
                            {watchLaterService.has(String(series.series_id), 'series') ? '✓' : '+'}
                        </span>
                        <span>{watchLaterService.has(String(series.series_id), 'series') ? 'Salvo' : 'Minha Lista'}</span>
                    </button>

                    <button
                        className={`btn btn-favorite ${favoritesService.has(String(series.series_id), 'series') ? 'favorited' : ''}`}
                        onClick={() => {
                            favoritesService.toggle({
                                id: String(series.series_id),
                                type: 'series',
                                title: series.name,
                                poster: series.cover || series.stream_icon,
                                rating: tmdbData?.vote_average?.toFixed(1),
                                year: tmdbData?.first_air_date ? new Date(tmdbData.first_air_date).getFullYear().toString() : undefined,
                                seriesId: series.series_id
                            });
                            onRefresh();
                        }}
                        title={favoritesService.has(String(series.series_id), 'series') ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
                    >
                        <span className="btn-icon">
                            {favoritesService.has(String(series.series_id), 'series') ? '❤️' : '🤍'}
                        </span>
                    </button>

                    {watchProgressService.getSeriesProgress(String(series.series_id), series.name) && (
                        <button
                            className="btn btn-danger"
                            onClick={onClearHistory}
                        >
                            <span className="btn-icon">🗑️</span>
                            <span>Limpar Histórico</span>
                        </button>
                    )}

                    <button
                        className="btn btn-close"
                        onClick={onClose}
                    >
                        ✕
                    </button>
                </div>
            </div>
        </div>
    );
}
