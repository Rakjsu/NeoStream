/**
 * Optional remote refresh for the EPG channel→id fallback mappings.
 *
 * The mappings (mi.tv / meuguia / Open-EPG) are bundled as static JSON and are
 * only a FALLBACK now that the provider's own xmltv is the primary source.
 * They change ~1-2x/year. Instead of requiring an app release to pick up a new
 * channel mapping, this service merges the static maps with a cached copy
 * pulled weekly from the repo's raw files. The merged result is read at module
 * load; a background refresh updates the cache for the NEXT boot. Fully
 * degradable: any fetch/parse failure just leaves the static maps in place.
 */

const RAW_BASE = 'https://raw.githubusercontent.com/Rakjsu/NeoStream/main/src/data/epg-mappings';
const CACHE_PREFIX = 'epg_mappings_remote_';
const LAST_REFRESH_KEY = 'epg_mappings_last_refresh';
export const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // weekly
const FETCH_TIMEOUT_MS = 8000;

/** The six mapping files (name = cache id, file = basename in the repo). */
export const MAPPING_NAMES = [
    'mitv', 'meuguia', 'openepg-pt', 'openepg-ar', 'openepg-usa', 'openepg-br'
] as const;
export type MappingName = typeof MAPPING_NAMES[number];

export type MappingObject = Record<string, string>;

// --- Pure helpers (unit-tested) ---------------------------------------------

/** A valid mapping is a flat object of string→string. */
export function isValidMappingObject(value: unknown): value is MappingObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value as Record<string, unknown>).every(v => typeof v === 'string');
}

/** Static base + remote overrides (remote wins). */
export function mergeMappings(staticMap: MappingObject, remoteMap: MappingObject | null): MappingObject {
    return remoteMap ? { ...staticMap, ...remoteMap } : { ...staticMap };
}

export function shouldRefresh(lastRun: number | null, now: number, intervalMs: number): boolean {
    if (lastRun === null || !Number.isFinite(lastRun)) return true;
    return now - lastRun >= intervalMs;
}

// --- Cache access -----------------------------------------------------------

function readCache(name: MappingName): MappingObject | null {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + name);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return isValidMappingObject(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/** Read at epgService module load: static JSON merged with any cached remote. */
export function getMergedMappings(name: MappingName, staticMap: MappingObject): MappingObject {
    return mergeMappings(staticMap, readCache(name));
}

// --- Background refresh -----------------------------------------------------

async function fetchOne(name: MappingName, signal: AbortSignal): Promise<boolean> {
    const file = name === 'mitv' ? 'mitv'
        : name === 'meuguia' ? 'meuguia'
        : name; // openepg-* match the basenames
    const res = await fetch(`${RAW_BASE}/${file}.json`, { signal });
    if (!res.ok) return false;
    const json = await res.json();
    if (!isValidMappingObject(json)) return false;
    localStorage.setItem(CACHE_PREFIX + name, JSON.stringify(json));
    return true;
}

/**
 * Weekly, best-effort: refresh each mapping's cache from the repo. Stamps the
 * throttle BEFORE fetching so a crash mid-run doesn't busy-retry. Each file is
 * independent (one failure doesn't abort the rest). The refreshed cache applies
 * on the next app boot (module load), so this never mutates live lookups.
 */
export async function refreshFromRemote(now: number = Date.now(), intervalMs: number = REFRESH_INTERVAL_MS): Promise<void> {
    let lastRun: number | null = null;
    try {
        const raw = localStorage.getItem(LAST_REFRESH_KEY);
        lastRun = raw ? Number(raw) : null;
    } catch { /* ignore */ }

    if (!shouldRefresh(lastRun, now, intervalMs)) return;

    try { localStorage.setItem(LAST_REFRESH_KEY, String(now)); } catch { /* ignore */ }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        await Promise.allSettled(MAPPING_NAMES.map(name => fetchOne(name, controller.signal)));
    } finally {
        clearTimeout(timer);
    }
}
