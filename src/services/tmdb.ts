// TMDB API Service
const TMDB_API_KEY = '9d8ec8b10e9b4acd85853c44b29bd83a';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

// ==================== CACHING SYSTEM ====================
const CACHE_EXPIRY_HOURS = 24; // Cache expires after 24 hours
const CACHE_KEYS = {
    MOVIE_DETAILS: 'tmdb_movie_details',
    SERIES_DETAILS: 'tmdb_series_details',
    EPISODE_DETAILS: 'tmdb_episode_details',
    MOVIE_TRAILERS: 'tmdb_movie_trailers',
    SERIES_TRAILERS: 'tmdb_series_trailers',
    MOVIE_SEARCH: 'tmdb_movie_search',
    SERIES_SEARCH: 'tmdb_series_search'
};

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

interface CacheStore<T> {
    [key: string]: CacheEntry<T>;
}

// In-memory cache (fast access)
const memoryCache: {
    movieDetails: CacheStore<any>;
    seriesDetails: CacheStore<any>;
    episodeDetails: CacheStore<any>;
    movieTrailers: CacheStore<string | null>;
    seriesTrailers: CacheStore<string | null>;
    movieSearch: CacheStore<string | null>; // name -> tmdbId
    seriesSearch: CacheStore<string | null>; // name -> tmdbId
} = {
    movieDetails: {},
    seriesDetails: {},
    episodeDetails: {},
    movieTrailers: {},
    seriesTrailers: {},
    movieSearch: {},
    seriesSearch: {}
};

// Load cache from localStorage on init
function loadCacheFromStorage<T>(key: string): CacheStore<T> {
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.warn(`Failed to load cache ${key}:`, e);
    }
    return {};
}

// Save cache to localStorage
function saveCacheToStorage<T>(key: string, cache: CacheStore<T>): void {
    try {
        // Clean expired entries before saving
        const cleaned: CacheStore<T> = {};
        const now = Date.now();
        const expiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;

        for (const [k, entry] of Object.entries(cache)) {
            if (now - entry.timestamp < expiryMs) {
                cleaned[k] = entry;
            }
        }

        localStorage.setItem(key, JSON.stringify(cleaned));
    } catch (e) {
        console.warn(`Failed to save cache ${key}:`, e);
    }
}

// Check if cache entry is valid
function isCacheValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    if (!entry) return false;
    const expiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
    return Date.now() - entry.timestamp < expiryMs;
}

// Initialize memory cache from localStorage
function initCache(): void {
    memoryCache.movieDetails = loadCacheFromStorage(CACHE_KEYS.MOVIE_DETAILS);
    memoryCache.seriesDetails = loadCacheFromStorage(CACHE_KEYS.SERIES_DETAILS);
    memoryCache.episodeDetails = loadCacheFromStorage(CACHE_KEYS.EPISODE_DETAILS);
    memoryCache.movieTrailers = loadCacheFromStorage(CACHE_KEYS.MOVIE_TRAILERS);
    memoryCache.seriesTrailers = loadCacheFromStorage(CACHE_KEYS.SERIES_TRAILERS);
    memoryCache.movieSearch = loadCacheFromStorage(CACHE_KEYS.MOVIE_SEARCH);
    memoryCache.seriesSearch = loadCacheFromStorage(CACHE_KEYS.SERIES_SEARCH);
}

// Initialize cache on module load
initCache();

// Generic cache get
function getCached<T>(store: CacheStore<T>, key: string): T | null {
    const entry = store[key];
    if (isCacheValid(entry)) {
        return entry.data;
    }
    return null;
}

// Generic cache set
function setCache<T>(store: CacheStore<T>, key: string, data: T, storageKey: string): void {
    store[key] = { data, timestamp: Date.now() };
    saveCacheToStorage(storageKey, store);
}

// Normalize search query for consistent cache keys
function normalizeSearchKey(name: string, year?: string): string {
    const cleanName = name.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ');
    return year ? `${cleanName}:${year}` : cleanName;
}

// API call counter for debugging
let apiCallCount = 0;
export function getTMDBApiCallCount(): number {
    return apiCallCount;
}

