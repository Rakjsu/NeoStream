import { describe, it, expect } from 'vitest';
import { shouldNotifyWrapped } from './wrappedAnnual';

describe('shouldNotifyWrapped', () => {
    const dec = new Date(2026, 11, 15); // December 2026
    const jun = new Date(2026, 5, 15);

    it('dispara em dezembro se ainda não notificou este ano', () => {
        expect(shouldNotifyWrapped(dec, null, true)).toBe(true);
        expect(shouldNotifyWrapped(dec, 2025, true)).toBe(true);
    });

    it('não repete no mesmo ano', () => {
        expect(shouldNotifyWrapped(dec, 2026, true)).toBe(false);
    });

    it('só em dezembro', () => {
        expect(shouldNotifyWrapped(jun, null, true)).toBe(false);
    });

    it('exige dados suficientes', () => {
        expect(shouldNotifyWrapped(dec, null, false)).toBe(false);
    });
});
