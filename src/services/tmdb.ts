// TMDB API Service
const TMDB_API_KEY = '9d8ec8b10e9b4acd85853c44b29bd83a';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export interface TMDBMovieDetails {
    genres: { id: number; name: string }[];
    overview: string;
    title: string;
    release_date: string;
    vote_average: number;
}

export interface TMDBSeriesDetails {
    genres: { id: number; name: string }[];
    overview: string;
    name: string;
    first_air_date: string;
    vote_average: number;
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
