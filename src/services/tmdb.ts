// TMDB API Service
// The key is the USER's own, set under Configurações → APIs (tmdbKey.ts).
// Builds no longer embed a project key; without one, every function here
// degrades to null and the app works without TMDB metadata.
import { getTmdbApiKey } from './tmdbKey';
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
    movieDetails: CacheStore<TMDBMovieDetails>;
    seriesDetails: CacheStore<TMDBSeriesDetails>;
    episodeDetails: CacheStore<TMDBEpisodeDetails>;
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

interface TMDBReleaseDateEntry {
    certification?: string;
}

interface TMDBReleaseResult {
    iso_3166_1: string;
    release_dates?: TMDBReleaseDateEntry[];
}

interface TMDBReleaseDates {
    results?: TMDBReleaseResult[];
}

interface TMDBExternalIds {
    imdb_id?: string;
}

interface TMDBSearchResult {
    id: number;
}

interface TMDBSearchResponse {
    results?: TMDBSearchResult[];
}

interface TMDBVideo {
    type?: string;
    site?: string;
    key?: string;
}

interface TMDBVideosResponse {
    results?: TMDBVideo[];
}

type TMDBMovieDetailsResponse = TMDBMovieDetails & {
    release_dates?: TMDBReleaseDates;
};

type TMDBSeriesDetailsResponse = TMDBSeriesDetails & {
    external_ids?: TMDBExternalIds;
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
    /** Franquia/coleção do filme — já vem no GET /movie/{id} padrão. */
    belongs_to_collection?: { id: number; name: string; poster_path: string | null } | null;
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
    if (!getTmdbApiKey()) return null; // sem chave configurada — sem metadados TMDB

    if (!tmdbId) return null;

    // Check cache first
    const cached = getCached<TMDBMovieDetails>(memoryCache.movieDetails, tmdbId);
    if (cached) {
        return cached;
    }

    try {
        // Fetch movie details with release dates for certification and external_ids for IMDB
        const response = await fetch(
            `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${getTmdbApiKey()}&language=pt-BR&append_to_response=release_dates,external_ids`
        );
        if (!response.ok) return null;
        const data = await response.json() as TMDBMovieDetailsResponse;

        // Extract certification from release_dates
        let certification: string | undefined;
        if (data.release_dates?.results) {
            // Priority: BR (Brazil) > US > any other
            const brRelease = data.release_dates.results.find((r) => r.iso_3166_1 === 'BR');
            const usRelease = data.release_dates.results.find((r) => r.iso_3166_1 === 'US');
            const releaseData = brRelease || usRelease || data.release_dates.results[0];

            if (releaseData?.release_dates?.[0]?.certification) {
                certification = releaseData.release_dates[0].certification;
            }
        }

        const result = { ...data, certification };
        setCache(memoryCache.movieDetails, tmdbId, result, CACHE_KEYS.MOVIE_DETAILS);
        return result;
    } catch {
        return null;
    }
}

