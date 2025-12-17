/**
 * Subtitle Service
 * Fetches subtitles from OpenSubtitles API via IPC (bypasses CORS)
 */

const OPENSUBTITLES_USERNAME = 'Rakjsu';
const OPENSUBTITLES_PASSWORD = '05062981';

// JWT token cache
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

// Window type for IPC
declare global {
    interface Window {
        ipcRenderer?: {
            invoke: (channel: string, data: any) => Promise<any>;
        };
    }
}

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
 * Make request to OpenSubtitles via IPC (bypasses CORS)
 */
async function openSubtitlesRequest(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any
): Promise<{ success: boolean; status?: number; data?: any; error?: string }> {
    if (!window.ipcRenderer) {
        console.error('IPC not available - not running in Electron');
        return { success: false, error: 'IPC not available' };
    }

    return window.ipcRenderer.invoke('opensubtitles:request', { endpoint, method, body });
}

/**
 * Login to OpenSubtitles and get JWT token
 */
async function getAuthToken(): Promise<string | null> {
    // Return cached token if still valid (with 5 min buffer)
    if (cachedToken && Date.now() < tokenExpiry - 300000) {
        return cachedToken;
    }

    try {
        console.log('🔐 Logging in to OpenSubtitles...');
        const result = await openSubtitlesRequest('/login', 'POST', {
            username: OPENSUBTITLES_USERNAME,
            password: OPENSUBTITLES_PASSWORD
        });

        if (!result.success) {
            console.error('OpenSubtitles login failed:', result.status, result.error);
            return null;
        }

        const data = result.data;
        if (data?.token) {
            cachedToken = data.token;
            // Token is valid for 24 hours, cache for 23 hours
            tokenExpiry = Date.now() + (23 * 60 * 60 * 1000);
            console.log('✅ OpenSubtitles login successful');
            return cachedToken;
        }

        return null;
    } catch (error) {
        console.error('Error logging in to OpenSubtitles:', error);
        return null;
    }
}

/**
 * Search for subtitles on OpenSubtitles
 */
export async function searchSubtitles(params: SubtitleSearchParams): Promise<SubtitleResult[]> {
    try {
        // Get auth token first
        const token = await getAuthToken();
        if (!token) {
            console.error('Failed to get OpenSubtitles auth token');
            return [];
        }

        const searchParams = new URLSearchParams();

        if (params.query) searchParams.set('query', params.query);
        if (params.imdbId) searchParams.set('imdb_id', params.imdbId);
        if (params.tmdbId) searchParams.set('tmdb_id', String(params.tmdbId));
        if (params.languages) searchParams.set('languages', params.languages);
        if (params.season) searchParams.set('season_number', String(params.season));
        if (params.episode) searchParams.set('episode_number', String(params.episode));

        const result = await openSubtitlesRequest(
            `/subtitles?${searchParams.toString()}`,
            'GET',
            { authToken: token }
        );

        if (!result.success) {
            console.error('OpenSubtitles search failed:', result.status, result.error);
            return [];
        }

        const data = result.data;

        if (!data?.data || !Array.isArray(data.data)) {
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
        // Get auth token first
        const token = await getAuthToken();
        if (!token) {
            console.error('Failed to get OpenSubtitles auth token for download');
            return null;
        }

        const result = await openSubtitlesRequest('/download', 'POST', {
            file_id: fileId,
            authToken: token
        });

        if (!result.success) {
            console.error('OpenSubtitles download failed:', result.status, result.error);
            return null;
        }

        return result.data?.link || null;
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
 * Uses user's preferred language from settings
 */
export async function autoFetchSubtitle(params: {
    title: string;
    tmdbId?: string | number;
    imdbId?: string;
    season?: number;
    episode?: number;
}): Promise<{ url: string; language: string } | null> {
    try {
        // Get user's preferred subtitle language from settings
        const { playbackService } = await import('./playbackService');

        // Reload config to ensure we have latest profile settings
        playbackService.reloadConfig();
        const config = playbackService.getConfig();

        // Build language priority based on user preference
        const preferredLang = config.subtitleLanguage;
        let preferredLanguages: string[];

        switch (preferredLang) {
            case 'pt-br':
                preferredLanguages = ['pt-br', 'pt', 'en'];
                break;
            case 'pt':
                preferredLanguages = ['pt', 'pt-br', 'en'];
                break;
            case 'en':
                preferredLanguages = ['en', 'pt-br', 'pt'];
                break;
            case 'es':
                preferredLanguages = ['es', 'en', 'pt-br'];
                break;
            default:
                preferredLanguages = ['pt-br', 'pt', 'en'];
        }

        console.log(`🎯 Subtitle preference from settings: ${preferredLang}`);
        console.log(`🎯 Language priority: ${preferredLanguages.join(' → ')}`);

        // Clean the title - remove tags like [4K], [L], (2021), etc.
        const cleanTitle = params.title
            .replace(/\s*\[.*?\]\s*/g, '') // Remove [anything]
            .replace(/\s*\(\d{4}\)\s*/g, '') // Remove (year)
            .trim();

        console.log(`🔍 Searching subtitles for: ${cleanTitle}`);

        // Search for subtitles
        const results = await searchSubtitles({
            query: cleanTitle,
            tmdbId: params.tmdbId,
            imdbId: params.imdbId,
            languages: preferredLanguages.join(','),
            season: params.season,
            episode: params.episode
        });

        if (results.length === 0) {
            console.log('No subtitles found for:', cleanTitle);
            return null;
        }

        console.log(`📃 Found ${results.length} subtitles`);
        results.slice(0, 5).forEach((r, i) => {
            console.log(`   ${i + 1}. [${r.language}] ${r.release} (${r.downloadCount} downloads)`);
        });

        // Normalize language codes to lowercase for comparison
        const normalizedPreferredLang = preferredLang.toLowerCase();
        const normalizedPreferredLanguages = preferredLanguages.map(l => l.toLowerCase());

        // Filter to get only subtitles in the preferred language (first choice) - case insensitive
        const primaryLangResults = results.filter(r =>
            r.language.toLowerCase() === normalizedPreferredLang
        );

        // If we have results in the primary language, use those
        let candidateResults = primaryLangResults.length > 0 ? primaryLangResults : results;

        console.log(`📌 Primary language (${preferredLang}) count: ${primaryLangResults.length}`);

        // Sort by preferred language and download count - case insensitive
        const sorted = candidateResults.sort((a, b) => {
            const aLangNorm = a.language.toLowerCase();
            const bLangNorm = b.language.toLowerCase();
            const aIndex = normalizedPreferredLanguages.indexOf(aLangNorm);
            const bIndex = normalizedPreferredLanguages.indexOf(bLangNorm);
            const aLangScore = aIndex === -1 ? 999 : aIndex;
            const bLangScore = bIndex === -1 ? 999 : bIndex;

            if (aLangScore !== bLangScore) return aLangScore - bLangScore;
            return b.downloadCount - a.downloadCount;
        });

        // Get the best subtitle
        const best = sorted[0];
        console.log(`✅ Selected subtitle: [${best.language}] ${best.release}`);

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
