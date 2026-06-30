import { describe, it, expect, beforeEach, vi } from 'vitest';

// The service imports ./tmdb (network helpers) at module load. pruneExpired
// never calls them, but stub the module so importing the service is side-effect
// free in jsdom.
vi.mock('./tmdb', () => ({
    searchMovieByName: vi.fn(),
    searchSeriesByName: vi.fn(),
    isKidsFriendly: vi.fn(() => true)
}));

import { tmdbCacheService } from './tmdbCacheService';

const MOVIE_KEY = 'tmdb_cache_movies';
const SERIES_KEY = 'tmdb_cache_series';
const DAY = 24 * 60 * 60 * 1000;

describe('tmdbCacheService.pruneExpired', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('removes stamped-old entries (>30 days) and keeps fresh ones', () => {
        const now = 100 * DAY;
        localStorage.setItem(
            MOVIE_KEY,
            JSON.stringify({
                old: { certification: 'R', genres: [], cachedAt: now - 31 * DAY },
                fresh: { certification: 'PG', genres: [], cachedAt: now - 1 * DAY }
            })
        );

        const removed = tmdbCacheService.pruneExpired(now);

        expect(removed).toBe(1);
        const after = JSON.parse(localStorage.getItem(MOVIE_KEY)!);
        expect(Object.keys(after)).toEqual(['fresh']);
    });

    it('keeps unstamped (legacy) entries on the first pass but stamps them', () => {
        const now = 100 * DAY;
        localStorage.setItem(
            MOVIE_KEY,
            JSON.stringify({
                legacy: { certification: null, genres: [] } // no cachedAt
            })
        );

        const removed = tmdbCacheService.pruneExpired(now);

        expect(removed).toBe(0);
        const after = JSON.parse(localStorage.getItem(MOVIE_KEY)!);
        expect(after.legacy).toBeDefined();
        // Now stamped with `now` so a future sweep can expire it.
        expect(after.legacy.cachedAt).toBe(now);

        // A sweep 31 days later removes the now-stale (previously legacy) entry.
        const removedLater = tmdbCacheService.pruneExpired(now + 31 * DAY);
        expect(removedLater).toBe(1);
        expect(localStorage.getItem(MOVIE_KEY)).toBe('{}');
    });

    it('sweeps both the movie and series caches', () => {
        const now = 100 * DAY;
        localStorage.setItem(
            MOVIE_KEY,
            JSON.stringify({ m: { certification: null, genres: [], cachedAt: now - 40 * DAY } })
        );
        localStorage.setItem(
            SERIES_KEY,
            JSON.stringify({ s: { certification: null, genres: [], cachedAt: now - 40 * DAY } })
        );

        const removed = tmdbCacheService.pruneExpired(now);

        expect(removed).toBe(2);
        expect(localStorage.getItem(MOVIE_KEY)).toBe('{}');
        expect(localStorage.getItem(SERIES_KEY)).toBe('{}');
    });

    it('is idempotent — a second immediate pass removes nothing new', () => {
        const now = 100 * DAY;
        localStorage.setItem(
            MOVIE_KEY,
            JSON.stringify({
                old: { certification: 'R', genres: [], cachedAt: now - 31 * DAY },
                fresh: { certification: 'PG', genres: [], cachedAt: now - 1 * DAY }
            })
        );

        expect(tmdbCacheService.pruneExpired(now)).toBe(1);
        expect(tmdbCacheService.pruneExpired(now)).toBe(0);
    });
});
