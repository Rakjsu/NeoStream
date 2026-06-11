import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { watchProgressService } from '../services/watchProgressService';
import { LazyImage } from './LazyImage';
import { useLanguage } from '../services/languageService';

interface SeriesItem {
    series_id: string | number;
    name: string;
    cover?: string;
    stream_icon?: string;
}

interface NextEpisodeItem {
    series: SeriesItem;
    nextSeason: number;
    nextEpisode: number;
    lastWatchedAt: number;
}

interface NextEpisodesProps {
    allSeries: SeriesItem[];
}

/**
 * "Next episodes" row for the Home page.
 *
 * Episode counts per season are not stored locally, so the next episode is
 * computed optimistically as lastWatched + 1 in the same season (no season
 * rollover validation and no per-series provider API calls from Home).
 * Clicking a card simply navigates to the Series section.
 */
export function NextEpisodes({ allSeries }: NextEpisodesProps) {
    const navigate = useNavigate();
    const { t } = useLanguage();

    const nextEpisodes = useMemo<NextEpisodeItem[]>(() => {
        const progressMap = watchProgressService.getContinueWatching();
        const items: NextEpisodeItem[] = [];

        progressMap.forEach((progress, seriesId) => {
            const series = allSeries.find(s => String(s.series_id) === seriesId);
            if (!series) return;

            items.push({
                series,
                nextSeason: progress.lastWatchedSeason,
                nextEpisode: progress.lastWatchedEpisode + 1,
                lastWatchedAt: progress.lastWatchedAt
            });
        });

        items.sort((a, b) => b.lastWatchedAt - a.lastWatchedAt);
        return items.slice(0, 12);
    }, [allSeries]);

    if (nextEpisodes.length === 0) {
        return null;
    }

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
                    {`⏭️ ${t('home', 'nextEpisodes')}`}
                    <span style={{
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.5)',
                        fontWeight: 400
                    }}>({nextEpisodes.length})</span>
                </h2>
            </div>

            <div style={{
                display: 'flex',
                gap: 16,
                overflowX: 'auto',
                overflowY: 'visible',
                paddingBottom: 20,
                paddingTop: 4,
                scrollBehavior: 'smooth',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none'
            }}>
                {nextEpisodes.map(({ series, nextSeason, nextEpisode }) => (
                    <div
                        key={series.series_id}
                        className="content-card"
                        onClick={() => navigate('/dashboard/series')}
                        style={{
                            position: 'relative',
                            minWidth: 160,
                            maxWidth: 160,
                            borderRadius: '12px',
                            overflow: 'visible',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            flexShrink: 0,
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
                            <LazyImage
                                src={series.cover || series.stream_icon || ''}
                                alt={series.name}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover'
                                }}
                                fallback={
                                    <div style={{
                                        width: '100%',
                                        height: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 48
                                    }}>
                                        📺
                                    </div>
                                }
                            />

                            {/* Next episode badge */}
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
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6
                            }}>
                                <span style={{ color: '#34d399' }}>▶</span>
                                <span>T{nextSeason}E{nextEpisode}</span>
                            </div>
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
                            }}>{series.name}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
