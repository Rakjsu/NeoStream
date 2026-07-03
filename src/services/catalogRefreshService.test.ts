import { describe, it, expect, beforeEach } from 'vitest';
import { isRefreshDue, normalizeIntervalHours, catalogRefreshService } from './catalogRefreshService';

describe('isRefreshDue', () => {
    const HOUR = 3600_000;

    it('devido só depois do intervalo completo', () => {
        expect(isRefreshDue(6, 0, 5 * HOUR)).toBe(false);
        expect(isRefreshDue(6, 0, 6 * HOUR)).toBe(true);
        expect(isRefreshDue(3, 10 * HOUR, 12 * HOUR)).toBe(false);
        expect(isRefreshDue(3, 10 * HOUR, 13 * HOUR)).toBe(true);
    });

    it('0 = desligado, nunca devido', () => {
        expect(isRefreshDue(0, 0, 999 * HOUR)).toBe(false);
    });
});

describe('normalizeIntervalHours', () => {
    it('aceita só os intervalos válidos, senão cai no padrão 6h', () => {
        expect(normalizeIntervalHours('12')).toBe(12);
        expect(normalizeIntervalHours(0)).toBe(0);
        expect(normalizeIntervalHours('7')).toBe(6);
        expect(normalizeIntervalHours(null)).toBe(6);
        expect(normalizeIntervalHours('abc')).toBe(6);
    });
});

describe('catalogRefreshService config', () => {
    beforeEach(() => localStorage.clear());

    it('persiste e lê o intervalo', () => {
        expect(catalogRefreshService.getIntervalHours()).toBe(6);
        catalogRefreshService.setIntervalHours(24);
        expect(catalogRefreshService.getIntervalHours()).toBe(24);
        catalogRefreshService.setIntervalHours(0);
        expect(catalogRefreshService.getIntervalHours()).toBe(0);
    });

    it('refreshNow dispara o evento e grava o timestamp', () => {
        let fired = 0;
        const on = () => { fired++; };
        window.addEventListener('neostream-catalog-refresh', on);
        catalogRefreshService.refreshNow();
        window.removeEventListener('neostream-catalog-refresh', on);
        expect(fired).toBe(1);
        expect(Number(localStorage.getItem('neostream_catalog_last_refresh'))).toBeGreaterThan(0);
    });
});
