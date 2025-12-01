import { useEffect, useState } from 'react';
import { watchProgressService } from '../services/watchProgressService';

interface ContinueWatchingProps {
    allSeries: any[];
    onSeriesClick: (series: any) => void;
    fixImageUrl: (url: string) => string;
}

interface SeriesWithProgress {
    series: any;
    progress: {
        seriesId: string;
        seriesName: string;
        lastWatchedSeason: number;
        lastWatchedEpisode: number;
        lastWatchedAt: number;
        episodeCount: number;
    };
}

export function ContinueWatching({ allSeries, onSeriesClick, fixImageUrl }: ContinueWatchingProps) {
    const [continueWatching, setContinueWatching] = useState<SeriesWithProgress[]>([]);

    useEffect(() => {
        const progressMap = watchProgressService.getContinueWatching();
        console.log(`🔍 [ContinueWatching] Watch history for ${progressMap.size} series`);

        const seriesWithProgress: SeriesWithProgress[] = [];

        progressMap.forEach((progress, seriesId) => {
            const series = allSeries.find(s => String(s.series_id) === seriesId);
            if (series) {
                seriesWithProgress.push({
                    series,
                    progress: {
                        ...progress,
                        seriesName: series.name, // Use actual series name
                    },
                });
                console.log(`✅ [ContinueWatching] ${series.name}: ${progress.episodeCount} episodes watched, last: S${progress.lastWatchedSeason}:E${progress.lastWatchedEpisode}`);
            }
        });

        // Sort by last watched (most recent first)
        seriesWithProgress.sort((a, b) => b.progress.lastWatchedAt - a.progress.lastWatchedAt);

        console.log(`🔍 [ContinueWatching] Showing ${seriesWithProgress.length} series`);
        setContinueWatching(seriesWithProgress);
    }, [allSeries]);

    if (continueWatching.length === 0) {
        return null; // Don't show section if no series in progress
    }

    return (
        <div className="mb-12 px-8">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="text-3xl">▶️</span>
                Continue Assistindo
            </h2>

            <div className="grid grid-cols-6 gap-6">
                {continueWatching.slice(0, 6).map(({ series, progress }) => (
                    <div
                        key={series.series_id}
                        onClick={() => onSeriesClick(series)}
                        className="group cursor-pointer transition-all duration-300 hover:scale-105"
                    >
                        {/* Poster Image */}
                        <div className="relative aspect-[2/3] rounded-t-lg overflow-hidden bg-gray-800 mb-0">
                            <img
                                src={series.cover || fixImageUrl(series.stream_icon)}
                                alt={series.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                    const parent = target.parentElement;
                                    if (parent) {
                                        parent.innerHTML = '<div class="w-full h-full flex items-center justify-center bg-gray-700"><span class="text-5xl">📺</span></div>';
                                    }
                                }}
                            />

                            {/* Episode count badge */}
                            <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-sm px-2 py-1 rounded-md">
                                <span className="text-white text-xs font-bold">{progress.episodeCount} eps</span>
                            </div>

                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-4">
                                <span className="text-white text-sm font-semibold">▶ Continuar</span>
                            </div>
                        </div>

                        {/* Title and Progress Info */}
                        <div className="bg-gradient-to-t from-gray-900 to-gray-800 rounded-b-lg p-3">
                            <h3 className="text-white text-sm font-semibold truncate mb-2 group-hover:text-blue-400 transition-colors">
                                {series.name}
                            </h3>

                            {/* Episode Info */}
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-blue-400 font-medium">
                                    S{progress.lastWatchedSeason}:E{progress.lastWatchedEpisode}
                                </span>
                                <span className="text-gray-500">
                                    {progress.episodeCount} assistidos
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
