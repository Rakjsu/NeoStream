import { profileService } from './profileService';

export interface MovieProgress {
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
    // Per-profile key, mirroring watchProgressService (series). Previously a
    // single global key `movie_watch_progress` held every profile's data and
    // filtered at query time — that leaked progress across profiles. The
    // legacy key is split into per-profile keys by migrateLegacyGlobalProgress().
    private STORAGE_KEY_PREFIX = 'movie_watch_progress';
    private LEGACY_GLOBAL_KEY = 'movie_watch_progress';

    private getStorageKey(): string {
        const activeProfile = profileService.getActiveProfile();
        return activeProfile
            ? `${this.STORAGE_KEY_PREFIX}_${activeProfile.id}`
            : this.STORAGE_KEY_PREFIX; // fallback (no active profile)
    }

    // Get all movie progress for the active profile
    private getProgress(): MovieProgress[] {
        const stored = localStorage.getItem(this.getStorageKey());
        return stored ? JSON.parse(stored) : [];
    }

    // Save movie progress for the active profile
    private saveProgress(progress: MovieProgress[]): void {
        localStorage.setItem(this.getStorageKey(), JSON.stringify(progress));
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

        const existing = progress.findIndex((p) => p.movieId === movieId);

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

    // Get specific movie progress (active profile)
    getMoviePositionById(movieId: string): MovieProgress | null {
        if (!profileService.getActiveProfile()) return null;
        return this.getProgress().find((p) => p.movieId === movieId) || null;
    }

    // Get movies in progress (1-94%)
    getMoviesInProgress(): string[] {
        if (!profileService.getActiveProfile()) return [];
        return this.getProgress()
            .filter((p) => p.progress > 0 && p.progress < 95)
            .map((p) => p.movieId);
    }

    // Get watched/completed movies (95%+)
    getWatchedMovies(): string[] {
        if (!profileService.getActiveProfile()) return [];
        return this.getProgress()
            .filter((p) => p.progress >= 95 || p.completed)
            .map((p) => p.movieId);
    }

    // Read-only watch history for the active profile (every movie with progress)
    getHistory(): MovieProgress[] {
        if (!profileService.getActiveProfile()) return [];
        return this.getProgress();
    }

    // Clear a single movie's progress (active profile)
    clearMovieProgress(movieId: string): void {
        const filtered = this.getProgress().filter((p) => p.movieId !== movieId);
        this.saveProgress(filtered);
    }

    // Clear all movie progress for the active profile
    clearAllProgress(): void {
        localStorage.removeItem(this.getStorageKey());
    }

    /**
     * One-time migration: split the legacy global `movie_watch_progress` array
     * (entries tagged with profileId) into per-profile keys
     * `movie_watch_progress_${profileId}`, then drop the legacy key. Idempotent
     * and safe to call on every boot (no-op once the legacy key is gone).
     */
    migrateLegacyGlobalProgress(): void {
        const legacy = localStorage.getItem(this.LEGACY_GLOBAL_KEY);
        if (!legacy) return;

        let entries: MovieProgress[];
        try {
            entries = JSON.parse(legacy);
        } catch {
            localStorage.removeItem(this.LEGACY_GLOBAL_KEY);
            return;
        }
        if (!Array.isArray(entries)) {
            localStorage.removeItem(this.LEGACY_GLOBAL_KEY);
            return;
        }

        // Group by profileId and merge into each profile's per-profile key.
        const byProfile = new Map<string, MovieProgress[]>();
        for (const entry of entries) {
            if (!entry || typeof entry.profileId !== 'string') continue;
            const list = byProfile.get(entry.profileId) ?? [];
            list.push(entry);
            byProfile.set(entry.profileId, list);
        }

        for (const [profileId, list] of byProfile) {
            const key = `${this.STORAGE_KEY_PREFIX}_${profileId}`;
            const existing: MovieProgress[] = (() => {
                const stored = localStorage.getItem(key);
                if (!stored) return [];
                try { return JSON.parse(stored); } catch { return []; }
            })();
            // Merge: keep the most-recent entry per movieId.
            const merged = new Map<string, MovieProgress>();
            for (const e of [...existing, ...list]) {
                const prev = merged.get(e.movieId);
                if (!prev || e.watchedAt > prev.watchedAt) merged.set(e.movieId, e);
            }
            localStorage.setItem(key, JSON.stringify([...merged.values()]));
        }

        localStorage.removeItem(this.LEGACY_GLOBAL_KEY);
    }
}

export const movieProgressService = new MovieProgressService();
