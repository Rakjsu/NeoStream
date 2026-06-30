import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the active profile so the service keys deterministically.
let activeId: string | null = 'p1';
vi.mock('./profileService', () => ({
    profileService: {
        getActiveProfile: () => (activeId ? { id: activeId } : null)
    }
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
    });

    it('keys progress per profile (no leak across profiles)', () => {
        activeId = 'p1';
        movieProgressService.saveMovieTime('m1', 'Filme 1', 50, 100);
        activeId = 'p2';
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();
        expect(movieProgressService.getMoviesInProgress()).toEqual([]);

        activeId = 'p1';
        expect(movieProgressService.getMoviePositionById('m1')?.movieId).toBe('m1');
        expect(localStorage.getItem('movie_watch_progress_p1')).toBeTruthy();
        expect(localStorage.getItem('movie_watch_progress_p2')).toBeNull();
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

describe('movieProgressService — legacy migration', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
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
