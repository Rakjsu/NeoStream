/**
 * Periodic catalog refresh: with tray mode the app stays open for days, so
 * long-lived surfaces (Home rows, the global-search session cache) go stale.
 * A timer dispatches CATALOG_REFRESH_EVENT every N hours; listeners refetch.
 * Pages that fetch on mount (LiveTV/VOD/Series) are already fresh per visit.
 */

export const CATALOG_REFRESH_EVENT = 'neostream-catalog-refresh';

/** Allowed intervals in hours; 0 = disabled. */
export const REFRESH_INTERVAL_OPTIONS = [0, 3, 6, 12, 24] as const;
export type RefreshIntervalHours = typeof REFRESH_INTERVAL_OPTIONS[number];

const CONFIG_KEY = 'neostream_catalog_refresh';
const LAST_REFRESH_KEY = 'neostream_catalog_last_refresh';
const CHECK_EVERY_MS = 5 * 60 * 1000; // coarse tick; the hour math decides

export function normalizeIntervalHours(raw: unknown): RefreshIntervalHours {
    // Unset storage must fall back to the default, not to 0 ("off").
    if (raw === null || raw === undefined || raw === '') return 6;
    const parsed = Number(raw);
    return (REFRESH_INTERVAL_OPTIONS as readonly number[]).includes(parsed)
        ? parsed as RefreshIntervalHours
        : 6;
}

/** Pure: is a refresh due? (exported for tests) */
export function isRefreshDue(intervalHours: number, lastRefreshMs: number, nowMs: number): boolean {
    if (intervalHours <= 0) return false;
    return nowMs - lastRefreshMs >= intervalHours * 3600_000;
}

let timer: ReturnType<typeof setInterval> | null = null;

export const catalogRefreshService = {
    getIntervalHours(): RefreshIntervalHours {
        try {
            return normalizeIntervalHours(localStorage.getItem(CONFIG_KEY));
        } catch {
            return 6;
        }
    },

    setIntervalHours(hours: RefreshIntervalHours): void {
        try {
            localStorage.setItem(CONFIG_KEY, String(hours));
        } catch { /* best-effort */ }
    },

    /** Fire the refresh event now and reset the clock. */
    refreshNow(): void {
        try {
            localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
        } catch { /* best-effort */ }
        window.dispatchEvent(new Event(CATALOG_REFRESH_EVENT));
    },

    /** Start the background clock (idempotent; call once at app boot). */
    start(): void {
        if (timer) return;
        try {
            // Boot counts as fresh — pages just fetched everything.
            localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
        } catch { /* best-effort */ }
        timer = setInterval(() => {
            const interval = this.getIntervalHours();
            const last = Number(localStorage.getItem(LAST_REFRESH_KEY)) || 0;
            if (isRefreshDue(interval, last, Date.now())) {
                this.refreshNow();
            }
        }, CHECK_EVERY_MS);
    },

    stop(): void {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }
};
