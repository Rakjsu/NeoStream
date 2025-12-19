/**
 * Playback Configuration Service
 * Handles buffer settings, codec preferences, and quality settings
 * Settings are stored per user profile
 */

import { profileService } from './profileService';
import { languageService } from './languageService';

export interface PlaybackConfig {
    bufferSize: 'intelligent' | '5' | '10' | '15' | '30';
    audioCodec: 'auto' | 'aac' | 'ac3' | 'eac3';
    videoCodec: 'auto' | 'h264' | 'h265' | 'vp9';
    quality: 'auto' | '1080p' | '720p' | '480p';
    autoPlayNextEpisode: boolean;
    subtitleLanguage: 'pt-br' | 'pt' | 'en' | 'es';
    subtitleLanguageUserSet?: boolean; // True if user manually changed subtitle language
    forcedSubtitlesEnabled: boolean; // Auto-load forced subtitles (signs/foreign dialogue)
}

const STORAGE_KEY_PREFIX = 'playbackConfig';

// Map app language to subtitle language
function getDefaultSubtitleLanguage(): 'pt-br' | 'pt' | 'en' | 'es' {
    const appLang = languageService.getLanguage();
    switch (appLang) {
        case 'pt': return 'pt-br';
        case 'en': return 'en';
        case 'es': return 'es';
        default: return 'pt-br';
    }
}

function getDefaultConfig(): PlaybackConfig {
    return {
        bufferSize: 'intelligent',
        audioCodec: 'auto',
        videoCodec: 'auto',
        quality: 'auto',
        autoPlayNextEpisode: true,
        subtitleLanguage: getDefaultSubtitleLanguage(),
        subtitleLanguageUserSet: false,
        forcedSubtitlesEnabled: true // Enabled by default
    };
}

// Connection speed test result
interface SpeedTestResult {
    speedMbps: number;
    recommendedBufferSeconds: number;
    timestamp: number;
}

class PlaybackService {
    private config: PlaybackConfig = getDefaultConfig();
    private lastSpeedTest: SpeedTestResult | null = null;
    private speedTestInProgress = false;

    constructor() {
        this.loadConfig();
    }

    // Get storage key for current profile
    private getStorageKey(): string {
        const activeProfile = profileService.getActiveProfile();
        if (activeProfile) {
            return `${STORAGE_KEY_PREFIX}_${activeProfile.id}`;
        }
        return STORAGE_KEY_PREFIX; // Fallback for no profile
    }

    private loadConfig(): void {
        try {
            const key = this.getStorageKey();
            const saved = localStorage.getItem(key);
            if (saved) {
                const parsed = JSON.parse(saved);
                const defaultConfig = getDefaultConfig();

                // If subtitle language was not explicitly set by user, use app language
                if (!parsed.subtitleLanguageUserSet) {
                    parsed.subtitleLanguage = getDefaultSubtitleLanguage();
                }

                this.config = { ...defaultConfig, ...parsed };
            } else {
                this.config = getDefaultConfig();
            }
        } catch (error) {
            console.error('Error loading playback config:', error);
            this.config = getDefaultConfig();
        }
    }

    private saveConfig(): void {
        try {
            const key = this.getStorageKey();
            localStorage.setItem(key, JSON.stringify(this.config));
        } catch (error) {
            console.error('Error saving playback config:', error);
        }
    }

    // Reload config (call when profile changes)
    reloadConfig(): void {
        this.loadConfig();
    }

    getConfig(): PlaybackConfig {
        return { ...this.config };
    }

    setConfig(config: Partial<PlaybackConfig>): void {
        // If user is setting subtitle language, mark it as user-set
        if (config.subtitleLanguage !== undefined) {
            config.subtitleLanguageUserSet = true;
        }

        this.config = { ...this.config, ...config };
        this.saveConfig();
    }

    /**
     * Get the actual buffer size in seconds based on settings
     * For 'intelligent' mode, this performs speed test and calculates optimal buffer
     */
    async getBufferSeconds(): Promise<number> {
        if (this.config.bufferSize === 'intelligent') {
            return await this.calculateIntelligentBuffer();
        }
        return parseInt(this.config.bufferSize, 10);
    }

