/**
 * Remembered aspect-ratio mode per content (channel/movie/series), so a 4:3
 * channel keeps its chosen mode across sessions. Global (not per profile) —
 * aspect is a property of the source material, not of who watches.
 */

export type AspectMode = 'original' | 'stretch' | 'fill' | 'zoom';

const STORAGE_KEY = 'neostream_aspect_prefs';
const VALID: AspectMode[] = ['original', 'stretch', 'fill', 'zoom'];

export function aspectPrefKey(contentType: string | undefined, contentId: string | undefined): string | null {
    if (!contentId) return null;
    return `${contentType || 'movie'}:${contentId}`;
}

function load(): Record<string, AspectMode> {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
        const result: Record<string, AspectMode> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (VALID.includes(value as AspectMode)) result[key] = value as AspectMode;
        }
        return result;
    } catch {
        return {};
    }
}

export const aspectPrefs = {
    get(key: string | null): AspectMode | null {
        if (!key) return null;
        return load()[key] ?? null;
    },

    set(key: string | null, mode: AspectMode): void {
        if (!key) return;
        try {
            const all = load();
            if (mode === 'fill') {
                delete all[key]; // 'fill' is the default — no need to store it
            } else {
                all[key] = mode;
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        } catch { /* best-effort */ }
    }
};
