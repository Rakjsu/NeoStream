// NeoStream Wrapped: once-a-year in-app notification inviting the user to open
// their retrospective. Fires in December, at most once per calendar year, and
// only when there is enough watch data for a meaningful Wrapped.

import { buildWrapped } from './wrappedHelpers';
import { usageStatsService } from './usageStatsService';

const SEEN_KEY = 'neostream_wrapped_notified_year';
const WRAPPED_MONTH = 11; // December (0-indexed)

/** Pure: should the annual Wrapped notification fire for this date/last-year? */
export function shouldNotifyWrapped(
    now: Date,
    lastNotifiedYear: number | null,
    hasEnoughData: boolean,
): boolean {
    if (!hasEnoughData) return false;
    if (now.getMonth() !== WRAPPED_MONTH) return false;
    return lastNotifiedYear !== now.getFullYear();
}

export const wrappedAnnualService = {
    /**
     * Check-and-fire. Returns the notification payload to enqueue, or null.
     * Records the year so it never repeats within the same December.
     */
    maybeNotify(now: Date = new Date()): { title: string; message: string; year: number } | null {
        let lastYear: number | null;
        try {
            const raw = localStorage.getItem(SEEN_KEY);
            const parsed = raw ? Number(raw) : null;
            lastYear = parsed !== null && Number.isFinite(parsed) ? parsed : null;
        } catch {
            lastYear = null;
        }

        const wrapped = buildWrapped(usageStatsService.getStats());
        if (!shouldNotifyWrapped(now, lastYear, !wrapped.empty)) return null;

        try {
            localStorage.setItem(SEEN_KEY, String(now.getFullYear()));
        } catch { /* best-effort */ }

        return {
            title: 'Sua Retrospectiva NeoStream chegou! 🎁',
            message: `Você assistiu ${wrapped.totalHours}h este ano. Veja seu resumo.`,
            year: now.getFullYear(),
        };
    },
};
