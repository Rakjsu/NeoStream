// TMDB API Service
const TMDB_API_KEY = '9d8ec8b10e9b4acd85853c44b29bd83a';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

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
    try {
        // Fetch movie details with release dates for certification
        const response = await fetch(
            `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR&append_to_response=release_dates`
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

        return { ...data, certification };
    } catch (error) {
        return null;
    }
}

export async function fetchSeriesDetails(tmdbId: string): Promise<TMDBSeriesDetails | null> {
    if (!tmdbId) return null;
    try {
        // Fetch series details with content ratings
        const response = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR&append_to_response=content_ratings`
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

        return { ...data, certification };
    } catch (error) {
        return null;
    }
}

export function formatGenres(genres: { id: number; name: string }[]): string {
    return genres.map(g => g.name).join(', ');
}

export async function searchMovieByName(movieName: string, year?: string): Promise<TMDBMovieDetails | null> {
    try {
        let cleanName = movieName.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        cleanName = cleanName.replace(/\s*\[.*?\]\s*/g, '').trim();
        cleanName = cleanName.replace(/\s+/g, ' ').trim();

        const searchUrl = year
            ? `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(cleanName)}&year=${year}`
            : `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(cleanName)}`;

        const response = await fetch(searchUrl);
        if (!response.ok) return null;

        const data = await response.json();

        if (data.results && data.results.length > 0) {
            return await fetchMovieDetails(data.results[0].id.toString());
        }

        return null;
    } catch (error) {
        return null;
    }
}

export async function searchSeriesByName(seriesName: string, year?: string): Promise<TMDBSeriesDetails | null> {
    try {
        let cleanName = seriesName.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        cleanName = cleanName.replace(/\s*\[.*?\]\s*/g, '').trim();
        cleanName = cleanName.replace(/\s+/g, ' ').trim();

        const searchUrl = year
            ? `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(cleanName)}&first_air_date_year=${year}`
            : `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(cleanName)}`;

        const response = await fetch(searchUrl);
        if (!response.ok) return null;

        const data = await response.json();

        if (data.results && data.results.length > 0) {
            return await fetchSeriesDetails(data.results[0].id.toString());
        }

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
    try {
        let cleanName = movieName.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        cleanName = cleanName.replace(/\s*\[.*?\]\s*/g, '').trim();
        cleanName = cleanName.replace(/\s+/g, ' ').trim();

        // First, search for the movie
        const searchUrl = year
            ? `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanName)}&year=${year}`
            : `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanName)}`;

        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) return null;

        const searchData = await searchResponse.json();
        if (!searchData.results || searchData.results.length === 0) return null;

        const movieId = searchData.results[0].id;

        // Fetch videos for the movie
        const videosResponse = await fetch(
            `${TMDB_BASE_URL}/movie/${movieId}/videos?api_key=${TMDB_API_KEY}&language=pt-BR`
        );

        let videosData = await videosResponse.json();

        // If no videos in Portuguese, try English
        if (!videosData.results || videosData.results.length === 0) {
            const videosResponseEn = await fetch(
                `${TMDB_BASE_URL}/movie/${movieId}/videos?api_key=${TMDB_API_KEY}&language=en-US`
            );
            videosData = await videosResponseEn.json();
        }

        if (!videosData.results || videosData.results.length === 0) return null;

        // Prefer official trailer, then teaser, then any video
        const trailer = videosData.results.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube') ||
            videosData.results.find((v: any) => v.type === 'Teaser' && v.site === 'YouTube') ||
            videosData.results.find((v: any) => v.site === 'YouTube');

        if (trailer?.key) {
            return `https://www.youtube.com/watch?v=${trailer.key}`;
        }

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
    try {
        let cleanName = seriesName.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        cleanName = cleanName.replace(/\s*\[.*?\]\s*/g, '').trim();
        cleanName = cleanName.replace(/\s+/g, ' ').trim();

        // First, search for the series
        const searchUrl = year
            ? `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanName)}&first_air_date_year=${year}`
            : `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanName)}`;

        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) return null;

        const searchData = await searchResponse.json();
        if (!searchData.results || searchData.results.length === 0) return null;

        const seriesId = searchData.results[0].id;

        // Fetch videos for the series
        const videosResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${seriesId}/videos?api_key=${TMDB_API_KEY}&language=pt-BR`
        );

        let videosData = await videosResponse.json();

        // If no videos in Portuguese, try English
        if (!videosData.results || videosData.results.length === 0) {
            const videosResponseEn = await fetch(
                `${TMDB_BASE_URL}/tv/${seriesId}/videos?api_key=${TMDB_API_KEY}&language=en-US`
            );
            videosData = await videosResponseEn.json();
        }

        if (!videosData.results || videosData.results.length === 0) return null;

        // Prefer official trailer, then teaser, then any video
        const trailer = videosData.results.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube') ||
            videosData.results.find((v: any) => v.type === 'Teaser' && v.site === 'YouTube') ||
            videosData.results.find((v: any) => v.site === 'YouTube');

        if (trailer?.key) {
            return `https://www.youtube.com/watch?v=${trailer.key}`;
        }

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
    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbSeriesId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${TMDB_API_KEY}&language=pt-BR`
        );
        if (!response.ok) return null;
        return await response.json();
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

