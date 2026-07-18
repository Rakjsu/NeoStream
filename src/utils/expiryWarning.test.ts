import { describe, expect, it } from 'vitest';
import { daysToExpiry, isExpirySnoozed, shouldWarnExpiry } from './expiryWarning';

const NOW = Date.UTC(2026, 6, 18, 12, 0, 0);
const DAY = 86_400_000;

describe('daysToExpiry', () => {
    it('converte epoch de segundos em dias inteiros restantes', () => {
        expect(daysToExpiry(String((NOW + 5 * DAY) / 1000), NOW)).toBe(5);
        expect(daysToExpiry((NOW + DAY / 2) / 1000, NOW)).toBe(0);
        expect(daysToExpiry((NOW - 2 * DAY) / 1000, NOW)).toBe(-2);
    });

    it('sem data (ilimitada/ausente/lixo) devolve null', () => {
        expect(daysToExpiry(null, NOW)).toBeNull();
        expect(daysToExpiry(undefined, NOW)).toBeNull();
        expect(daysToExpiry('', NOW)).toBeNull();
        expect(daysToExpiry('0', NOW)).toBeNull();
        expect(daysToExpiry('abc', NOW)).toBeNull();
    });
});

describe('shouldWarnExpiry', () => {
    it('avisa só na última semana (inclusive) e depois de expirar', () => {
        expect(shouldWarnExpiry(8)).toBe(false);
        expect(shouldWarnExpiry(7)).toBe(true);
        expect(shouldWarnExpiry(0)).toBe(true);
        expect(shouldWarnExpiry(-3)).toBe(true);
        expect(shouldWarnExpiry(null)).toBe(false);
    });
});

describe('isExpirySnoozed', () => {
    it('respeita o carimbo de 24h e ignora lixo', () => {
        expect(isExpirySnoozed(String(NOW + 1000), NOW)).toBe(true);
        expect(isExpirySnoozed(String(NOW - 1000), NOW)).toBe(false);
        expect(isExpirySnoozed(null, NOW)).toBe(false);
        expect(isExpirySnoozed('garbage', NOW)).toBe(false);
    });
});
