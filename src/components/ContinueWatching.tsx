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
        totalEpisodes: number;
        watchedEpisodes: number;
        percentage: number;
        lastWatchedSeason: number;
        lastWatchedEpisode: number;
        lastWatchedAt: number;
        completed: boolean;
    };
}

export function ContinueWatching({ allSeries, onSeriesClick, fixImageUrl }: ContinueWatchingProps) {
    const [continueWatching, setContinueWatching] = useState<SeriesWithProgress[]>([]);

    useEffect(() => {
        console.log('🔍 [ContinueWatching] All series count:', allSeries.length);

        const progress = watchProgressService.getContinueWatching(allSeries);
        console.log('🔍 [ContinueWatching] Progress results:', progress);

        const seriesWithProgress = progress.map(prog => {
            const series = allSeries.find(s => String(s.series_id) === prog.seriesId);
            if (series) {
                console.log(`🔍 [ContinueWatching] Matched series: ${series.name}, Progress: ${prog.percentage}%`);
            }
            return series ? { series, progress: prog } : null;
        }).filter((item): item is SeriesWithProgress => item !== null);

        console.log('🔍 [ContinueWatching] Final series with progress:', seriesWithProgress.length);
        setContinueWatching(seriesWithProgress);
    }, [allSeries]);

    if (continueWatching.length === 0) {
        console.log('🔍 [ContinueWatching] No series to show, hiding section');
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

                            {/* Progress percentage badge */}
                            <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-sm px-2 py-1 rounded-md">
                                <span className="text-white text-xs font-bold">{progress.percentage}%</span>
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

                            {/* Progress Bar */}
                            <div className="mb-2">
                                <div className="w-full bg-gray-700 rounded-full h-1.5">
                                    <div
                                        className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                                        style={{ width: `${progress.percentage}%` }}
                                    ></div>
                                </div>
                            </div>

                            {/* Episode Info */}
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-gray-400">
                                    S{progress.lastWatchedSeason}:E{progress.lastWatchedEpisode}
                                </span>
                                <span className="text-gray-500">
                                    {progress.watchedEpisodes}/{progress.totalEpisodes} eps
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
