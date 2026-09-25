import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSimilarByTmdbId, fetchPersonFilmography } from './tmdb';

/**
 * 📅 Parecidos e filmografia têm que trazer a data do TMDB (#D169).
 *
 * A ficha casa esses títulos com o nome sujo do provedor por prefixo
 * ("Oppenheimer 2023 Dublado"), e é o ano que impede um remake de abrir a
 * outra obra ("RoboCop" 2014 × "RoboCop 1987 Dublado"). Se o mapeamento do
 * TMDB jogar a data fora, o casador cai no modo sem ano e o card abre errado.
 *
 * Ids próprios por caso: o módulo memoiza as respostas num cache de módulo.
 */
describe('tmdb: rails da ficha carregam a data de lançamento', () => {
    const responderCom = (mapa: Record<string, unknown>) => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            const chave = Object.keys(mapa).find(k => url.includes(k));
            const corpo = chave ? mapa[chave] : null;
            if (!corpo) return { ok: false, status: 404, json: async () => ({}) };
            return { ok: true, status: 200, json: async () => corpo };
        }));
    };

    beforeEach(() => {
        localStorage.setItem('neostream_tmdb_api_key', 'chave-de-teste');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('Parecidos de filme: release_date', async () => {
        responderCom({ '/movie/9101/similar': { results: [
            { id: 1, title: 'RoboCop', poster_path: '/r.jpg', release_date: '2014-02-07' },
            { id: 2, title: 'Sem Data', poster_path: '/s.jpg', release_date: '' },
        ] } });
        const itens = await fetchSimilarByTmdbId('9101', 'movie');
        expect(itens.map(i => i.release_date)).toEqual(['2014-02-07', undefined]);
    });

    it('Parecidos de série: a estreia (first_air_date) vira a data', async () => {
        responderCom({ '/tv/9102/similar': { results: [
            { id: 3, name: 'Gossip Girl', poster_path: '/g.jpg', first_air_date: '2021-07-08' },
        ] } });
        const itens = await fetchSimilarByTmdbId('9102', 'series');
        expect(itens).toEqual([
            { id: 3, title: 'Gossip Girl', poster_path: '/g.jpg', vote_average: undefined, release_date: '2021-07-08' },
        ]);
    });

    it('filmografia da pessoa: release_date', async () => {
        responderCom({ '/person/9103/movie_credits': { cast: [
            { id: 4, title: 'Oppenheimer', poster_path: '/o.jpg', popularity: 10, release_date: '2023-07-19' },
        ] } });
        const itens = await fetchPersonFilmography(9103);
        expect(itens.map(i => i.release_date)).toEqual(['2023-07-19']);
    });
});
