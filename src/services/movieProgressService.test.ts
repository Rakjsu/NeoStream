import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the active profile so the service keys deterministically.
let activeId: string | null = 'p1';
vi.mock('./profileService', () => ({
    profileService: {
        getActiveProfile: () => (activeId ? { id: activeId } : null)
    }
}));

// Mock the active playlist so keys are scoped to a known playlist id. Defaults
// to 'plA'; tests flip it to assert per-playlist isolation. With a known id,
// the per-profile→per-playlist migration runs and storage keys become
// `movie_watch_progress_${profileId}__pl_${playlistId}`.
let playlistId = 'plA';
vi.mock('./activePlaylistService', () => ({
    getActivePlaylistId: () => playlistId,
    hasKnownPlaylistId: () => playlistId !== 'default',
    playlistScopedKey: (base: string, profileId: string) =>
        `${base}_${profileId}__pl_${playlistId}`
}));

import { movieProgressService, type MovieProgress } from './movieProgressService';

const entry = (over: Partial<MovieProgress> & { movieId: string; profileId: string }): MovieProgress => ({
    movieName: 'M',
    currentTime: 10,
    duration: 100,
    progress: 10,
    watchedAt: 1000,
    completed: false,
    ...over
});

describe('movieProgressService — per-profile', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('keys progress per profile (no leak across profiles)', () => {
        activeId = 'p1';
        movieProgressService.saveMovieTime('m1', 'Filme 1', 50, 100);
        activeId = 'p2';
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();
        expect(movieProgressService.getMoviesInProgress()).toEqual([]);

        activeId = 'p1';
        expect(movieProgressService.getMoviePositionById('m1')?.movieId).toBe('m1');
        expect(localStorage.getItem('movie_watch_progress_p1__pl_plA')).toBeTruthy();
        expect(localStorage.getItem('movie_watch_progress_p2__pl_plA')).toBeNull();
    });

    it('classifies in-progress vs watched by percentage', () => {
        movieProgressService.saveMovieTime('inprog', 'A', 40, 100); // 40%
        movieProgressService.saveMovieTime('done', 'B', 98, 100);   // 98% -> completed
        expect(movieProgressService.getMoviesInProgress()).toEqual(['inprog']);
        expect(movieProgressService.getWatchedMovies()).toEqual(['done']);
    });

    it('clearMovieProgress only affects the active profile', () => {
        movieProgressService.saveMovieTime('m1', 'A', 50, 100);
        movieProgressService.saveMovieTime('m2', 'B', 50, 100);
        movieProgressService.clearMovieProgress('m1');
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();
        expect(movieProgressService.getMoviePositionById('m2')?.movieId).toBe('m2');
    });

    it('no active profile -> reads return empty', () => {
        activeId = null;
        expect(movieProgressService.getMoviesInProgress()).toEqual([]);
        expect(movieProgressService.getHistory()).toEqual([]);
    });
});

describe('movieProgressService — per-playlist isolation', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('progress saved under playlist A is not visible under playlist B', () => {
        playlistId = 'plA';
        movieProgressService.saveMovieTime('m1', 'Filme 1', 50, 100);
        expect(movieProgressService.getMoviePositionById('m1')?.movieId).toBe('m1');

        playlistId = 'plB';
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();
        expect(movieProgressService.getMoviesInProgress()).toEqual([]);

        playlistId = 'plA';
        expect(movieProgressService.getMoviePositionById('m1')?.movieId).toBe('m1');
        expect(localStorage.getItem('movie_watch_progress_p1__pl_plA')).toBeTruthy();
        expect(localStorage.getItem('movie_watch_progress_p1__pl_plB')).toBeNull();
    });
});

