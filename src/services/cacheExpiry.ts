/**
 * Pure cache-expiry rules, shared by indexedDBCache and unit-testable
 * without an IndexedDB environment.
 */

/** Certification/genre data is stable; refresh monthly. */
export const KIDS_FILTER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function isExpired(
    cachedAt: number | undefined,
    ttlMs: number,
    now: number = Date.now()
): boolean {
    // Legacy records without a timestamp are treated as expired so they
    // get refreshed (and re-stamped) on next use.
    if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) return true;
    return now - cachedAt > ttlMs;
}