    /**
     * Test connection speed and recommend buffer size
     * Returns buffer size in seconds
     */
    private async calculateIntelligentBuffer(): Promise<number> {
        // Use cached result if less than 5 minutes old
        const cacheAge = this.lastSpeedTest
            ? Date.now() - this.lastSpeedTest.timestamp
            : Infinity;

        if (this.lastSpeedTest && cacheAge < 5 * 60 * 1000) {
            return this.lastSpeedTest.recommendedBufferSeconds;
        }

        // Avoid multiple concurrent tests
        if (this.speedTestInProgress) {
            return 15; // Default fallback during test
        }

        try {
            this.speedTestInProgress = true;
            const speedMbps = await this.measureConnectionSpeed();
            const recommendedBufferSeconds = this.getBufferForSpeed(speedMbps);

            this.lastSpeedTest = {
                speedMbps,
                recommendedBufferSeconds,
                timestamp: Date.now()
            };

            
            return recommendedBufferSeconds;
        } catch (error) {
            console.error('Speed test failed:', error);
            return 15; // Default fallback
        } finally {
            this.speedTestInProgress = false;
        }
    }

    /**
     * Measure connection speed by downloading a small test file
     */
    private async measureConnectionSpeed(): Promise<number> {
        // Use a reliable CDN for speed test (small image)
        const testUrls = [
            'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_92x30dp.png',
            'https://www.cloudflare.com/favicon.ico'
        ];

        const testSize = 10000; // Approximate size in bytes
        const startTime = performance.now();

        try {
            // Try multiple URLs in case one fails
            for (const url of testUrls) {
                try {
                    const response = await fetch(url + '?t=' + Date.now(), {
                        cache: 'no-store',
                        mode: 'no-cors'
                    });

                    if (!response.ok && response.type !== 'opaque') continue;

                    const endTime = performance.now();
                    const durationSeconds = (endTime - startTime) / 1000;

                    // Calculate speed in Mbps
                    const speedMbps = (testSize * 8) / (durationSeconds * 1000000);

                    // Since this is a small file, estimate based on latency
                    // Scale up for more realistic bandwidth estimation
                    return Math.max(speedMbps * 10, 1);
                } catch {
                    continue;
                }
            }

            // If all tests fail, assume moderate connection
            return 10;
        } catch {
            return 10; // Default to moderate speed
        }
    }

    /**
     * Map connection speed to recommended buffer size
     */
    private getBufferForSpeed(speedMbps: number): number {
        // Adaptive buffer based on connection quality
        if (speedMbps >= 50) {
            return 5;  // Excellent connection - minimal buffer
        } else if (speedMbps >= 25) {
            return 10; // Good connection
        } else if (speedMbps >= 10) {
            return 15; // Moderate connection
        } else if (speedMbps >= 5) {
            return 20; // Slow connection
        } else {
            return 30; // Very slow connection - maximum buffer
        }
    }

    /**
     * Get human-readable description of current buffer mode
     */
    getBufferDescription(): string {
        if (this.config.bufferSize === 'intelligent') {
            if (this.lastSpeedTest) {
                return `Adaptativo (${this.lastSpeedTest.recommendedBufferSeconds}s baseado em ${this.lastSpeedTest.speedMbps.toFixed(1)} Mbps)`;
            }
            return 'Adaptativo (analisando conexão...)';
        }
        return `${this.config.bufferSize} segundos`;
    }

    /**
     * Force a new speed test
     */
    async refreshSpeedTest(): Promise<SpeedTestResult | null> {
        this.lastSpeedTest = null;
        await this.calculateIntelligentBuffer();
        return this.lastSpeedTest;
    }

    /**
     * Get the last speed test result
     */
    getLastSpeedTest(): SpeedTestResult | null {
        return this.lastSpeedTest ? { ...this.lastSpeedTest } : null;
    }

    /**
     * Get cached buffer seconds synchronously (for immediate use without speed test)
     */
    getCachedBufferSeconds(): number | null {
        if (this.lastSpeedTest) {
            return this.lastSpeedTest.recommendedBufferSeconds;
        }
        return null;
    }
}

export const playbackService = new PlaybackService();