describe('movieProgressService — per-profile → per-playlist migration', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('copies the per-profile key into the active playlist scope, then removes it', () => {
        localStorage.setItem('movie_watch_progress_p1', JSON.stringify([entry({ movieId: 'm1', profileId: 'p1' })]));

        // Any read triggers getStorageKey() → migration.
        expect(movieProgressService.getMoviePositionById('m1')?.movieId).toBe('m1');

        expect(localStorage.getItem('movie_watch_progress_p1')).toBeNull();
        const scoped = JSON.parse(localStorage.getItem('movie_watch_progress_p1__pl_plA')!);
        expect(scoped.map((e: MovieProgress) => e.movieId)).toEqual(['m1']);
    });

    it('is idempotent and does not clobber existing scoped data', () => {
        localStorage.setItem('movie_watch_progress_p1__pl_plA', JSON.stringify([entry({ movieId: 'keep', profileId: 'p1' })]));
        localStorage.setItem('movie_watch_progress_p1', JSON.stringify([entry({ movieId: 'old', profileId: 'p1' })]));

        movieProgressService.getMoviesInProgress(); // triggers migration
        movieProgressService.getMoviesInProgress(); // again — no-op

        expect(localStorage.getItem('movie_watch_progress_p1')).toBeNull();
        const scoped = JSON.parse(localStorage.getItem('movie_watch_progress_p1__pl_plA')!);
        // Existing scoped data preserved (old per-profile key NOT copied over it).
        expect(scoped.map((e: MovieProgress) => e.movieId)).toEqual(['keep']);
    });

    it('is skipped while the active playlist id is unknown (default fallback)', () => {
        playlistId = 'default';
        localStorage.setItem('movie_watch_progress_p1', JSON.stringify([entry({ movieId: 'm1', profileId: 'p1' })]));

        movieProgressService.getMoviesInProgress();

        // Old per-profile key untouched; nothing migrated to a scoped key.
        expect(localStorage.getItem('movie_watch_progress_p1')).toBeTruthy();
        expect(localStorage.getItem('movie_watch_progress_p1__pl_default')).toBeNull();
    });
});

describe('movieProgressService — legacy migration', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('splits the global key into per-profile keys, newest wins, and removes the legacy key', () => {
        const legacy: MovieProgress[] = [
            entry({ movieId: 'm1', profileId: 'p1', watchedAt: 100 }),
            entry({ movieId: 'm1', profileId: 'p1', watchedAt: 300, currentTime: 30 }), // newer dup
            entry({ movieId: 'm9', profileId: 'p2', watchedAt: 200 })
        ];
        localStorage.setItem('movie_watch_progress', JSON.stringify(legacy));

        movieProgressService.migrateLegacyGlobalProgress();

        expect(localStorage.getItem('movie_watch_progress')).toBeNull();
        const p1 = JSON.parse(localStorage.getItem('movie_watch_progress_p1')!);
        expect(p1).toHaveLength(1);
        expect(p1[0].currentTime).toBe(30); // newest dup won
        const p2 = JSON.parse(localStorage.getItem('movie_watch_progress_p2')!);
        expect(p2.map((e: MovieProgress) => e.movieId)).toEqual(['m9']);
    });

    it('merges with existing per-profile data without losing it', () => {
        localStorage.setItem('movie_watch_progress_p1', JSON.stringify([entry({ movieId: 'keep', profileId: 'p1', watchedAt: 500 })]));
        localStorage.setItem('movie_watch_progress', JSON.stringify([entry({ movieId: 'm1', profileId: 'p1', watchedAt: 100 })]));

        movieProgressService.migrateLegacyGlobalProgress();

        const ids = JSON.parse(localStorage.getItem('movie_watch_progress_p1')!).map((e: MovieProgress) => e.movieId).sort();
        expect(ids).toEqual(['keep', 'm1']);
    });

    it('is idempotent / no-op when the legacy key is absent or garbage', () => {
        movieProgressService.migrateLegacyGlobalProgress(); // absent
        localStorage.setItem('movie_watch_progress', 'not json');
        movieProgressService.migrateLegacyGlobalProgress();
        expect(localStorage.getItem('movie_watch_progress')).toBeNull();
    });
});
