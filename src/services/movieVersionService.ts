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
 * Extract sequel/part numbers from movie name
 * e.g., "Velozes e Furiosos 9 [4K]" -> ["9"]
 *       "Matrix 2: Reloaded" -> ["2"]
 *       "Toy Story" -> []
 */
function extractSequelNumbers(name: string): string[] {
    // Remove year patterns like (2021) first
    const withoutYear = name.replace(/\s*\(\d{4}\)\s*/g, '');

    // Find standalone numbers that are likely sequel numbers (1-20)
    // Patterns: "Movie 2", "Movie II", "Part 3", "Chapter 4"
    const numbers: string[] = [];

    // Match patterns like "Movie 9", "Part 2", etc.
    const standaloneMatch = withoutYear.match(/\b(\d{1,2})\b/g);
    if (standaloneMatch) {
        standaloneMatch.forEach(num => {
            const n = parseInt(num);
            if (n >= 1 && n <= 20) {
                numbers.push(num);
            }
        });
    }

    // Match Roman numerals II, III, IV, V, etc.
    const romanMatch = withoutYear.match(/\b(II|III|IV|V|VI|VII|VIII|IX|X)\b/gi);
    if (romanMatch) {
        numbers.push(...romanMatch.map(r => r.toUpperCase()));
    }

    return numbers;
}

/**
 * Check if two movies are the same movie (different versions)
 */
export function isSameMovie(name1: string, name2: string): boolean {
    const base1 = getMovieBaseName(name1);
    const base2 = getMovieBaseName(name2);

    // Both names must be non-empty
    if (!base1 || !base2) return false;

    // Extract sequel numbers from original names (before cleaning)
    const numbers1 = extractSequelNumbers(name1);
    const numbers2 = extractSequelNumbers(name2);

    // If either movie has sequel numbers, they must match
    if (numbers1.length > 0 || numbers2.length > 0) {
        // Sort and compare
        const sorted1 = [...numbers1].sort().join(',');
        const sorted2 = [...numbers2].sort().join(',');

        if (sorted1 !== sorted2) {
            // Numbers don't match - different movies
            return false;
        }
    }

    // Exact match on base name - this is the safest
    if (base1 === base2) return true;

    // For partial matching, be very strict to avoid false positives:
    // 1. Both base names must be at least 8 characters (short names like "Urano" shouldn't use partial match)
    // 2. The shorter name must be at least 90% of the longer name's length (increased from 80%)
    // 3. One must contain the other completely
    const minLength = Math.min(base1.length, base2.length);
    const maxLength = Math.max(base1.length, base2.length);

    if (minLength < 8) {
        // For short names, only allow exact match (already handled above)
        return false;
    }

    // Check if one contains the other with strict length requirement
    if (base1.includes(base2) || base2.includes(base1)) {
        // The shorter name must be at least 90% of the longer name
        const ratio = minLength / maxLength;
        return ratio >= 0.9;
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
