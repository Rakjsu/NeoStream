import { describe, expect, it } from 'vitest';
import { isRecentlyAdded } from './catalogNew';

describe('isRecentlyAdded (badge NOVO)', () => {
    const nowMs = 1_800_000_000_000;

    it('dentro de 7 dias é novo; mais velho não', () => {
        const threeDaysAgo = String((nowMs - 3 * 86_400_000) / 1000);
        const tenDaysAgo = String((nowMs - 10 * 86_400_000) / 1000);
        expect(isRecentlyAdded(threeDaysAgo, nowMs)).toBe(true);
        expect(isRecentlyAdded(tenDaysAgo, nowMs)).toBe(false);
    });

    it('lixo/vazio nunca é novo', () => {
        expect(isRecentlyAdded(undefined, nowMs)).toBe(false);
        expect(isRecentlyAdded('', nowMs)).toBe(false);
        expect(isRecentlyAdded('abc', nowMs)).toBe(false);
        expect(isRecentlyAdded('0', nowMs)).toBe(false);
    });
});
