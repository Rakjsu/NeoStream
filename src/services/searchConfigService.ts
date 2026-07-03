/**
 * Global search (Ctrl+K) scope configuration: which content kinds the
 * overlay searches. Persisted globally (not per profile) in localStorage —
 * kids/parental gating still applies on top, per profile.
 */

export interface SearchConfig {
    live: boolean;
    vod: boolean;
    series: boolean;
    /** EPG program titles (needs a provider with xmltv). */
    epg: boolean;
}

const STORAGE_KEY = 'neostream_search_config';

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
    live: true,
    vod: true,
    series: true,
    epg: true
};

/** Merge a parsed unknown value over the defaults (invalid fields ignored). */
export function normalizeSearchConfig(raw: unknown): SearchConfig {
    const config = { ...DEFAULT_SEARCH_CONFIG };
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const key of Object.keys(config) as Array<keyof SearchConfig>) {
            const value = (raw as Record<string, unknown>)[key];
            if (typeof value === 'boolean') config[key] = value;
        }
    }
    return config;
}

export const searchConfigService = {
    getConfig(): SearchConfig {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return normalizeSearchConfig(data ? JSON.parse(data) : null);
        } catch {
            return { ...DEFAULT_SEARCH_CONFIG };
        }
    },

    setConfig(partial: Partial<SearchConfig>): SearchConfig {
        const next = { ...this.getConfig(), ...partial };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch { /* best-effort */ }
        return next;
    }
};