export function resetTMDBApiCallCount(): void {
    apiCallCount = 0;
}

// Get cache statistics
export function getTMDBCacheStats(): {
    movieDetails: number;
    seriesDetails: number;
    episodeDetails: number;
    movieTrailers: number;
    seriesTrailers: number;
    movieSearch: number;
    seriesSearch: number;
    apiCalls: number;
} {
    return {
        movieDetails: Object.keys(memoryCache.movieDetails).length,
        seriesDetails: Object.keys(memoryCache.seriesDetails).length,
        episodeDetails: Object.keys(memoryCache.episodeDetails).length,
        movieTrailers: Object.keys(memoryCache.movieTrailers).length,
        seriesTrailers: Object.keys(memoryCache.seriesTrailers).length,
        movieSearch: Object.keys(memoryCache.movieSearch).length,
        seriesSearch: Object.keys(memoryCache.seriesSearch).length,
        apiCalls: apiCallCount
    };
}

// Clear all TMDB cache
export function clearTMDBCache(): void {
    memoryCache.movieDetails = {};
    memoryCache.seriesDetails = {};
    memoryCache.episodeDetails = {};
    memoryCache.movieTrailers = {};
    memoryCache.seriesTrailers = {};
    memoryCache.movieSearch = {};
    memoryCache.seriesSearch = {};

    Object.values(CACHE_KEYS).forEach(key => {
        localStorage.removeItem(key);
    });

    }

/**
 * Get high-quality backdrop image URL from TMDB
 * @param backdropPath - The backdrop path from TMDB API
 * @param size - Image size (default: 'original' for highest quality)
 * @returns Full URL to backdrop image or null
 */
export function getBackdropUrl(backdropPath: string | null, size: string = 'original'): string | null {
    if (!backdropPath) return null;
    return `${TMDB_IMAGE_BASE_URL}/${size}${backdropPath}`;
}

export interface TMDBMovieDetails {
    id?: number;
    genres: { id: number; name: string }[];
    overview: string;
    title: string;
    release_date: string;
    vote_average: number;
    backdrop_path: string | null;
    certification?: string; // Content rating (G, PG, PG-13, R, etc.)
    imdb_id?: string; // IMDB ID for subtitle matching
}

export interface TMDBSeriesDetails {
    id?: number;
    genres: { id: number; name: string }[];
    overview: string;
    name: string;
    first_air_date: string;
    vote_average: number;
    backdrop_path: string | null;
    content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
    certification?: string; // Content rating for easy access
    imdb_id?: string; // IMDB ID for subtitle matching (from external_ids)
}

export interface TMDBEpisodeDetails {
    name: string;
    overview: string;
    episode_number: number;
    season_number: number;
    air_date: string;
}

export async function fetchMovieDetails(tmdbId: string): Promise<TMDBMovieDetails | null> {
    if (!tmdbId) return null;

    // Check cache first
    const cached = getCached<TMDBMovieDetails>(memoryCache.movieDetails, tmdbId);
    if (cached) {
        return cached;
    }

    try {
        apiCallCount++;
        // Fetch movie details with release dates for certification and external_ids for IMDB
        const response = await fetch(
            `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR&append_to_response=release_dates,external_ids`
        );
        if (!response.ok) return null;
        const data = await response.json();

        // Extract certification from release_dates
        let certification: string | undefined;
        if (data.release_dates?.results) {
            // Priority: BR (Brazil) > US > any other
            const brRelease = data.release_dates.results.find((r: any) => r.iso_3166_1 === 'BR');
            const usRelease = data.release_dates.results.find((r: any) => r.iso_3166_1 === 'US');
            const releaseData = brRelease || usRelease || data.release_dates.results[0];

            if (releaseData?.release_dates?.[0]?.certification) {
                certification = releaseData.release_dates[0].certification;
            }
        }

        const result = { ...data, certification };
        setCache(memoryCache.movieDetails, tmdbId, result, CACHE_KEYS.MOVIE_DETAILS);
        return result;
    } catch (error) {
        return null;
    }
}

