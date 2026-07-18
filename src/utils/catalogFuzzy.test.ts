import { describe, expect, it } from 'vitest';
import { fuzzyIncludes, normalizeSearchText, qualityBadgeOf } from './catalogFilter';

describe('fuzzyIncludes (busca fuzzy do catálogo)', () => {
    it('ignora acentos, caixa e pontuação', () => {
        expect(fuzzyIncludes('Coração Valente', 'coracao')).toBe(true);
        expect(fuzzyIncludes('Spider-Man: No Way Home', 'spider man')).toBe(true);
        expect(fuzzyIncludes('Spider-Man', 'spiderman')).toBe(true);
    });

    it('tokens em qualquer ordem; query vazia casa tudo', () => {
        expect(fuzzyIncludes('O Senhor dos Anéis', 'aneis senhor')).toBe(true);
        expect(fuzzyIncludes('Qualquer Coisa', '   ')).toBe(true);
        expect(fuzzyIncludes('Matrix', 'matriz')).toBe(false);
    });

    it('normalizeSearchText achata tudo pra [a-z0-9 ]', () => {
        expect(normalizeSearchText('É.T.! — O Extraterrestre')).toBe('e t o extraterrestre');
    });
});

describe('qualityBadgeOf (selo 4K/FHD/HD)', () => {
    it('detecta pelo padrão do nome do provedor', () => {
        expect(qualityBadgeOf('Filme X 4K')).toBe('4K');
        expect(qualityBadgeOf('FILME UHD 2160p')).toBe('4K');
        expect(qualityBadgeOf('Filme Y FHD')).toBe('FHD');
        expect(qualityBadgeOf('Serie 1080p')).toBe('FHD');
        expect(qualityBadgeOf('Canal HD')).toBe('HD');
        expect(qualityBadgeOf('Filme Comum')).toBeNull();
    });

    it('não confunde palavras que contêm as siglas', () => {
        expect(qualityBadgeOf('Sahara')).toBeNull();
        expect(qualityBadgeOf('Chdteste')).toBeNull();
    });
});
