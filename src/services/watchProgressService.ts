interface EpisodeProgress {
    seriesId: string;
    seasonNumber: number;
    episodeNumber: number;
    watchedAt: number; // timestamp
    completed: boolean;
}

interface SeriesProgress {
    seriesId: string;
    seriesName: string;
    totalEpisodes: number;
    watchedEpisodes: number;
    percentage: number;
    lastWatchedSeason: number;
    lastWatchedEpisode: number;
    lastWatchedAt: number;
    completed: boolean;
}

class WatchProgressService {
    private STORAGE_KEY = 'series_watch_progress';

    // Get all watch progress
    private getProgress(): EpisodeProgress[] {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    // Save progress
    private saveProgress(progress: EpisodeProgress[]): void {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(progress));
    }

    // Mark episode as watched
    markEpisodeWatched(
        seriesId: string,
        seasonNumber: number,
        episodeNumber: number
    ): void {
        const progress = this.getProgress();
        const existing = progress.findIndex(
            (p) =>
                p.seriesId === seriesId &&
                p.seasonNumber === seasonNumber &&
                p.episodeNumber === episodeNumber
        );

        const newEntry: EpisodeProgress = {
            seriesId,
            seasonNumber,
            episodeNumber,
            watchedAt: Date.now(),
            completed: true,
        };

        if (existing >= 0) {
            progress[existing] = newEntry;
        } else {
            progress.push(newEntry);
        }

        this.saveProgress(progress);
    }

    // Check if episode is watched
    isEpisodeWatched(
        seriesId: string,
        seasonNumber: number,
        episodeNumber: number
    ): boolean {
        const progress = this.getProgress();
        return progress.some(
            (p) =>
                p.seriesId === seriesId &&
                p.seasonNumber === seasonNumber &&
                p.episodeNumber === episodeNumber &&
                p.completed
        );
    }

    // Get series progress with total episodes
    getSeriesProgress(seriesId: string, totalEpisodes: number, seriesName: string): SeriesProgress | null {
        const progress = this.getProgress();
        const seriesEpisodes = progress.filter((p) => p.seriesId === seriesId && p.completed);

        if (seriesEpisodes.length === 0) {
            return null;
        }

        // Find last watched episode
        const lastWatched = seriesEpisodes.reduce((latest, current) => {
            return current.watchedAt > latest.watchedAt ? current : latest;
        });

        const watchedCount = seriesEpisodes.length;
        const percentage = Math.round((watchedCount / totalEpisodes) * 100);

        return {
            seriesId,
            seriesName,
            totalEpisodes,
            watchedEpisodes: watchedCount,
            percentage,
            lastWatchedSeason: lastWatched.seasonNumber,
            lastWatchedEpisode: lastWatched.episodeNumber,
            lastWatchedAt: lastWatched.watchedAt,
            completed: percentage >= 100,
        };
    }

    // Get all series in progress (0% < x < 100%)
    getContinueWatching(allSeries: any[]): SeriesProgress[] {
        const inProgress: SeriesProgress[] = [];

        for (const series of allSeries) {
            // Calculate total episodes from all seasons
            const totalEpisodes = series.seasons?.reduce((sum: number, season: any) => {
                return sum + (season.episode_count || 0);
            }, 0) || 0;

            if (totalEpisodes === 0) continue;

            const progress = this.getSeriesProgress(series.series_id, totalEpisodes, series.name);

            if (progress && progress.percentage > 0 && progress.percentage < 100) {
                inProgress.push(progress);
            }
        }

        // Sort by last watched (most recent first)
        return inProgress.sort((a, b) => b.lastWatchedAt - a.lastWatchedAt);
    }

    // Get completed series (100%)
    getCompletedSeries(allSeries: any[]): SeriesProgress[] {
        const completed: SeriesProgress[] = [];

        for (const series of allSeries) {
            const totalEpisodes = series.seasons?.reduce((sum: number, season: any) => {
                return sum + (season.episode_count || 0);
            }, 0) || 0;

            if (totalEpisodes === 0) continue;

            const progress = this.getSeriesProgress(series.series_id, totalEpisodes, series.name);

            if (progress && progress.percentage >= 100) {
                completed.push(progress);
            }
        }

        // Sort by last watched
        return completed.sort((a, b) => b.lastWatchedAt - a.lastWatchedAt);
    }

    // Get next unwatched episode for a series
    getNextEpisode(seriesId: string, seasons: any[]): {
        seasonNumber: number;
        episodeNumber: number;
    } | null {
        // Go through all seasons and episodes to find first unwatched
        for (const season of seasons) {
            const seasonNum = season.season_number;
            const episodeCount = season.episode_count || 0;

            for (let epNum = 1; epNum <= episodeCount; epNum++) {
                if (!this.isEpisodeWatched(seriesId, seasonNum, epNum)) {
                    return {
                        seasonNumber: seasonNum,
                        episodeNumber: epNum,
                    };
                }
            }
        }

        return null; // All episodes watched
    }

    // Clear progress for a series
    clearSeriesProgress(seriesId: string): void {
        const progress = this.getProgress();
        const filtered = progress.filter((p) => p.seriesId !== seriesId);
        this.saveProgress(filtered);
    }

    // Clear all progress
    clearAllProgress(): void {
        localStorage.removeItem(this.STORAGE_KEY);
    }
}

export const watchProgressService = new WatchProgressService();
