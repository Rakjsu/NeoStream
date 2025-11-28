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
    genres: { id: number; name: string }[];
    overview: string;
    title: string;
    release_date: string;
    vote_average: number;
    backdrop_path: string | null;
}

export interface TMDBSeriesDetails {
    genres: { id: number; name: string }[];
    overview: string;
    name: string;
    first_air_date: string;
    vote_average: number;
    backdrop_path: string | null;
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
        const response = await fetch(`${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        return null;
    }
}

export async function fetchSeriesDetails(tmdbId: string): Promise<TMDBSeriesDetails | null> {
    if (!tmdbId) return null;
    try {
        const response = await fetch(`${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR`);
        if (!response.ok) return null;
        return await response.json();
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

