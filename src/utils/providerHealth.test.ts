import { describe, it, expect } from 'vitest';
import { classifyLatency, overallStatus, type ProbeResult } from './providerHealth';

const probe = (ok: boolean, ms = 100): ProbeResult => ({ name: 'x', ok, status: ok ? 200 : 500, ms });

describe('classifyLatency', () => {
    it('classifica as faixas de latência', () => {
        expect(classifyLatency(0)).toBe('good');
        expect(classifyLatency(499)).toBe('good');
        expect(classifyLatency(500)).toBe('ok');
        expect(classifyLatency(1499)).toBe('ok');
        expect(classifyLatency(1500)).toBe('slow');
        expect(classifyLatency(8000)).toBe('slow');
    });
});

describe('overallStatus', () => {
    it('online quando todos respondem', () => {
        expect(overallStatus([probe(true), probe(true), probe(true)])).toBe('online');
    });

    it('degradado quando parte falha', () => {
        expect(overallStatus([probe(true), probe(false), probe(true)])).toBe('degraded');
    });

    it('offline quando nada responde ou sem resultados', () => {
        expect(overallStatus([probe(false), probe(false)])).toBe('offline');
        expect(overallStatus([])).toBe('offline');
    });
});
