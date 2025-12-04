import { profileService } from './profileService';

interface MovieProgress {
    movieId: string;
    movieName: string;
    profileId: string;
    currentTime: number;
    duration: number;
    progress: number; // Percentage 0-100
    watchedAt: number;
    completed: boolean;
}

class MovieProgressService {
    private STORAGE_KEY = 'movie_watch_progress';

    // Get all movie progress
    private getProgress(): MovieProgress[] {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    // Save movie progress
    private saveProgress(progress: MovieProgress[]): void {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(progress));
    }

    // Save/update movie watch progress
    saveMovieTime(
        movieId: string,
        movieName: string,
        currentTime: number,
        duration: number
    ): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        const progress = this.getProgress();
        const progressPercent = (currentTime / duration) * 100;
        const completed = progressPercent >= 95;

        const existing = progress.findIndex(
            (p) => p.movieId === movieId && p.profileId === activeProfile.id
        );

        const entry: MovieProgress = {
            movieId,
            movieName,
            profileId: activeProfile.id,
            currentTime,
            duration,
            progress: progressPercent,
            watchedAt: Date.now(),
            completed,
        };

        if (existing >= 0) {
            progress[existing] = entry;
        } else {
            progress.push(entry);
        }

        this.saveProgress(progress);
    }

    // Get specific movie progress
    getMoviePositionById(movieId: string): MovieProgress | null {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return null;

        const progress = this.getProgress();
        return progress.find(
            (p) => p.movieId === movieId && p.profileId === activeProfile.id
        ) || null;
    }

    // Get movies in progress (1-94%)
    getMoviesInProgress(): string[] {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return [];

        const progress = this.getProgress();
        return progress
            .filter(
                (p) =>
                    p.profileId === activeProfile.id &&
                    p.progress > 0 &&
                    p.progress < 95
            )
            .map((p) => p.movieId);
    }

    // Get watched/completed movies (95%+)
    getWatchedMovies(): string[] {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return [];

        const progress = this.getProgress();
        return progress
            .filter(
                (p) =>
                    p.profileId === activeProfile.id &&
                    (p.progress >= 95 || p.completed)
            )
            .map((p) => p.movieId);
    }

    // Clear movie progress
    clearMovieProgress(movieId: string): void {
        const progress = this.getProgress();
        const filtered = progress.filter((p) => p.movieId !== movieId);
        this.saveProgress(filtered);
    }

    // Clear all movie progress
    clearAllProgress(): void {
        localStorage.removeItem(this.STORAGE_KEY);
    }
}

export const movieProgressService = new MovieProgressService();
