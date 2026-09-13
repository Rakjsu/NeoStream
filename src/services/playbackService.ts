/**
 * Playback Configuration Service
 * Handles buffer settings, codec preferences and subtitle/player options.
 * Settings are stored per user profile.
 */

import { profileService } from './profileService';
import { languageService } from './languageService';

export interface PlaybackConfig {
    bufferSize: 'intelligent' | '5' | '10' | '15' | '30';
    // Não há `audioCodec` nem `quality` aqui: eram campos gravados, com valor
    // padrão e tudo, que NINGUÉM lia — nem tela para escolher existia. O codec
    // que o app de fato respeita é o de vídeo (`useHls.ts`), e a qualidade
    // preferida mora em outro lugar, com outros valores
    // (`profileService.setPreferredQuality`: 4k/fhd/hd/sd/auto).
    videoCodec: 'auto' | 'h264' | 'h265' | 'vp9';
    autoPlayNextEpisode: boolean;
    subtitleLanguage: 'pt-br' | 'pt' | 'en' | 'es';
    subtitleLanguageUserSet?: boolean; // True if user manually changed subtitle language
    forcedSubtitlesEnabled: boolean; // Auto-load forced subtitles (signs/foreign dialogue)
    clickThroughEnabled: boolean; // PiP click-through mode (mouse passes through)
    mpvEnabled: boolean; // play live/movies in the embedded MPV window (stable since v4.8)
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

/**
 * Fica só com as chaves que o padrão declara.
 *
 * Sem isto, campo aposentado nunca vai embora: o `loadConfig` espalhava o JSON
 * salvo inteiro por cima do padrão, então `audioCodec` e `quality` — apagados
 * deste arquivo — continuariam sendo lidos do disco e regravados a cada
 * `setConfig`, para sempre, no perfil de quem já usou o app. A regra vale para
 * o próximo campo que sair também.
 */
export function apenasCamposConhecidos<T extends object>(salvo: unknown, padrao: T): Partial<T> {
    if (!salvo || typeof salvo !== 'object') return {};
    const limpo: Partial<T> = {};
    for (const chave of Object.keys(padrao) as (keyof T)[]) {
        const valor = (salvo as Record<string, unknown>)[chave as string];
        if (valor !== undefined) limpo[chave] = valor as T[keyof T];
    }
    return limpo;
}

function getDefaultConfig(): PlaybackConfig {
    return {
        bufferSize: 'intelligent',
        videoCodec: 'auto',
        autoPlayNextEpisode: true,
        subtitleLanguage: getDefaultSubtitleLanguage(),
        subtitleLanguageUserSet: false,
        forcedSubtitlesEnabled: true, // Enabled by default
        clickThroughEnabled: false, // Disabled by default
        mpvEnabled: false // opt-in: the HTML5 player stays the default
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

                this.config = { ...defaultConfig, ...apenasCamposConhecidos(parsed, defaultConfig) };
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
            // Sem medida ainda: 15s ate o player informar a banda real.
            return this.getCachedBufferSeconds() ?? 15;
        }
        return parseInt(this.config.bufferSize, 10);
    }

    /**
     * Test connection speed and recommend buffer size
     * Returns buffer size in seconds
     */
    /**
     * Banda REAL, informada pelo player quando o hls.js tem estimativa propria.
     *
     * O que existia aqui antes era um "teste de velocidade" que baixava o logo
     * do google.com a cada 5 minutos, com um tamanho CHUTADO (10 KB, nao o
     * tamanho real do arquivo) e cronometro disparado antes do laco. A conta
     * dava latencia ate a Google apresentada como banda — o proprio comentario
     * admitia ("Since this is a small file, estimate based on latency").
     *
     * Media do provedor de verdade e coisa que o hls.js ja faz, de graca,
     * enquanto reproduz.
     */
    reportMeasuredBandwidth(mbps: number): void {
        if (!Number.isFinite(mbps) || mbps <= 0) return;
        this.lastSpeedTest = {
            speedMbps: mbps,
            recommendedBufferSeconds: this.getBufferForSpeed(mbps),
            timestamp: Date.now(),
        };
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
            // Nao ha medida: dizer "analisando" seria mentira, ninguem esta
            // analisando nada ate a reproducao comecar.
            return 'Adaptativo (15s até a primeira medida)';
        }
        return `${this.config.bufferSize} segundos`;
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
        if (!this.lastSpeedTest) return null;
        // TTL de 5 min: medida velha e de outra rede (o notebook mudou de
        // Wi-Fi, o provedor caiu de qualidade). Antes o TTL existia num
        // caminho que a producao nem percorria.
        if (Date.now() - this.lastSpeedTest.timestamp > 5 * 60 * 1000) return null;
        return this.lastSpeedTest.recommendedBufferSeconds;
    }
}

export const playbackService = new PlaybackService();