export async function fetchSeriesDetails(tmdbId: string): Promise<TMDBSeriesDetails | null> {
    if (!getTmdbApiKey()) return null; // sem chave configurada — sem metadados TMDB

    if (!tmdbId) return null;

    // Check cache first
    const cached = getCached<TMDBSeriesDetails>(memoryCache.seriesDetails, tmdbId);
    if (cached) {
        return cached;
    }

    try {
        // Fetch series details with content ratings and external_ids for IMDB
        const response = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${getTmdbApiKey()}&language=pt-BR&append_to_response=content_ratings,external_ids`
        );
        if (!response.ok) return null;
        const data = await response.json() as TMDBSeriesDetailsResponse;

        // Extract certification from content_ratings
        let certification: string | undefined;
        if (data.content_ratings?.results) {
            // Priority: BR (Brazil) > US > any other
            const brRating = data.content_ratings.results.find((r) => r.iso_3166_1 === 'BR');
            const usRating = data.content_ratings.results.find((r) => r.iso_3166_1 === 'US');
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
    } catch {
        return null;
    }
}

export async function searchMovieByName(movieName: string, year?: string): Promise<TMDBMovieDetails | null> {
    if (!getTmdbApiKey()) return null; // sem chave configurada — sem metadados TMDB

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
            ? `${TMDB_BASE_URL}/search/movie?api_key=${getTmdbApiKey()}&language=pt-BR&query=${encodeURIComponent(cleanName)}&year=${year}`
            : `${TMDB_BASE_URL}/search/movie?api_key=${getTmdbApiKey()}&language=pt-BR&query=${encodeURIComponent(cleanName)}`;

        const response = await fetch(searchUrl);
        if (!response.ok) return null;

        const data = await response.json() as TMDBSearchResponse;

        if (data.results && data.results.length > 0) {
            const tmdbId = data.results[0].id.toString();
            setCache(memoryCache.movieSearch, searchKey, tmdbId, CACHE_KEYS.MOVIE_SEARCH);
            return await fetchMovieDetails(tmdbId);
        }

        // Cache "not found" to avoid repeated searches
        setCache(memoryCache.movieSearch, searchKey, '', CACHE_KEYS.MOVIE_SEARCH);
        return null;
    } catch {
        return null;
    }
}

export async function searchSeriesByName(seriesName: string, year?: string): Promise<TMDBSeriesDetails | null> {
    if (!getTmdbApiKey()) return null; // sem chave configurada — sem metadados TMDB

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
            ? `${TMDB_BASE_URL}/search/tv?api_key=${getTmdbApiKey()}&language=pt-BR&query=${encodeURIComponent(cleanName)}&first_air_date_year=${year}`
            : `${TMDB_BASE_URL}/search/tv?api_key=${getTmdbApiKey()}&language=pt-BR&query=${encodeURIComponent(cleanName)}`;

        const response = await fetch(searchUrl);
        if (!response.ok) return null;

        const data = await response.json() as TMDBSearchResponse;

        if (data.results && data.results.length > 0) {
            const tmdbId = data.results[0].id.toString();
            setCache(memoryCache.seriesSearch, searchKey, tmdbId, CACHE_KEYS.SERIES_SEARCH);
            return await fetchSeriesDetails(tmdbId);
        }

        // Cache "not found" to avoid repeated searches
        setCache(memoryCache.seriesSearch, searchKey, '', CACHE_KEYS.SERIES_SEARCH);
        return null;
    } catch {
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
    if (!getTmdbApiKey()) return null; // sem chave configurada — sem metadados TMDB

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
            ? `${TMDB_BASE_URL}/search/movie?api_key=${getTmdbApiKey()}&query=${encodeURIComponent(cleanName)}&year=${year}`
            : `${TMDB_BASE_URL}/search/movie?api_key=${getTmdbApiKey()}&query=${encodeURIComponent(cleanName)}`;

        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) {
            setCache(memoryCache.movieTrailers, cacheKey, '', CACHE_KEYS.MOVIE_TRAILERS);
            return null;
        }

        const searchData = await searchResponse.json() as TMDBSearchResponse;
        if (!searchData.results || searchData.results.length === 0) {
            setCache(memoryCache.movieTrailers, cacheKey, '', CACHE_KEYS.MOVIE_TRAILERS);
            return null;
        }

        const movieId = searchData.results[0].id;

        // Fetch videos for the movie
        const videosResponse = await fetch(
            `${TMDB_BASE_URL}/movie/${movieId}/videos?api_key=${getTmdbApiKey()}&language=pt-BR`
        );

        let videosData = await videosResponse.json() as TMDBVideosResponse;

        // If no videos in Portuguese, try English
        if (!videosData.results || videosData.results.length === 0) {
            const videosResponseEn = await fetch(
                `${TMDB_BASE_URL}/movie/${movieId}/videos?api_key=${getTmdbApiKey()}&language=en-US`
            );
            videosData = await videosResponseEn.json() as TMDBVideosResponse;
        }

        if (!videosData.results || videosData.results.length === 0) {
            setCache(memoryCache.movieTrailers, cacheKey, '', CACHE_KEYS.MOVIE_TRAILERS);
            return null;
        }

        // Prefer official trailer, then teaser, then any video
        const trailer = videosData.results.find((v) => v.type === 'Trailer' && v.site === 'YouTube') ||
            videosData.results.find((v) => v.type === 'Teaser' && v.site === 'YouTube') ||
            videosData.results.find((v) => v.site === 'YouTube');

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
    if (!getTmdbApiKey()) return null; // sem chave configurada — sem metadados TMDB

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
            ? `${TMDB_BASE_URL}/search/tv?api_key=${getTmdbApiKey()}&query=${encodeURIComponent(cleanName)}&first_air_date_year=${year}`
            : `${TMDB_BASE_URL}/search/tv?api_key=${getTmdbApiKey()}&query=${encodeURIComponent(cleanName)}`;

        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) {
            setCache(memoryCache.seriesTrailers, cacheKey, '', CACHE_KEYS.SERIES_TRAILERS);
            return null;
        }

        const searchData = await searchResponse.json() as TMDBSearchResponse;
        if (!searchData.results || searchData.results.length === 0) {
            setCache(memoryCache.seriesTrailers, cacheKey, '', CACHE_KEYS.SERIES_TRAILERS);
            return null;
        }

        const seriesId = searchData.results[0].id;

        // Fetch videos for the series
        const videosResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${seriesId}/videos?api_key=${getTmdbApiKey()}&language=pt-BR`
        );

        let videosData = await videosResponse.json() as TMDBVideosResponse;

        // If no videos in Portuguese, try English
        if (!videosData.results || videosData.results.length === 0) {
            const videosResponseEn = await fetch(
                `${TMDB_BASE_URL}/tv/${seriesId}/videos?api_key=${getTmdbApiKey()}&language=en-US`
            );
            videosData = await videosResponseEn.json() as TMDBVideosResponse;
        }

        if (!videosData.results || videosData.results.length === 0) {
            setCache(memoryCache.seriesTrailers, cacheKey, '', CACHE_KEYS.SERIES_TRAILERS);
            return null;
        }

        // Prefer official trailer, then teaser, then any video
        const trailer = videosData.results.find((v) => v.type === 'Trailer' && v.site === 'YouTube') ||
            videosData.results.find((v) => v.type === 'Teaser' && v.site === 'YouTube') ||
            videosData.results.find((v) => v.site === 'YouTube');

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
    if (!getTmdbApiKey()) return null; // sem chave configurada — sem metadados TMDB

    if (!tmdbSeriesId) return null;

    const cacheKey = `${tmdbSeriesId}:s${seasonNumber}:e${episodeNumber}`;

    // Check cache first
    const cached = getCached<TMDBEpisodeDetails>(memoryCache.episodeDetails, cacheKey);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbSeriesId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${getTmdbApiKey()}&language=pt-BR`
        );
        if (!response.ok) return null;
        const data = await response.json() as TMDBEpisodeDetails;
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


// ---------------------------------------------------------------------------
// 🎬 Coleções (franquias) e similares — cache simples em memória por sessão.
// ---------------------------------------------------------------------------

export interface TMDBCollectionPart {
    id: number;
    title: string;
    poster_path: string | null;
    release_date?: string;
}

export interface TMDBCollection {
    id: number;
    name: string;
    parts: TMDBCollectionPart[];
}

const collectionCache = new Map<string, TMDBCollection | null>();

export async function fetchCollection(collectionId: string): Promise<TMDBCollection | null> {
    if (!getTmdbApiKey() || !collectionId) return null;
    if (collectionCache.has(collectionId)) return collectionCache.get(collectionId) ?? null;
    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/collection/${collectionId}?api_key=${getTmdbApiKey()}&language=pt-BR`
        );
        if (!response.ok) {
            collectionCache.set(collectionId, null);
            return null;
        }
        const data = await response.json() as { id: number; name: string; parts?: TMDBCollectionPart[] };
        const result: TMDBCollection = {
            id: data.id,
            name: data.name,
            parts: (data.parts ?? [])
                .filter(part => part && part.id)
                .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'))
        };
        collectionCache.set(collectionId, result);
        return result;
    } catch {
        return null;
    }
}

