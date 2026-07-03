import { describe, it, expect } from 'vitest';
import { findUpdatedSeries, buildBaselineAdditions, parseLastModified } from './newEpisodesService';

const series = (id: number, lastModified?: string) => ({ series_id: id, name: `S${id}`, last_modified: lastModified });

describe('parseLastModified', () => {
    it('converte epoch string e cai pra 0 em lixo', () => {
        expect(parseLastModified('1751400000')).toBe(1751400000);
        expect(parseLastModified(undefined)).toBe(0);
        expect(parseLastModified('abc')).toBe(0);
        expect(parseLastModified('-5')).toBe(0);
    });
});

describe('buildBaselineAdditions', () => {
    it('registra só as seguidas ainda sem baseline', () => {
        const additions = buildBaselineAdditions(
            [series(1, '100'), series(2, '200'), series(3, '300')],
            new Set(['1', '2']),
            { '1': 100 }
        );
        expect(additions).toEqual({ '2': 200 });
    });
});

describe('findUpdatedSeries', () => {
    const seen = { '1': 100, '2': 200, '3': 300 };

    it('sinaliza apenas seguidas com last_modified maior que o baseline', () => {
        const updated = findUpdatedSeries(
            [series(1, '150'), series(2, '200'), series(3, '350'), series(4, '999')],
            new Set(['1', '2', '3']),
            seen
        );
        expect(updated.map(u => u.series_id)).toEqual([3, 1]); // ordenado por modificação desc
    });

    it('primeira vez vista (sem baseline) não sinaliza', () => {
        expect(findUpdatedSeries([series(9, '500')], new Set(['9']), {})).toEqual([]);
    });

    it('não seguidas nunca sinalizam', () => {
        expect(findUpdatedSeries([series(1, '999')], new Set(), seen)).toEqual([]);
    });
});