export async function fetchSeriesDetails(tmdbId: string): Promise<TMDBSeriesDetails | null> {
    if (!tmdbId) return null;

    // Check cache first
    const cached = getCached<TMDBSeriesDetails>(memoryCache.seriesDetails, tmdbId);
    if (cached) {
        return cached;
    }

    try {
        apiCallCount++;
        // Fetch series details with content ratings and external_ids for IMDB
        const response = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR&append_to_response=content_ratings,external_ids`
        );
        if (!response.ok) return null;
        const data = await response.json();

        // Extract certification from content_ratings
        let certification: string | undefined;
        if (data.content_ratings?.results) {
            // Priority: BR (Brazil) > US > any other
            const brRating = data.content_ratings.results.find((r: any) => r.iso_3166_1 === 'BR');
            const usRating = data.content_ratings.results.find((r: any) => r.iso_3166_1 === 'US');
            const ratingData = brRating || usRating || data.content_ratings.results[0];

            if (ratingData?.rating) {
                certification = ratingData.rating;
            }
        }
        // Extract imdb_id from external_ids
        const imdb_id = data.external_ids?.imdb_id || undefined;

        const result = { ...data, certification, imdb_id };
        setCache(memoryCache.seriesDetails, tmdbId, result, CACHE_KEYS.SERIES_DETAILS);
        return result;
    } catch (error) {
        return null;
    }
}

export function formatGenres(genres: { id: number; name: string }[]): string {
    return genres.map(g => g.name).join(', ');
}

export async function searchMovieByName(movieName: string, year?: string): Promise<TMDBMovieDetails | null> {
    const searchKey = normalizeSearchKey(movieName, year);

    // Check if we have a cached TMDB ID for this search
    const cachedTmdbId = getCached<string | null>(memoryCache.movieSearch, searchKey);
    if (cachedTmdbId !== null) {
        if (cachedTmdbId === '') return null; // Cached "not found"
        return await fetchMovieDetails(cachedTmdbId);
    }

    try {
        let cleanName = movieName.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        cleanName = cleanName.replace(/\s*\[.*?\]\s*/g, '').trim();
        cleanName = cleanName.replace(/\s+/g, ' ').trim();

        const searchUrl = year
            ? `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(cleanName)}&year=${year}`
            : `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(cleanName)}`;

        apiCallCount++;
        const response = await fetch(searchUrl);
        if (!response.ok) return null;

        const data = await response.json();

        if (data.results && data.results.length > 0) {
            const tmdbId = data.results[0].id.toString();
            setCache(memoryCache.movieSearch, searchKey, tmdbId, CACHE_KEYS.MOVIE_SEARCH);
            return await fetchMovieDetails(tmdbId);
        }

        // Cache "not found" to avoid repeated searches
        setCache(memoryCache.movieSearch, searchKey, '', CACHE_KEYS.MOVIE_SEARCH);
        return null;
    } catch (error) {
        return null;
    }
}

export async function searchSeriesByName(seriesName: string, year?: string): Promise<TMDBSeriesDetails | null> {
    const searchKey = normalizeSearchKey(seriesName, year);

    // Check if we have a cached TMDB ID for this search
    const cachedTmdbId = getCached<string | null>(memoryCache.seriesSearch, searchKey);
    if (cachedTmdbId !== null) {
        if (cachedTmdbId === '') return null; // Cached "not found"
        return await fetchSeriesDetails(cachedTmdbId);
    }

    try {
        let cleanName = seriesName.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        cleanName = cleanName.replace(/\s*\[.*?\]\s*/g, '').trim();
        cleanName = cleanName.replace(/\s+/g, ' ').trim();

        const searchUrl = year
            ? `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(cleanName)}&first_air_date_year=${year}`
            : `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(cleanName)}`;

        apiCallCount++;
        const response = await fetch(searchUrl);
        if (!response.ok) return null;

        const data = await response.json();

        if (data.results && data.results.length > 0) {
            const tmdbId = data.results[0].id.toString();
            setCache(memoryCache.seriesSearch, searchKey, tmdbId, CACHE_KEYS.SERIES_SEARCH);
            return await fetchSeriesDetails(tmdbId);
        }

        // Cache "not found" to avoid repeated searches
        setCache(memoryCache.seriesSearch, searchKey, '', CACHE_KEYS.SERIES_SEARCH);
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Fetch movie trailer from TMDB
 * @param movieName - Movie name to search
 * @param year - Optional release year
 * @returns YouTube trailer URL or null if not found
 */
export async function fetchMovieTrailer(movieName: string, year?: string): Promise<string | null> {
    const cacheKey = normalizeSearchKey(movieName, year);

    // Check cache first
    const cached = getCached<string | null>(memoryCache.movieTrailers, cacheKey);
    if (cached !== null) {
        return cached === '' ? null : cached;
    }

    try {
        let cleanName = movieName.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        cleanName = cleanName.replace(/\s*\[.*?\]\s*/g, '').trim();
        cleanName = cleanName.replace(/\s+/g, ' ').trim();

        // First, search for the movie
        const searchUrl = year
            ? `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanName)}&year=${year}`
            : `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanName)}`;

        apiCallCount++;
        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) {
            setCache(memoryCache.movieTrailers, cacheKey, '', CACHE_KEYS.MOVIE_TRAILERS);
            return null;
        }

        const searchData = await searchResponse.json();
        if (!searchData.results || searchData.results.length === 0) {
            setCache(memoryCache.movieTrailers, cacheKey, '', CACHE_KEYS.MOVIE_TRAILERS);
            return null;
        }

        const movieId = searchData.results[0].id;

        // Fetch videos for the movie
        apiCallCount++;
        const videosResponse = await fetch(
            `${TMDB_BASE_URL}/movie/${movieId}/videos?api_key=${TMDB_API_KEY}&language=pt-BR`
        );

        let videosData = await videosResponse.json();

        // If no videos in Portuguese, try English
        if (!videosData.results || videosData.results.length === 0) {
            apiCallCount++;
            const videosResponseEn = await fetch(
                `${TMDB_BASE_URL}/movie/${movieId}/videos?api_key=${TMDB_API_KEY}&language=en-US`
            );
            videosData = await videosResponseEn.json();
        }

        if (!videosData.results || videosData.results.length === 0) {
            setCache(memoryCache.movieTrailers, cacheKey, '', CACHE_KEYS.MOVIE_TRAILERS);
            return null;
        }

        // Prefer official trailer, then teaser, then any video
        const trailer = videosData.results.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube') ||
            videosData.results.find((v: any) => v.type === 'Teaser' && v.site === 'YouTube') ||
            videosData.results.find((v: any) => v.site === 'YouTube');

        if (trailer?.key) {
            const trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
            setCache(memoryCache.movieTrailers, cacheKey, trailerUrl, CACHE_KEYS.MOVIE_TRAILERS);
            return trailerUrl;
        }

        setCache(memoryCache.movieTrailers, cacheKey, '', CACHE_KEYS.MOVIE_TRAILERS);
        return null;
    } catch (error) {
        console.error('Error fetching movie trailer:', error);
        return null;
    }
}

/**
 * Fetch series trailer from TMDB
 * @param seriesName - Series name to search
 * @param year - Optional first air date year
 * @returns YouTube trailer URL or null if not found
 */
export async function fetchSeriesTrailer(seriesName: string, year?: string): Promise<string | null> {
    const cacheKey = normalizeSearchKey(seriesName, year);

    // Check cache first
    const cached = getCached<string | null>(memoryCache.seriesTrailers, cacheKey);
    if (cached !== null) {
        return cached === '' ? null : cached;
    }

    try {
        let cleanName = seriesName.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        cleanName = cleanName.replace(/\s*\[.*?\]\s*/g, '').trim();
        cleanName = cleanName.replace(/\s+/g, ' ').trim();

        // First, search for the series
        const searchUrl = year
            ? `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanName)}&first_air_date_year=${year}`
            : `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanName)}`;

        apiCallCount++;
        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) {
            setCache(memoryCache.seriesTrailers, cacheKey, '', CACHE_KEYS.SERIES_TRAILERS);
            return null;
        }

        const searchData = await searchResponse.json();
        if (!searchData.results || searchData.results.length === 0) {
            setCache(memoryCache.seriesTrailers, cacheKey, '', CACHE_KEYS.SERIES_TRAILERS);
            return null;
        }

        const seriesId = searchData.results[0].id;

        // Fetch videos for the series
        apiCallCount++;
        const videosResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${seriesId}/videos?api_key=${TMDB_API_KEY}&language=pt-BR`
        );

        let videosData = await videosResponse.json();

        // If no videos in Portuguese, try English
        if (!videosData.results || videosData.results.length === 0) {
            apiCallCount++;
            const videosResponseEn = await fetch(
                `${TMDB_BASE_URL}/tv/${seriesId}/videos?api_key=${TMDB_API_KEY}&language=en-US`
            );
            videosData = await videosResponseEn.json();
        }

        if (!videosData.results || videosData.results.length === 0) {
            setCache(memoryCache.seriesTrailers, cacheKey, '', CACHE_KEYS.SERIES_TRAILERS);
            return null;
        }

        // Prefer official trailer, then teaser, then any video
        const trailer = videosData.results.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube') ||
            videosData.results.find((v: any) => v.type === 'Teaser' && v.site === 'YouTube') ||
            videosData.results.find((v: any) => v.site === 'YouTube');

        if (trailer?.key) {
            const trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
            setCache(memoryCache.seriesTrailers, cacheKey, trailerUrl, CACHE_KEYS.SERIES_TRAILERS);
            return trailerUrl;
        }

        setCache(memoryCache.seriesTrailers, cacheKey, '', CACHE_KEYS.SERIES_TRAILERS);
        return null;
    } catch (error) {
        console.error('Error fetching series trailer:', error);
        return null;
    }
}

