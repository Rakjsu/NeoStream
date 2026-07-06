import { describe, it, expect } from 'vitest';
import {
    getVersionInfo,
    getVersionLabel,
    getMovieBaseName,
    isSameMovie,
    findMovieVersions,
    isCurrentVersion,
    type MovieLike,
} from './movieVersionService';

describe('getVersionInfo / getVersionLabel', () => {
    it('detecta 4K e [L] (legendado) no nome', () => {
        expect(getVersionInfo('Avatar 4K [L] (2009)')).toEqual({ quality: '4k', audio: 'subtitled' });
        expect(getVersionInfo('Avatar (2009)')).toEqual({ quality: '1080p', audio: 'dubbed' });
        expect(getVersionInfo('Filme [l]')).toEqual({ quality: '1080p', audio: 'subtitled' });
    });

    it('monta o rótulo em português', () => {
        expect(getVersionLabel('4k', 'subtitled')).toBe('4K Legendado');
        expect(getVersionLabel('1080p', 'dubbed')).toBe('1080p Dublado');
    });
});

describe('getMovieBaseName', () => {
    it('remove marcadores de versão, ano e colchetes', () => {
        expect(getMovieBaseName('Avatar 4K [L] (2009)')).toBe('avatar');
        expect(getMovieBaseName('Matrix [DUAL] (1999)')).toBe('matrix');
    });

    it('normaliza espaços e caracteres especiais', () => {
        expect(getMovieBaseName('O  Poderoso   Chefão!')).toBe('o poderoso chefo');
    });
});

describe('isSameMovie', () => {
    it('mesmo filme em versões diferentes → true', () => {
        expect(isSameMovie('Avatar (2009)', 'Avatar 4K [L] (2009)')).toBe(true);
    });

    it('sequências com números diferentes → false', () => {
        expect(isSameMovie('Velozes e Furiosos 9', 'Velozes e Furiosos 8 [4K]')).toBe(false);
        expect(isSameMovie('Matrix 2', 'Matrix 3')).toBe(false);
    });

    it('mesma sequência com o mesmo número → true', () => {
        expect(isSameMovie('Velozes e Furiosos 9', 'Velozes e Furiosos 9 4K [L]')).toBe(true);
    });

    it('numerais romanos contam como número de sequência', () => {
        expect(isSameMovie('Rocky II', 'Rocky III')).toBe(false);
    });

    it('nomes curtos exigem match exato (sem parcial)', () => {
        expect(isSameMovie('Urano', 'Uranopolis')).toBe(false);
    });

    it('nome vazio nunca casa', () => {
        expect(isSameMovie('', 'Avatar')).toBe(false);
        expect(isSameMovie('[L] (2009)', 'Avatar')).toBe(false);
    });
});

describe('findMovieVersions', () => {
    const catalog = [
        { name: 'Avatar (2009)', stream_id: 1 },
        { name: 'Avatar 4K (2009)', stream_id: 2 },
        { name: 'Avatar [L] (2009)', stream_id: 3 },
        { name: 'Avatar 4K [L] (2009)', stream_id: 4 },
        { name: 'Avatar 2 (2022)', stream_id: 5 }, // sequência — fora
        { name: 'Titanic (1997)', stream_id: 6 },  // outro filme
    ];

    it('acha todas as versões e ordena 1080p Dub → 1080p Leg → 4K Dub → 4K Leg', () => {
        const versions = findMovieVersions(catalog[0], catalog);
        expect(versions.map(v => v.label)).toEqual([
            '1080p Dublado',
            '1080p Legendado',
            '4K Dublado',
            '4K Legendado',
        ]);
        expect(versions.map(v => v.movie.stream_id)).toEqual([1, 3, 2, 4]);
    });

    it('deduplica versões iguais (mesma qualidade + áudio)', () => {
        const dupes = [
            { name: 'Filme Longo Demais (2020)', stream_id: 1 },
            { name: 'Filme Longo Demais (2020)', stream_id: 2 },
        ];
        const versions = findMovieVersions(dupes[0], dupes);
        expect(versions).toHaveLength(1);
    });

    it('filme sem nome ou catálogo vazio → []', () => {
        expect(findMovieVersions<MovieLike>({ stream_id: 1 }, catalog)).toEqual([]);
        expect(findMovieVersions(catalog[0], [])).toEqual([]);
    });
});

describe('isCurrentVersion', () => {
    it('compara pelo stream_id', () => {
        const movie = { name: 'Avatar', stream_id: 2 };
        const version = { movie, quality: '4k' as const, audio: 'dubbed' as const, label: '4K Dublado' };
        expect(isCurrentVersion(movie, version)).toBe(true);
        expect(isCurrentVersion({ name: 'Avatar', stream_id: 9 }, version)).toBe(false);
    });
});
