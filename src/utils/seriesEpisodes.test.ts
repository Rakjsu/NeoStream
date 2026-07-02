import { describe, it, expect } from 'vitest';
import { episodeDisplayTitle, sortedSeasonKeys } from './seriesEpisodes';

describe('episodeDisplayTitle', () => {
    it('keeps a real episode title', () => {
        expect(episodeDisplayTitle('The Winds of Winter', 10)).toBe('The Winds of Winter');
    });

    it('strips a leading SxxExx marker + series name', () => {
        expect(episodeDisplayTitle('Breaking Bad S02E05 - Breakage', 5)).toBe('Breakage');
    });

    it('strips bracketed/parenthesised SxxExx anywhere', () => {
        expect(episodeDisplayTitle('Pilot [S01E01]', 1)).toBe('Pilot');
        expect(episodeDisplayTitle('(S01.E02) Cat in the Bag', 2)).toBe('Cat in the Bag');
    });

    it('strips "Temporada X Episódio Y" filler', () => {
        expect(episodeDisplayTitle('Título - Temporada 3 Episódio 7', 7)).toBe('Título');
    });

    it('strips a leading number prefix', () => {
        expect(episodeDisplayTitle('01 O Começo', 1)).toBe('O Começo');
    });

    it('falls back to "Episódio N" for empty or generic titles', () => {
        expect(episodeDisplayTitle('', 4)).toBe('Episódio 4');
        expect(episodeDisplayTitle('Ep 4', 4)).toBe('Episódio 4');
        expect(episodeDisplayTitle('12', 12)).toBe('Episódio 12');
        expect(episodeDisplayTitle('Episode 8', 8)).toBe('Episódio 8');
        expect(episodeDisplayTitle(undefined, 2)).toBe('Episódio 2');
        expect(episodeDisplayTitle(null, 3)).toBe('Episódio 3');
    });
});

describe('sortedSeasonKeys', () => {
    it('sorts numerically, not lexicographically', () => {
        expect(sortedSeasonKeys({ '2': [], '10': [], '1': [] })).toEqual(['1', '2', '10']);
    });

    it('returns [] for missing episodes map', () => {
        expect(sortedSeasonKeys(undefined)).toEqual([]);
        expect(sortedSeasonKeys(null)).toEqual([]);
    });
});
