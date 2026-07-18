import { describe, expect, it } from 'vitest';
import { buildCatalogCsv } from './catalogExport';

describe('buildCatalogCsv', () => {
    it('gera cabeçalho + uma linha por item com ano extraído', () => {
        const csv = buildCatalogCsv([
            { name: 'Filme A', release_date: '2021-05-01', genre: 'Ação' },
            { name: 'Filme B (1999)', release_date: '1999' },
        ]);
        const lines = csv.trim().split('\r\n');
        expect(lines[0]).toBe('name,year,genre');
        expect(lines[1]).toBe('"Filme A","2021","Ação"');
        expect(lines[2]).toBe('"Filme B (1999)","1999",""');
    });

    it('escapa aspas dentro do nome', () => {
        const csv = buildCatalogCsv([{ name: 'O "Chefe"' }]);
        expect(csv).toContain('"O ""Chefe""","",""');
    });
});
