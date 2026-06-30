/**
 * Boot-time localStorage cleanup orchestrator.
 *
 * A handful of localStorage keys grow without bound over the app's lifetime:
 *   - `series_episode_data_<profile>` — one entry per series ever checked for
 *     new episodes, never pruned automatically.
 *   - `epg_test_results` — a lingering stale snapshot of the last EPG test.
 *   - `tmdb_cache_movies` / `tmdb_cache_series` — one entry per VOD title seen,
 *     compacted only on read, never swept from storage.
 *
 * `runStorageCleanup()` calls each owning service's prune (each guarded so one
 * failure can't block the others) and is cheap + idempotent. It self-throttles
 * to at most once per 24h via a `lastStorageCleanup` timestamp, so wiring it
 * into the app boot path costs effectively nothing on subsequent launches.
 */

const LAST_RUN_KEY = 'lastStorageCleanup';

/** Run the cleanup sweep at most this often. */
export const STORAGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Pure throttle decision: should the sweep run given the last-run timestamp?
 *
 * `lastRun` is null/NaN when we've never run (or the stored value is garbage),
 * in which case we run. Otherwise run only once `intervalMs` has elapsed.
 */
export function shouldRunCleanup(
    lastRun: number | null,
    now: number,
    intervalMs: number = STORAGE_CLEANUP_INTERVAL_MS
): boolean {
    if (lastRun === null || !Number.isFinite(lastRun)) return true;
    return now - lastRun >= intervalMs;
}

function readLastRun(): number | null {
    try {
        const raw = localStorage.getItem(LAST_RUN_KEY);
        if (raw === null) return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Orchestrate the per-key prunes, throttled to once per `intervalMs`.
 *
 * Each prune is wrapped in its own try/catch so a failure in one service does
 * not block the others or abort the boot path. The throttle timestamp is
 * stamped only after a sweep actually runs. Returns true if a sweep ran, false
 * if it was skipped by the throttle.
 */
export async function runStorageCleanup(
    now: number = Date.now(),
    intervalMs: number = STORAGE_CLEANUP_INTERVAL_MS
): Promise<boolean> {
    if (!shouldRunCleanup(readLastRun(), now, intervalMs)) {
        return false;
    }

    // Stamp first so a crash mid-sweep doesn't cause a busy-retry loop on every
    // boot; the prunes are idempotent so re-running tomorrow is harmless.
    try {
        localStorage.setItem(LAST_RUN_KEY, String(now));
    } catch {
        // localStorage unavailable/full — nothing more we can do here.
    }

    try {
        const { appNotificationService } = await import('./episodeNotificationService');
        await appNotificationService.pruneStaleSeriesData();
    } catch (e) {
        console.error('[StorageCleanup] pruneStaleSeriesData failed:', e);
    }

    try {
        const { default: epgTestService } = await import('./epgTestService');
        epgTestService.pruneOldResults(now);
    } catch (e) {
        console.error('[StorageCleanup] epg pruneOldResults failed:', e);
    }

    try {
        const { tmdbCacheService } = await import('./tmdbCacheService');
        tmdbCacheService.pruneExpired(now);
    } catch (e) {
        console.error('[StorageCleanup] tmdb pruneExpired failed:', e);
    }

    return true;
}
