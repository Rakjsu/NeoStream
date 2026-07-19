import { describe, expect, it } from 'vitest';
import { cleanTitle, episodeKey, titleMatches } from './traktBackfillService';

describe('titleMatches (fix: matching estrito Trakt ↔ catálogo)', () => {
    it('igualdade normalizada casa (ano e caixa ignorados)', () => {
        expect(titleMatches('Drive (2011)', 'drive')).toBe(true);
        expect(titleMatches('DRIVE', 'Drive')).toBe(true);
    });

    it('título do catálogo com subtítulo casa com o título base do Trakt', () => {
        expect(titleMatches('Sex Drive: Rumo ao Sexo', 'Sex Drive')).toBe(true);
        expect(titleMatches('Mad Max - Estrada da Fúria', 'Mad Max')).toBe(true);
    });

    it('substring solta NÃO casa — "Drive" não vira "Sex Drive"', () => {
        expect(titleMatches('Sex Drive: Rumo ao Sexo', 'Drive')).toBe(false);
        expect(titleMatches('Driven', 'Drive')).toBe(false);
        expect(titleMatches('Drive', 'Sex Drive')).toBe(false);
    });

    it('vale nos dois sentidos (Trakt com subtítulo, catálogo base)', () => {
        expect(titleMatches('Sex Drive', 'Sex Drive: Rumo ao Sexo')).toBe(true);
    });
});

describe('helpers do backfill', () => {
    it('cleanTitle tira o ano e normaliza', () => {
        expect(cleanTitle('Filme (2020) ')).toBe('filme');
    });

    it('episodeKey é estável por série+SxxEyy', () => {
        expect(episodeKey('Série (2020)', 2, 5)).toBe('série|2|5');
    });
});