/**
 * Fetch episode details from TMDB
 * @param tmdbSeriesId - TMDB series ID
 * @param seasonNumber - Season number
 * @param episodeNumber - Episode number
 * @returns Episode details or null if not found
 */
export async function fetchEpisodeDetails(
    tmdbSeriesId: string,
    seasonNumber: number,
    episodeNumber: number
): Promise<TMDBEpisodeDetails | null> {
    if (!tmdbSeriesId) return null;

    const cacheKey = `${tmdbSeriesId}:s${seasonNumber}:e${episodeNumber}`;

    // Check cache first
    const cached = getCached<TMDBEpisodeDetails>(memoryCache.episodeDetails, cacheKey);
    if (cached) {
        return cached;
    }

    try {
        apiCallCount++;
        const response = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbSeriesId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${TMDB_API_KEY}&language=pt-BR`
        );
        if (!response.ok) return null;
        const data = await response.json();
        setCache(memoryCache.episodeDetails, cacheKey, data, CACHE_KEYS.EPISODE_DETAILS);
        return data;
    } catch (error) {
        console.error('Error fetching episode details:', error);
        return null;
    }
}

/**
 * Check if content is appropriate for kids based on certification
 * Uses WHITELIST approach - only allows truly kids-friendly ratings
 * @param certification - Content rating
 * @returns true if content is kids-friendly
 */
export function isKidsFriendly(certification: string | undefined | null): boolean {
    if (!certification) {
        return false; // Unknown = block to be safe
    }

    const cert = certification.toUpperCase().trim();

    // ONLY these ratings are truly appropriate for young children
    const kidsFriendlyRatings = [
        // Brazilian ratings (Livre / 10 anos)
        'L', 'LIVRE', '10',
        // US Movie ratings
        'G',
        // US TV ratings  
        'TV-Y', 'TV-Y7', 'TV-G',
        // Australian
        'E', 'P', 'C',
        // UK
        'U', 'UC',
        // General
        '0', '6', '7', 'ALL'
    ];

    const isKidsFriendlyContent = kidsFriendlyRatings.includes(cert);
    return isKidsFriendlyContent;
}

// Check if content is adult-only (helper for reference)
export function isAdultContent(certification: string | undefined | null): boolean {
    return !isKidsFriendly(certification);
}

