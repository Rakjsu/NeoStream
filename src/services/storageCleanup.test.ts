import { describe, it, expect } from 'vitest';
import { shouldRunCleanup, STORAGE_CLEANUP_INTERVAL_MS } from './storageCleanup';

describe('storageCleanup — shouldRunCleanup throttle', () => {
    const DAY = STORAGE_CLEANUP_INTERVAL_MS;

    it('runs when there is no recorded last run (null)', () => {
        expect(shouldRunCleanup(null, 1_000_000)).toBe(true);
    });

    it('runs when the stored value is not finite (garbage)', () => {
        expect(shouldRunCleanup(NaN, 1_000_000)).toBe(true);
        expect(shouldRunCleanup(Infinity, 1_000_000)).toBe(true);
    });

    it('skips when the interval has not yet elapsed', () => {
        const now = 10 * DAY;
        expect(shouldRunCleanup(now - 1, now)).toBe(false);
        expect(shouldRunCleanup(now - (DAY - 1), now)).toBe(false);
    });

    it('runs once exactly the interval has elapsed', () => {
        const last = 5 * DAY;
        expect(shouldRunCleanup(last, last + DAY)).toBe(true);
    });

    it('runs when well past the interval', () => {
        const last = 5 * DAY;
        expect(shouldRunCleanup(last, last + 3 * DAY)).toBe(true);
    });

    it('honours a custom interval', () => {
        const custom = 60 * 1000; // 1 min
        const last = 1_000_000;
        expect(shouldRunCleanup(last, last + custom - 1, custom)).toBe(false);
        expect(shouldRunCleanup(last, last + custom, custom)).toBe(true);
    });

    it('the default interval is 24 hours', () => {
        expect(STORAGE_CLEANUP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    });
});
