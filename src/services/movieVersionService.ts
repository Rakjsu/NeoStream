/**
 * Movie Version Service
 * Detects and manages different versions of the same movie (1080p, 4K, Legendado, etc.)
 */

export interface MovieVersion {
    movie: any; // VODStream
    quality: '1080p' | '4k';
    audio: 'dubbed' | 'subtitled'; // dublado or legendado
    label: string; // Display label e.g., "1080p Dublado", "4K Legendado"
}

/**
 * Detect if movie name contains 4K marker
 */
function is4K(name: string): boolean {
    return /4k/i.test(name);
}

/**
 * Detect if movie name contains [L] marker for Legendado
 */
function isSubtitled(name: string): boolean {
    return /\[L\]/i.test(name);
}

/**
 * Get version info from movie name
 */
export function getVersionInfo(name: string): { quality: '1080p' | '4k'; audio: 'dubbed' | 'subtitled' } {
    return {
        quality: is4K(name) ? '4k' : '1080p',
        audio: isSubtitled(name) ? 'subtitled' : 'dubbed'
    };
}

/**
 * Get display label for a version
 */
export function getVersionLabel(quality: '1080p' | '4k', audio: 'dubbed' | 'subtitled'): string {
    const qualityLabel = quality === '4k' ? '4K' : '1080p';
    const audioLabel = audio === 'subtitled' ? 'Legendado' : 'Dublado';
    return `${qualityLabel} ${audioLabel}`;
}

/**
 * Extract base movie name by removing version markers and year
 * e.g., "Avatar 4K [L] (2009)" -> "avatar"
 */
export function getMovieBaseName(name: string): string {
    return name
        .replace(/\s*\[L\]\s*/gi, '') // Remove [L]
        .replace(/\s*4k\s*/gi, ' ')    // Remove 4K
        .replace(/\s*\(\d{4}\)\s*/g, '') // Remove year (2009)
        .replace(/\s*\[.*?\]\s*/g, '') // Remove any other brackets
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/gi, '') // Remove special chars
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim();
}

/**
 * Check if two movies are the same movie (different versions)
 */
export function isSameMovie(name1: string, name2: string): boolean {
    const base1 = getMovieBaseName(name1);
    const base2 = getMovieBaseName(name2);

    // Exact match on base name
    if (base1 === base2) return true;

    // One name contains the other (for slight variations)
    if (base1.includes(base2) || base2.includes(base1)) {
        // Only if length difference is small (avoid false positives)
        const lenDiff = Math.abs(base1.length - base2.length);
        return lenDiff <= 5;
    }

    return false;
}

/**
 * Find all versions of a movie from the full movie list
 */
export function findMovieVersions(currentMovie: any, allMovies: any[]): MovieVersion[] {
    if (!currentMovie || !allMovies || allMovies.length === 0) {
        return [];
    }

    const currentBaseName = getMovieBaseName(currentMovie.name);

    // Find all movies with the same base name
    const relatedMovies = allMovies.filter(movie =>
        isSameMovie(movie.name, currentMovie.name)
    );

    // Convert to MovieVersion objects
    const versions: MovieVersion[] = relatedMovies.map(movie => {
        const info = getVersionInfo(movie.name);
        return {
            movie,
            quality: info.quality,
            audio: info.audio,
            label: getVersionLabel(info.quality, info.audio)
        };
    });

    // Sort versions: 1080p Dublado first, then 1080p Legendado, 4K Dublado, 4K Legendado
    versions.sort((a, b) => {
        const order = {
            '1080p-dubbed': 0,
            '1080p-subtitled': 1,
            '4k-dubbed': 2,
            '4k-subtitled': 3
        };
        const keyA = `${a.quality}-${a.audio}` as keyof typeof order;
        const keyB = `${b.quality}-${b.audio}` as keyof typeof order;
        return (order[keyA] ?? 4) - (order[keyB] ?? 4);
    });

    // Remove duplicates (same quality + audio)
    const seen = new Set<string>();
    return versions.filter(v => {
        const key = `${v.quality}-${v.audio}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Check if a movie matches a specific version
 */
export function isCurrentVersion(movie: any, version: MovieVersion): boolean {
    return movie.stream_id === version.movie.stream_id;
}
