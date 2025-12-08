import { searchMovieByName, searchSeriesByName, isKidsFriendly } from './tmdb';

// Cache structure stored in localStorage - keyed by content name
interface TMDBCacheItem {
    certification: string | null;
    genres: string[];
    cachedAt: number; // timestamp
}

interface TMDBCache {
    [contentName: string]: TMDBCacheItem;
}

const MOVIE_CACHE_KEY = 'tmdb_cache_movies';
const SERIES_CACHE_KEY = 'tmdb_cache_series';
const CACHE_EXPIRY_DAYS = 30; // Cache expires after 30 days

// Normalize name for cache key (lowercase, trim, remove special chars)
function normalizeName(name: string): string {
    return name.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ');
}

// Get movie cache from localStorage
function getMovieCache(): TMDBCache {
    try {
        const cached = localStorage.getItem(MOVIE_CACHE_KEY);
        return cached ? JSON.parse(cached) : {};
    } catch {
        return {};
    }
}

// Get series cache from localStorage
function getSeriesCache(): TMDBCache {
    try {
        const cached = localStorage.getItem(SERIES_CACHE_KEY);
        return cached ? JSON.parse(cached) : {};
    } catch {
        return {};
    }
}

// Save movie cache to localStorage
function saveMovieCache(cache: TMDBCache): void {
    try {
        localStorage.setItem(MOVIE_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.error('Failed to save movie cache:', e);
    }
}

// Save series cache to localStorage
function saveSeriesCache(cache: TMDBCache): void {
    try {
        localStorage.setItem(SERIES_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.error('Failed to save series cache:', e);
    }
}

// Check if cache item is expired
function isCacheExpired(cachedAt: number): boolean {
    const expiryTime = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - cachedAt > expiryTime;
}

export const tmdbCacheService = {
    // Get cached movie certification by name
    getCachedMovie(name: string): TMDBCacheItem | null {
        if (!name) return null;
        const key = normalizeName(name);
        const cache = getMovieCache();
        const item = cache[key];
        if (item && !isCacheExpired(item.cachedAt)) {
            return item;
        }
        return null;
    },

    // Get cached series certification by name
    getCachedSeries(name: string): TMDBCacheItem | null {
        if (!name) return null;
        const key = normalizeName(name);
        const cache = getSeriesCache();
        const item = cache[key];
        if (item && !isCacheExpired(item.cachedAt)) {
            return item;
        }
        return null;
    },

    // Cache movie data by name
    setCacheMovie(name: string, certification: string | null, genres: string[]): void {
        if (!name) return;
        const key = normalizeName(name);
        const cache = getMovieCache();
        cache[key] = {
            certification,
            genres,
            cachedAt: Date.now()
        };
        saveMovieCache(cache);
    },

    // Cache series data by name
    setCacheSeries(name: string, certification: string | null, genres: string[]): void {
        if (!name) return;
        const key = normalizeName(name);
        const cache = getSeriesCache();
        cache[key] = {
            certification,
            genres,
            cachedAt: Date.now()
        };
        saveSeriesCache(cache);
    },

    // Fetch movie from TMDB by name and cache it
    async fetchAndCacheMovie(name: string): Promise<TMDBCacheItem | null> {
        if (!name) return null;

        // Check cache first
        const cached = this.getCachedMovie(name);
        if (cached) {
            return cached;
        }

        // Search by name on TMDB
        try {
            // Extract year from name if present (e.g., "Movie Name (2023)")
            const yearMatch = name.match(/\((\d{4})\)/);
            const year = yearMatch ? yearMatch[1] : undefined;

            const data = await searchMovieByName(name, year);
            if (data) {
                const genres = data.genres?.map(g => g.name) || [];
                const certification = data.certification || null;
                this.setCacheMovie(name, certification, genres);
                return { certification, genres, cachedAt: Date.now() };
            }
        } catch (e) {
            console.error('Failed to fetch movie by name:', e);
        }

        // Cache as "not found" to avoid repeated searches
        this.setCacheMovie(name, null, []);
        return null;
    },

    // Fetch series from TMDB by name and cache it
    async fetchAndCacheSeries(name: string): Promise<TMDBCacheItem | null> {
        if (!name) return null;

        // Check cache first
        const cached = this.getCachedSeries(name);
        if (cached) return cached;

        // Search by name on TMDB
        try {
            // Extract year from name if present
            const yearMatch = name.match(/\((\d{4})\)/);
            const year = yearMatch ? yearMatch[1] : undefined;

            const data = await searchSeriesByName(name, year);
            if (data) {
                const genres = data.genres?.map(g => g.name) || [];
                const certification = data.certification || null;
                this.setCacheSeries(name, certification, genres);
                return { certification, genres, cachedAt: Date.now() };
            }
        } catch (e) {
            console.error('Failed to fetch series by name:', e);
        }

        // Cache as "not found" to avoid repeated searches
        this.setCacheSeries(name, null, []);
        return null;
    },

    // Check if movie is kids-friendly by name (from cache)
    isMovieKidsFriendly(name: string): boolean {
        const cached = this.getCachedMovie(name);
        if (cached) {
            return isKidsFriendly(cached.certification);
        }
        return true; // Not cached = allow (can't verify)
    },

    // Check if series is kids-friendly by name (from cache)
    isSeriesKidsFriendly(name: string): boolean {
        const cached = this.getCachedSeries(name);
        if (cached) {
            return isKidsFriendly(cached.certification);
        }
        return true; // Not cached = allow (can't verify)
    },

    // Batch fetch and cache multiple movies by name (optimized)
    async batchFetchMovies(names: string[]): Promise<void> {
        const uncached = names.filter(name => !this.getCachedMovie(name));
        if (uncached.length === 0) return; // Skip if all cached

        // Fetch in parallel with higher concurrency for speed
        const BATCH_SIZE = 10;
        for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
            const batch = uncached.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(name => this.fetchAndCacheMovie(name)));
        }
    },

    // Batch fetch and cache multiple series by name (optimized)
    async batchFetchSeries(names: string[]): Promise<void> {
        const uncached = names.filter(name => !this.getCachedSeries(name));
        if (uncached.length === 0) return; // Skip if all cached

        // Fetch in parallel with higher concurrency for speed
        const BATCH_SIZE = 10;
        for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
            const batch = uncached.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(name => this.fetchAndCacheSeries(name)));
        }
    },

    // Get cache stats
    getStats(): { movies: number; series: number } {
        return {
            movies: Object.keys(getMovieCache()).length,
            series: Object.keys(getSeriesCache()).length
        };
    },

    // Clear all cache
    clearCache(): void {
        localStorage.removeItem(MOVIE_CACHE_KEY);
        localStorage.removeItem(SERIES_CACHE_KEY);
    }
};