export interface TMDBSimilarItem {
    id: number;
    title: string;
    poster_path: string | null;
    vote_average?: number;
}

const similarCache = new Map<string, TMDBSimilarItem[]>();

export async function fetchSimilarByTmdbId(tmdbId: string, type: 'movie' | 'series'): Promise<TMDBSimilarItem[]> {
    if (!getTmdbApiKey() || !tmdbId) return [];
    const cacheKey = `${type}:${tmdbId}`;
    const cached = similarCache.get(cacheKey);
    if (cached) return cached;
    try {
        const path = type === 'series' ? 'tv' : 'movie';
        const response = await fetch(
            `${TMDB_BASE_URL}/${path}/${tmdbId}/similar?api_key=${getTmdbApiKey()}&language=pt-BR`
        );
        if (!response.ok) return [];
        const data = await response.json() as {
            results?: { id: number; title?: string; name?: string; poster_path: string | null; vote_average?: number }[];
        };
        const result = (data.results ?? [])
            .filter(item => item.poster_path)
            .slice(0, 8)
            .map(item => ({
                id: item.id,
                title: item.title || item.name || '',
                poster_path: item.poster_path,
                vote_average: item.vote_average
            }));
        similarCache.set(cacheKey, result);
        return result;
    } catch {
        return [];
    }
}

