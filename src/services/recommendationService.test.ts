import { describe, it, expect } from 'vitest';
import {
    normalizeTitle,
    sharesFranchisePrefix,
    splitGenres,
    genreOverlapCount,
    seedWeight,
    scoreCandidate,
    bandedShuffle,
    buildRecommendations,
    groupBySeed,
    type RecSeed,
    type Recommendation,
    type RecMovie,
    type RecSeries
} from './recommendationService';

const seed = (overrides: Partial<RecSeed> & { name: string }): RecSeed => ({
    kind: 'vod',
    recencyRank: 0,
    genres: [],
    ...overrides
});

const movie = (overrides: Partial<RecMovie> & { stream_id: number; name: string }): RecMovie => ({
    stream_icon: 'icon.png',
    ...overrides
});

const series = (overrides: Partial<RecSeries> & { series_id: number; name: string }): RecSeries => ({
    cover: 'cover.png',
    ...overrides
});

describe('normalizeTitle', () => {
    it('lowercases, strips accents and punctuation', () => {
        expect(normalizeTitle('Ação & Reação!')).toBe('acao reacao');
    });

    it('strips year, bracket tags and quality markers', () => {
        expect(normalizeTitle('Matrix (1999) [4K] Dublado')).toBe('matrix');
        expect(normalizeTitle('Homem-Aranha: Sem Volta Para Casa HD')).toBe('homem aranha sem volta para casa');
    });
});

describe('sharesFranchisePrefix', () => {
    it('matches multi-word franchise prefixes', () => {
        expect(sharesFranchisePrefix('Homem-Aranha', 'Homem-Aranha: Sem Volta Para Casa')).toBe(true);
        expect(sharesFranchisePrefix('John Wick', 'John Wick 4: Baba Yaga')).toBe(true);
    });

    it('matches single-word franchises only when one title is exactly that word', () => {
        expect(sharesFranchisePrefix('Matrix', 'Matrix Reloaded')).toBe(true);
        // Conservative: a single shared word between two multi-word titles is
        // not enough ("American Pie" vs "American Sniper").
        expect(sharesFranchisePrefix('Matrix Reloaded', 'Matrix Revolutions')).toBe(false);
    });

    it('does not match unrelated titles or generic articles', () => {
        expect(sharesFranchisePrefix('O Poderoso Chefão', 'O Senhor dos Anéis')).toBe(false);
        expect(sharesFranchisePrefix('Lost', 'Lucifer')).toBe(false);
    });
});

describe('splitGenres / genreOverlapCount', () => {
    it('splits provider genre strings on common separators', () => {
        expect(splitGenres('Ação / Aventura, Sci-Fi & Fantasia')).toEqual(['acao', 'aventura', 'sci-fi', 'fantasia']);
        expect(splitGenres(undefined)).toEqual([]);
    });

    it('counts overlap with fuzzy containment matching', () => {
        expect(genreOverlapCount(['acao', 'aventura'], ['Ação e Aventura'])).toBe(2);
        expect(genreOverlapCount(['comedia'], ['Drama', 'Comédia'])).toBe(1);
        expect(genreOverlapCount(['terror'], ['Romance'])).toBe(0);
    });
});

describe('scoreCandidate', () => {
    const seeds: RecSeed[] = [
        seed({ name: 'Vingadores', recencyRank: 0, genres: ['Ação', 'Aventura'], categoryId: '10' }),
        seed({ name: 'Friends', kind: 'series', recencyRank: 1, genres: ['Comédia'] })
    ];

    it('scores genre overlap higher than no overlap', () => {
        const action = scoreCandidate({ name: 'Thor', genre: 'Ação, Aventura' }, seeds);
        const romance = scoreCandidate({ name: 'Diário de uma Paixão', genre: 'Romance' }, seeds);
        expect(action).not.toBeNull();
        expect(romance).toBeNull();
        expect(action!.becauseOf).toBe('Vingadores');
    });

    it('weights recent seeds higher than older ones', () => {
        const recentMatch = scoreCandidate({ name: 'Thor', genre: 'Ação' }, seeds)!;
        const olderMatch = scoreCandidate({ name: 'Seinfeld', genre: 'Comédia' }, seeds)!;
        expect(recentMatch.score).toBeGreaterThan(olderMatch.score);
        expect(olderMatch.becauseOf).toBe('Friends');
        expect(seedWeight(0)).toBeGreaterThan(seedWeight(1));
    });

    it('boosts franchise title prefixes even without genre data', () => {
        const franchise = scoreCandidate({ name: 'Vingadores: Ultimato' }, seeds);
        expect(franchise).not.toBeNull();
        expect(franchise!.becauseOf).toBe('Vingadores');
    });

    it('boosts same provider category as a fallback signal', () => {
        const sameCategory = scoreCandidate({ name: 'Homem de Ferro', category_id: '10' }, seeds);
        expect(sameCategory).not.toBeNull();
        expect(sameCategory!.becauseOf).toBe('Vingadores');
    });

    it('returns null when nothing matches', () => {
        expect(scoreCandidate({ name: 'Documentário Aleatório' }, seeds)).toBeNull();
        expect(scoreCandidate({ name: 'Qualquer' }, [])).toBeNull();
    });
});

