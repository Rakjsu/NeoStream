interface EpisodeProgress {
    seriesId: string;
    seasonNumber: number;
    episodeNumber: number;
    watchedAt: number; // timestamp
    completed: boolean;
    currentTime?: number; // Video position in seconds
    duration?: number; // Total video duration
}

interface SeriesProgress {
    seriesId: string;
    seriesName: string;
    lastWatchedSeason: number;
    lastWatchedEpisode: number;
    lastWatchedAt: number;
    episodeCount: number; // Total episodes watched
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
            progress[existing] = { ...progress[existing], ...newEntry };
        } else {
            progress.push(newEntry);
        }

        this.saveProgress(progress);
    }

    // Save current video time for resume
    saveVideoTime(
        seriesId: string,
        seasonNumber: number,
        episodeNumber: number,
        currentTime: number,
        duration: number
    ): void {
        const progress = this.getProgress();
        const existing = progress.findIndex(
            (p) =>
                p.seriesId === seriesId &&
                p.seasonNumber === seasonNumber &&
                p.episodeNumber === episodeNumber
        );

        const entry: EpisodeProgress = {
            seriesId,
            seasonNumber,
            episodeNumber,
            watchedAt: Date.now(),
            completed: currentTime >= duration * 0.9, // 90% = completed
            currentTime,
            duration,
        };

        if (existing >= 0) {
            progress[existing] = { ...progress[existing], ...entry };
        } else {
            progress.push(entry);
        }

        this.saveProgress(progress);
    }

    // Get saved video time for resume
    getVideoTime(
        seriesId: string,
        seasonNumber: number,
        episodeNumber: number
    ): number | null {
        const progress = this.getProgress();
        const episode = progress.find(
            (p) =>
                p.seriesId === seriesId &&
                p.seasonNumber === seasonNumber &&
                p.episodeNumber === episodeNumber
        );

        if (episode?.currentTime && episode?.duration) {
            // Don't resume if already completed or less than 10 seconds
            if (episode.completed || episode.currentTime < 10) {
                return null;
            }
            // Don't resume if within last 30 seconds (probably finished)
            if (episode.duration - episode.currentTime < 30) {
                return null;
            }
            return episode.currentTime;
        }

        return null;
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

    // Get series progress WITHOUT needing total episodes
    getSeriesProgress(seriesId: string, seriesName: string): SeriesProgress | null {
        const progress = this.getProgress();
        const seriesEpisodes = progress.filter((p) => p.seriesId === seriesId);

        if (seriesEpisodes.length === 0) {
            return null;
        }

        // Find last watched episode
        const lastWatched = seriesEpisodes.reduce((latest, current) => {
            return current.watchedAt > latest.watchedAt ? current : latest;
        });

        return {
            seriesId,
            seriesName,
            lastWatchedSeason: lastWatched.seasonNumber,
            lastWatchedEpisode: lastWatched.episodeNumber,
            lastWatchedAt: lastWatched.watchedAt,
            episodeCount: seriesEpisodes.length,
        };
    }

    // Get all series with ANY watch history (for Continue Watching)
    getContinueWatching(): Map<string, SeriesProgress> {
        const progress = this.getProgress();
        const seriesMap = new Map<string, SeriesProgress>();

        // Group by series
        progress.forEach(ep => {
            if (!seriesMap.has(ep.seriesId)) {
                const seriesProgress = this.getSeriesProgress(ep.seriesId, '');
                if (seriesProgress) {
                    seriesMap.set(ep.seriesId, seriesProgress);
                }
            }
        });

        return seriesMap;
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
