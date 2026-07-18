import { describe, it, expect } from 'vitest';
import { decadeOf, listDecades, listGenres, matchesFilters, yearOf } from './catalogFilter';

describe('catalogFilter (década + gênero)', () => {
    it('yearOf prefere o release_date e cai pro (YYYY) do nome', () => {
        expect(yearOf({ name: 'Filme X', release_date: '2019-05-01' })).toBe(2019);
        expect(yearOf({ name: 'Filme Y (1994)' })).toBe(1994);
        expect(yearOf({ name: 'Sem ano' })).toBeNull();
        expect(yearOf({ name: 'Sala 302' })).toBeNull(); // número solto não é ano
    });

    it('décadas ficam da mais nova pra mais velha, sem repetir', () => {
        const items = [
            { name: 'A', release_date: '2021-01-01' },
            { name: 'B (2023)' },
            { name: 'C', release_date: '1999-12-31' },
            { name: 'D' },
        ];
        expect(listDecades(items)).toEqual([2020, 1990]);
        expect(decadeOf(2016)).toBe(2010);
    });

    it('gêneros contam por frequência com split por vírgula/barra', () => {
        const items = [
            { name: 'A', genre: 'Ação, Comédia' },
            { name: 'B', genre: 'Ação / Drama' },
            { name: 'C', genre: 'Comédia' },
            { name: 'D', genre: 'Ação' },
        ];
        expect(listGenres(items)).toEqual(['Ação', 'Comédia', 'Drama']);
        expect(listGenres(items, 1)).toEqual(['Ação']);
    });

    it('matchesFilters combina década e gênero (case-insensitive)', () => {
        const item = { name: 'X (2015)', genre: 'Terror, Suspense' };
        expect(matchesFilters(item, 2010, 'terror')).toBe(true);
        expect(matchesFilters(item, 2000, 'terror')).toBe(false);
        expect(matchesFilters(item, 2010, 'Comédia')).toBe(false);
        expect(matchesFilters(item, null, null)).toBe(true);
        expect(matchesFilters({ name: 'Sem ano', genre: 'Terror' }, 2010, null)).toBe(false);
    });
});
