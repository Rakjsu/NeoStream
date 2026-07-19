import { describe, expect, it } from 'vitest';
import { pickSearchHit, splitTitleYear, starsToTraktRating } from './traktService';

describe('splitTitleYear', () => {
    it('separa o ano entre parênteses do nome', () => {
        expect(splitTitleYear('Duna (2021)')).toEqual({ clean: 'Duna', year: 2021 });
        expect(splitTitleYear('Sem Ano')).toEqual({ clean: 'Sem Ano', year: undefined });
        expect(splitTitleYear('  (2020)  ')).toEqual({ clean: '', year: 2020 });
    });
});

describe('pickSearchHit', () => {
    const results = [
        { movie: { title: 'Duna', year: 1984, ids: { trakt: 1 } } },
        { movie: { title: 'Duna', year: 2021, ids: { trakt: 2 } } },
        { movie: { title: 'Duna: Parte Dois', year: 2024, ids: { trakt: 3 } } },
    ];

    it('título igual + ano vence', () => {
        expect(pickSearchHit(results, 'Duna', 2021)?.ids).toEqual({ trakt: 2 });
    });

    it('sem ano, o primeiro título igual vence', () => {
        expect(pickSearchHit(results, 'duna')?.ids).toEqual({ trakt: 1 });
    });

    it('sem match exato cai no primeiro resultado; vazio dá null', () => {
        expect(pickSearchHit(results, 'Outra Coisa')?.ids).toEqual({ trakt: 1 });
        expect(pickSearchHit([], 'Duna')).toBeNull();
    });
});

describe('starsToTraktRating (item 36)', () => {
    it('mapeia 1–5⭐ pra 2–10 do Trakt', () => {
        expect(starsToTraktRating(1)).toBe(2);
        expect(starsToTraktRating(3)).toBe(6);
        expect(starsToTraktRating(5)).toBe(10);
    });

    it('valores estranhos ficam presos em 1–10', () => {
        expect(starsToTraktRating(0.4)).toBe(1);
        expect(starsToTraktRating(7)).toBe(10);
    });
});
