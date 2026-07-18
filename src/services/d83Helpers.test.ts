import { describe, it, expect, beforeEach } from 'vitest';
import { favoredCategoryIds, spinRoulette } from './rouletteService';
import { findDepartures, dismissDepartures } from './catalogDeparturesService';
import { normalizeTitle, matchCatalogByTitles } from './personSearchHelpers';

describe('rouletteService', () => {
    it('favoredCategoryIds prioriza categorias repetidas', () => {
        expect(favoredCategoryIds(['a', 'a', 'b', undefined])).toEqual(new Set(['a']));
        // sem repetição, toda categoria vista conta
        expect(favoredCategoryIds(['a', 'b'])).toEqual(new Set(['a', 'b']));
        expect(favoredCategoryIds([]).size).toBe(0);
    });

    it('spinRoulette pondera 3x as categorias favoritas', () => {
        const pool = [
            { name: 'comum', category_id: 'x' },
            { name: 'favorito', category_id: 'fav' },
        ];
        const favored = new Set(['fav']);
        // pesos: comum=1, favorito=3 (total 4). rand 0.1 → roll 0.4 cai no comum;
        // rand 0.5 → roll 2.0 cai no favorito.
        expect(spinRoulette(pool, favored, () => 0.1)?.name).toBe('comum');
        expect(spinRoulette(pool, favored, () => 0.5)?.name).toBe('favorito');
        expect(spinRoulette([], favored, () => 0.5)).toBeNull();
    });
});

describe('catalogDeparturesService', () => {
    beforeEach(() => localStorage.clear());

    it('aponta rastreados fora do catálogo e respeita dispensas', () => {
        const catalog = new Set(['movie:1']);
        const tracked = [
            { id: 'movie:1', name: 'Ainda no ar' },
            { id: 'movie:2', name: 'Saiu' },
        ];
        expect(findDepartures(catalog, tracked)).toEqual([{ id: 'movie:2', name: 'Saiu' }]);
        dismissDepartures(['movie:2']);
        expect(findDepartures(catalog, tracked)).toEqual([]);
    });

    it('catálogo vazio não gera aviso (falha de carga, não saída)', () => {
        expect(findDepartures(new Set(), [{ id: 'movie:2', name: 'X' }])).toEqual([]);
    });
});

describe('personSearchHelpers', () => {
    it('normalizeTitle limpa acentos, tags e pontuação', () => {
        expect(normalizeTitle('Cidade de Deus (2002) [L]')).toBe('cidade de deus');
        expect(normalizeTitle('Ação & Reação!')).toBe('acao reacao');
    });

    it('matchCatalogByTitles casa igualdade e prefixo com separador', () => {
        const items = [
            { name: 'Cidade de Deus' },
            { name: 'Cidade de Deus 2002 Dublado' },
            { name: 'Cidade Invisível' },
        ];
        const hits = matchCatalogByTitles(items, ['Cidade de Deus']);
        expect(hits.map(h => h.name)).toEqual(['Cidade de Deus', 'Cidade de Deus 2002 Dublado']);
        // título curto demais é ignorado (evita falso positivo em massa)
        expect(matchCatalogByTitles(items, ['de'])).toEqual([]);
    });
});