export interface TMDBCastMember {
    id: number;
    name: string;
    character?: string;
    profile_path: string | null;
}

const castCache = new Map<string, TMDBCastMember[]>();

/** Elenco principal (até 12) do título — alimenta a filmografia clicável. */
export async function fetchCastByTmdbId(tmdbId: string, type: 'movie' | 'series'): Promise<TMDBCastMember[]> {
    if (!getTmdbApiKey() || !tmdbId) return [];
    const cacheKey = `${type}:${tmdbId}`;
    const cached = castCache.get(cacheKey);
    if (cached) return cached;
    try {
        const path = type === 'series' ? 'tv' : 'movie';
        const response = await fetch(
            `${TMDB_BASE_URL}/${path}/${tmdbId}/credits?api_key=${getTmdbApiKey()}&language=pt-BR`
        );
        if (!response.ok) return [];
        const data = await response.json() as { cast?: TMDBCastMember[] };
        const result = (data.cast ?? []).filter(member => member && member.id).slice(0, 12);
        castCache.set(cacheKey, result);
        return result;
    } catch {
        return [];
    }
}

const personCache = new Map<number, TMDBSimilarItem[]>();

/** Filmografia da pessoa (mais populares primeiro) — reusa o card dos similares. */
export async function fetchPersonFilmography(personId: number): Promise<TMDBSimilarItem[]> {
    if (!getTmdbApiKey() || !personId) return [];
    const cached = personCache.get(personId);
    if (cached) return cached;
    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/person/${personId}/movie_credits?api_key=${getTmdbApiKey()}&language=pt-BR`
        );
        if (!response.ok) return [];
        const data = await response.json() as {
            cast?: { id: number; title?: string; poster_path: string | null; vote_average?: number; popularity?: number }[];
        };
        const result = (data.cast ?? [])
            .filter(item => item && item.id && item.poster_path)
            .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
            .slice(0, 20)
            .map(item => ({ id: item.id, title: item.title ?? '', poster_path: item.poster_path, vote_average: item.vote_average }));
        personCache.set(personId, result);
        return result;
    } catch {
        return [];
    }
}
