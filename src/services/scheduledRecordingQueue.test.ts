import { describe, it, expect, beforeEach } from 'vitest';
import { getDvrMaxConcurrent, START_MARGIN_MS, startDelayMs } from './scheduledRecordingService';

const NOW = Date.UTC(2026, 6, 18, 12, 0, 0);

describe('startDelayMs (margem inicial de 2min)', () => {
    it('liga 2min antes do início anunciado', () => {
        const startIso = new Date(NOW + 10 * 60_000).toISOString();
        expect(startDelayMs(startIso, NOW)).toBe(10 * 60_000 - START_MARGIN_MS);
    });

    it('programa a menos de 2min (ou já começado) liga imediatamente', () => {
        expect(startDelayMs(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0);
        expect(startDelayMs(new Date(NOW - 60_000).toISOString(), NOW)).toBe(0);
        expect(startDelayMs('data-invalida', NOW)).toBe(0);
    });
});

describe('getDvrMaxConcurrent (fila do DVR)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('padrão 2 sem configuração ou com lixo', () => {
        expect(getDvrMaxConcurrent()).toBe(2);
        localStorage.setItem('neostream_dvr_max_concurrent', 'abc');
        expect(getDvrMaxConcurrent()).toBe(2);
    });

    it('respeita o valor salvo com clamp 1–4', () => {
        localStorage.setItem('neostream_dvr_max_concurrent', '3');
        expect(getDvrMaxConcurrent()).toBe(3);
        localStorage.setItem('neostream_dvr_max_concurrent', '99');
        expect(getDvrMaxConcurrent()).toBe(4);
        localStorage.setItem('neostream_dvr_max_concurrent', '-1');
        expect(getDvrMaxConcurrent()).toBe(2);
    });
});
