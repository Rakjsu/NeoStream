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

        const seriesWithProgress: SeriesWithProgress[] = [];

        progressMap.forEach((progress, seriesId) => {
            const series = allSeries.find(s => String(s.series_id) === seriesId);
            if (series) {
                seriesWithProgress.push({
                    series,
                    progress: {
                        ...progress,
                        seriesName: series.name,
                    },
                });
            }
        });

        seriesWithProgress.sort((a, b) => b.progress.lastWatchedAt - a.progress.lastWatchedAt);
        setContinueWatching(seriesWithProgress);
    }, [allSeries]);

    if (continueWatching.length === 0) {
        return null;
    }

    // Calculate progress percentage (assuming 100 eps max for visual purposes)
    const calculateProgressPercentage = (episodeCount: number): number => {
        // This is a visual indicator, not accurate series completion
        // We'll use a simple heuristic: show progress based on episodes watched
        return Math.min((episodeCount / 20) * 100, 100);
    };

    return (
        <div className="mb-12 px-[32px]">
            {/* Premium Header */}
            <div className="mb-8 relative">
                <div className="flex items-center gap-4">
                    {/* Animated Icon */}
                    <div className="relative">
                        <div
                            className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full blur-lg opacity-50 animate-pulse"
                            style={{ width: '48px', height: '48px' }}
                        ></div>
                        <div
                            className="relative bg-gradient-to-br from-blue-600 to-purple-700 rounded-full flex items-center justify-center"
                            style={{ width: '48px', height: '48px' }}
                        >
                            <span className="text-2xl">▶️</span>
                        </div>
                    </div>

                    {/* Title with Gradient */}
                    <div>
                        <h2 className="text-3xl font-bold bg-gradient-to-r from-white via-blue-100 to-purple-200 bg-clip-text text-transparent">
                            Continue Assistindo
                        </h2>
                        <p className="text-sm text-gray-400 mt-1">Retome de onde parou</p>
                    </div>
                </div>

                {/* Decorative Line */}
                <div className="mt-4 h-1 bg-gradient-to-r from-blue-600 via-purple-600 to-transparent rounded-full"></div>
            </div>

            <div className="grid grid-cols-9 gap-[32px]">
                {continueWatching.slice(0, 9).map(({ series, progress }) => {
                    const progressPercentage = calculateProgressPercentage(progress.episodeCount);

                    return (
                        <div
                            key={series.series_id}
                            onClick={() => onSeriesClick(series)}
                            className="group cursor-pointer transition-all duration-500 hover:scale-[1.05] active:scale-95"
                        >
                            {/* Poster Image Container with Glow Effect */}
                            <div
                                className="relative overflow-hidden bg-gray-900 shadow-2xl transition-all duration-500 group-hover:shadow-blue-500/30"
                                style={{ borderRadius: '16px', border: '2px solid rgba(59, 130, 246, 0.1)' }}
                            >
                                <div className="aspect-[2/3] relative">
                                    <img
                                        src={series.cover || fixImageUrl(series.stream_icon)}
                                        alt={series.name}
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                        style={{ borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}
                                        loading="lazy"
                                        onError={(e) => {
                                            const target = e.target as HTMLImageElement;
                                            target.style.display = 'none';
                                            const parent = target.parentElement;
                                            if (parent) {
                                                parent.innerHTML = '<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900" style="border-top-left-radius: 16px; border-top-right-radius: 16px;"><span class="text-5xl">📺</span></div>';
                                            }
                                        }}
                                    />

                                    {/* Hover overlay with glassmorphism */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center justify-center">
                                        <div
                                            className="backdrop-blur-sm px-6 py-3 rounded-2xl transform translate-y-8 group-hover:translate-y-0 transition-all duration-500"
                                            style={{
                                                background: 'rgba(59, 130, 246, 0.3)',
                                                border: '2px solid rgba(255, 255, 255, 0.3)',
                                                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
                                            }}
                                        >
                                            <span className="text-white text-base font-bold flex items-center gap-3">
                                                <span className="text-2xl">▶</span>
                                                <span>Continuar Assistindo</span>
                                            </span>
                                        </div>
                                    </div>

                                    {/* Progress Bar at Bottom of Image */}
                                    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-800/80">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all duration-1000"
                                            style={{
                                                width: `${progressPercentage}%`,
                                                boxShadow: '0 0 10px rgba(59, 130, 246, 0.5)'
                                            }}
                                        ></div>
                                    </div>
                                </div>

                                {/* Title and Progress Info */}
                                <div style={{
                                    background: 'linear-gradient(to top, #0f172a, rgba(15, 23, 42, 0.95), rgba(31, 41, 55, 0.8))',
                                    borderBottomLeftRadius: '16px',
                                    borderBottomRightRadius: '16px',
                                    padding: '14px'
                                }}>
                                    <h3 className="text-white text-sm font-bold truncate mb-3 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-blue-400 group-hover:to-purple-400 group-hover:bg-clip-text transition-all duration-300">
                                        {series.name}
                                    </h3>

                                    {/* Progress Info with Icons */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-2 h-2 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 animate-pulse"
                                            ></div>
                                            <span className="text-gray-300 text-xs font-semibold">
                                                {Math.round(progressPercentage)}% assistido
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Elegant Divider */}
            <div className="mt-16 mb-12 flex items-center gap-4">
                <div className="flex-1 h-[2px] bg-gradient-to-r from-transparent via-gray-600 to-gray-600 rounded-full"></div>
                <div className="flex items-center gap-3 px-6 py-2 rounded-full" style={{
                    background: 'linear-gradient(135deg, rgba(31, 41, 55, 0.6), rgba(17, 24, 39, 0.8))',
                    border: '1px solid rgba(75, 85, 99, 0.3)'
                }}>
                    <div className="w-2 h-2 rounded-full bg-gradient-to-r from-gray-400 to-gray-500"></div>
                    <span className="text-gray-400 text-sm font-semibold tracking-wide">TODAS AS SÉRIES</span>
                    <div className="w-2 h-2 rounded-full bg-gradient-to-r from-gray-500 to-gray-400"></div>
                </div>
                <div className="flex-1 h-[2px] bg-gradient-to-l from-transparent via-gray-600 to-gray-600 rounded-full"></div>
            </div>
        </div>
    );
}
