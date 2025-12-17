/**
 * Subtitle Service
 * Fetches subtitles from OpenSubtitles API
 */

const OPENSUBTITLES_API_KEY = 'SG2i7zzvvhSdqYbgFRVDPqb8vQkJMDs9';
const OPENSUBTITLES_BASE_URL = 'https://api.opensubtitles.com/api/v1';

interface SubtitleResult {
    id: string;
    language: string;
    release: string;
    downloadCount: number;
    url: string;
    fileId: number;
}

interface SubtitleSearchParams {
    query?: string;
    imdbId?: string;
    tmdbId?: string | number;
    languages?: string; // e.g., 'pt-br,en'
    season?: number;
    episode?: number;
}

/**
 * Search for subtitles on OpenSubtitles
 */
export async function searchSubtitles(params: SubtitleSearchParams): Promise<SubtitleResult[]> {
    try {
        const searchParams = new URLSearchParams();

        if (params.query) searchParams.set('query', params.query);
        if (params.imdbId) searchParams.set('imdb_id', params.imdbId);
        if (params.tmdbId) searchParams.set('tmdb_id', String(params.tmdbId));
        if (params.languages) searchParams.set('languages', params.languages);
        if (params.season) searchParams.set('season_number', String(params.season));
        if (params.episode) searchParams.set('episode_number', String(params.episode));

        const response = await fetch(`${OPENSUBTITLES_BASE_URL}/subtitles?${searchParams.toString()}`, {
            method: 'GET',
            headers: {
                'Api-Key': OPENSUBTITLES_API_KEY,
                'Content-Type': 'application/json',
                'User-Agent': 'NeoStream IPTV v2.9.0'
            }
        });

        if (!response.ok) {
            console.error('OpenSubtitles search failed:', response.status, response.statusText);
            return [];
        }

        const data = await response.json();

        if (!data.data || !Array.isArray(data.data)) {
            return [];
        }

        // Map to simpler format
        return data.data.map((item: any) => ({
            id: item.id,
            language: item.attributes?.language || 'unknown',
            release: item.attributes?.release || item.attributes?.files?.[0]?.file_name || 'Unknown',
            downloadCount: item.attributes?.download_count || 0,
            url: item.attributes?.url || '',
            fileId: item.attributes?.files?.[0]?.file_id || 0
        })).filter((sub: SubtitleResult) => sub.fileId > 0);
    } catch (error) {
        console.error('Error searching subtitles:', error);
        return [];
    }
}

/**
 * Download subtitle file and get the content URL
 */
export async function downloadSubtitle(fileId: number): Promise<string | null> {
    try {
        const response = await fetch(`${OPENSUBTITLES_BASE_URL}/download`, {
            method: 'POST',
            headers: {
                'Api-Key': OPENSUBTITLES_API_KEY,
                'Content-Type': 'application/json',
                'User-Agent': 'NeoStream IPTV v2.9.0'
            },
            body: JSON.stringify({ file_id: fileId })
        });

        if (!response.ok) {
            console.error('OpenSubtitles download failed:', response.status, response.statusText);
            return null;
        }

        const data = await response.json();
        return data.link || null;
    } catch (error) {
        console.error('Error downloading subtitle:', error);
        return null;
    }
}

/**
 * Convert SRT content to WebVTT format for HTML5 video
 */
export function srtToVtt(srtContent: string): string {
    // Add WebVTT header
    let vtt = 'WEBVTT\n\n';

    // Replace SRT timestamp format (00:00:00,000) with VTT format (00:00:00.000)
    const converted = srtContent
        .replace(/\r\n/g, '\n')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

    vtt += converted;
    return vtt;
}

/**
 * Fetch subtitle content and convert to VTT
 */
export async function fetchSubtitleContent(url: string): Promise<string | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;

        const content = await response.text();

        // Check if already VTT
        if (content.trim().startsWith('WEBVTT')) {
            return content;
        }

        // Convert SRT to VTT
        return srtToVtt(content);
    } catch (error) {
        console.error('Error fetching subtitle content:', error);
        return null;
    }
}

/**
 * Auto-fetch best subtitle for a movie/series
 * Prioritizes Portuguese (Brazil), then Portuguese, then English
 */
export async function autoFetchSubtitle(params: {
    title: string;
    tmdbId?: string | number;
    imdbId?: string;
    season?: number;
    episode?: number;
}): Promise<{ url: string; language: string } | null> {
    try {
        // Preferred languages in order
        const preferredLanguages = ['pt-br', 'pt', 'en'];

        // Search for subtitles
        const results = await searchSubtitles({
            query: params.title,
            tmdbId: params.tmdbId,
            imdbId: params.imdbId,
            languages: preferredLanguages.join(','),
            season: params.season,
            episode: params.episode
        });

        if (results.length === 0) {
            console.log('No subtitles found for:', params.title);
            return null;
        }

        // Sort by preferred language and download count
        const sorted = results.sort((a, b) => {
            const aIndex = preferredLanguages.indexOf(a.language);
            const bIndex = preferredLanguages.indexOf(b.language);
            const aLangScore = aIndex === -1 ? 999 : aIndex;
            const bLangScore = bIndex === -1 ? 999 : bIndex;

            if (aLangScore !== bLangScore) return aLangScore - bLangScore;
            return b.downloadCount - a.downloadCount;
        });

        // Get the best subtitle
        const best = sorted[0];
        console.log(`Found subtitle: ${best.language} - ${best.release}`);

        // Download the subtitle
        const downloadUrl = await downloadSubtitle(best.fileId);
        if (!downloadUrl) {
            console.error('Failed to get download URL');
            return null;
        }

        // Fetch and convert content
        const vttContent = await fetchSubtitleContent(downloadUrl);
        if (!vttContent) {
            console.error('Failed to fetch subtitle content');
            return null;
        }

        // Create a blob URL for the VTT content
        const blob = new Blob([vttContent], { type: 'text/vtt' });
        const blobUrl = URL.createObjectURL(blob);

        return {
            url: blobUrl,
            language: best.language
        };
    } catch (error) {
        console.error('Error auto-fetching subtitle:', error);
        return null;
    }
}

/**
 * Cleanup blob URL when no longer needed
 */
export function cleanupSubtitleUrl(url: string): void {
    if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
}