describe('bandedShuffle', () => {
    it('keeps higher score bands ahead of lower ones', () => {
        const items = [
            { id: 'low', score: 1 },
            { id: 'high-a', score: 5 },
            { id: 'high-b', score: 5.1 },
            { id: 'mid', score: 3 }
        ];
        const result = bandedShuffle(items, () => 0.99);
        expect(result.map(i => i.id).indexOf('low')).toBe(3);
        expect(result.map(i => i.id).indexOf('mid')).toBe(2);
        // both high items (same 5.0 band after rounding) stay in the first band
        expect(result.slice(0, 2).map(i => i.id).sort()).toEqual(['high-a', 'high-b']);
    });

    it('varies order within a band depending on rng (diversity)', () => {
        const items = [
            { id: 'a', score: 5 },
            { id: 'b', score: 5 },
            { id: 'c', score: 5 }
        ];
        const orderA = bandedShuffle(items, () => 0).map(i => i.id);
        const orderB = bandedShuffle(items, () => 0.99).map(i => i.id);
        expect(orderA).not.toEqual(orderB);
        expect([...orderA].sort()).toEqual(['a', 'b', 'c']);
    });
});

describe('buildRecommendations', () => {
    const seeds: RecSeed[] = [
        seed({ name: 'Vingadores', recencyRank: 0, genres: ['Ação'], categoryId: '10' })
    ];

    const movies: RecMovie[] = [
        movie({ stream_id: 1, name: 'Vingadores', genre: 'Ação' }),            // is the seed itself
        movie({ stream_id: 2, name: 'Thor', genre: 'Ação' }),
        movie({ stream_id: 3, name: 'Homem de Ferro', category_id: '10' }),
        movie({ stream_id: 4, name: 'Romance Total', genre: 'Romance' }),       // no signal
        movie({ stream_id: 5, name: 'Filme Já Visto', genre: 'Ação' })          // excluded by id
    ];

    const seriesList: RecSeries[] = [
        series({ series_id: 7, name: 'Vingadores Unidos', genre: 'Animação' }), // franchise prefix
        series({ series_id: 8, name: 'Série Assistida', genre: 'Ação' })        // excluded by title
    ];

    const run = () => buildRecommendations({
        seeds,
        movies,
        series: seriesList,
        excludeTitles: new Set([normalizeTitle('Série Assistida')]),
        excludeMovieIds: new Set(['5']),
        excludeSeriesIds: new Set(),
        rng: () => 0.5
    });

    it('excludes seeds, watched ids and watched titles', () => {
        const names = run().map(r => r.item.name);
        expect(names).not.toContain('Vingadores');
        expect(names).not.toContain('Filme Já Visto');
        expect(names).not.toContain('Série Assistida');
        expect(names).not.toContain('Romance Total');
    });

    it('includes scored matches from both kinds with becauseOf set', () => {
        const recs = run();
        const names = recs.map(r => r.item.name);
        expect(names).toContain('Thor');
        expect(names).toContain('Homem de Ferro');
        expect(names).toContain('Vingadores Unidos');
        expect(recs.every(r => r.becauseOf === 'Vingadores')).toBe(true);
        expect(recs.find(r => r.item.name === 'Vingadores Unidos')!.kind).toBe('series');
    });

    it('caps results at maxItems', () => {
        const manyMovies = Array.from({ length: 50 }, (_, i) =>
            movie({ stream_id: 100 + i, name: `Ação ${i}`, genre: 'Ação' }));
        const recs = buildRecommendations({
            seeds,
            movies: manyMovies,
            series: [],
            excludeTitles: new Set(),
            excludeMovieIds: new Set(),
            excludeSeriesIds: new Set(),
            maxItems: 20,
            rng: () => 0.5
        });
        expect(recs.length).toBe(20);
    });

    it('returns empty for empty seeds', () => {
        expect(buildRecommendations({
            seeds: [],
            movies,
            series: seriesList,
            excludeTitles: new Set(),
            excludeMovieIds: new Set(),
            excludeSeriesIds: new Set()
        })).toEqual([]);
    });
});

describe('groupBySeed', () => {
    const rec = (name: string, becauseOf: string, score = 1): Recommendation => ({
        kind: 'vod',
        item: movie({ stream_id: name.length, name }),
        becauseOf,
        score
    });

    it('groups by dominant seed, largest groups first, max 2 groups', () => {
        const recs = [
            rec('a1', 'Seed A'), rec('a2', 'Seed A'), rec('a3', 'Seed A'),
            rec('b1', 'Seed B'), rec('b2', 'Seed B'), rec('b3', 'Seed B'), rec('b4', 'Seed B'),
            rec('c1', 'Seed C'), rec('c2', 'Seed C'), rec('c3', 'Seed C')
        ];
        const groups = groupBySeed(recs, 2, 3);
        expect(groups.length).toBe(2);
        expect(groups[0].seedName).toBe('Seed B');
        expect(groups[0].items.length).toBe(4);
    });

    it('drops groups below the minimum size', () => {
        const recs = [rec('a1', 'Seed A'), rec('b1', 'Seed B'), rec('b2', 'Seed B'), rec('b3', 'Seed B')];
        const groups = groupBySeed(recs, 2, 3);
        expect(groups.length).toBe(1);
        expect(groups[0].seedName).toBe('Seed B');
    });

    it('preserves the incoming item order within a group', () => {
        const recs = [rec('b1', 'Seed B'), rec('b2', 'Seed B'), rec('b3', 'Seed B')];
        const groups = groupBySeed(recs, 2, 3);
        expect(groups[0].items.map(r => r.item.name)).toEqual(['b1', 'b2', 'b3']);
    });
});
