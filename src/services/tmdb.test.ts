import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getBackdropUrl, isKidsFriendly, resolveMovieDetails, resolveSeriesDetails } from './tmdb'

describe('tmdb.getBackdropUrl', () => {
    it('returns null when no path is provided', () => {
        expect(getBackdropUrl(null)).toBeNull()
        expect(getBackdropUrl('')).toBeNull()
    })

    it('builds an original-size URL by default', () => {
        expect(getBackdropUrl('/abc.jpg')).toBe(
            'https://image.tmdb.org/t/p/original/abc.jpg'
        )
    })

    it('uses the requested size when provided', () => {
        expect(getBackdropUrl('/abc.jpg', 'w1280')).toBe(
            'https://image.tmdb.org/t/p/w1280/abc.jpg'
        )
    })
})

describe('tmdb.isKidsFriendly', () => {
    it('blocks unknown/empty certifications by default', () => {
        expect(isKidsFriendly(null)).toBe(false)
        expect(isKidsFriendly(undefined)).toBe(false)
        expect(isKidsFriendly('')).toBe(false)
    })

    it('allows kids-friendly ratings (Brazilian / US / UK / general)', () => {
        for (const rating of ['L', 'Livre', '10', 'G', 'TV-Y', 'TV-Y7', 'TV-G', 'U', 'UC', '0', '6', '7', 'ALL']) {
            expect(isKidsFriendly(rating)).toBe(true)
        }
    })

    it('blocks adult-ish ratings', () => {
        for (const rating of ['PG-13', 'R', 'NC-17', '14', '16', '18', 'TV-MA']) {
            expect(isKidsFriendly(rating)).toBe(false)
        }
    })

    it('is case-insensitive and trims whitespace', () => {
        expect(isKidsFriendly('  livre ')).toBe(true)
        expect(isKidsFriendly('tv-y7')).toBe(true)
    })
})

/**
 * 🎯 A ficha tem que abrir o título que o provedor apontou.
 *
 * O fundo da tela já vinha de `/movie/<tmdb_id>`, mas sinopse, nota, gêneros e
 * os rails "Parecidos"/elenco vinham do `results[0]` de `/search/movie`. Com a
 * busca errando o alvo — e com nome de provedor ("4K", "[DUB]", "(1999)") ela
 * erra —, as duas metades da MESMA tela eram de filmes diferentes.
 *
 * Os casos afirmam qual URL a TMDB recebe, não como o código está escrito.
 * Cada um usa id e nome próprios: o módulo memoiza detalhes e buscas num cache
 * de módulo, que `localStorage.clear()` não alcança.
 */
describe('tmdb.resolveMovieDetails / resolveSeriesDetails', () => {
    let urls: string[] = [];

    const responderCom = (mapa: Record<string, unknown>) => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            urls.push(url);
            const chave = Object.keys(mapa).find(k => url.includes(k));
            const corpo = chave ? mapa[chave] : null;
            if (!corpo) return { ok: false, status: 404, json: async () => ({}) };
            return { ok: true, status: 200, json: async () => corpo };
        }));
    };

    beforeEach(() => {
        urls = [];
        localStorage.setItem('neostream_tmdb_api_key', 'chave-de-teste');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('com tmdb_id, pede o filme por id e nem encosta na busca por nome', async () => {
        responderCom({ '/movie/603': { id: 603, title: 'Matrix', overview: 'a sinopse certa' } });

        const dados = await resolveMovieDetails('603', 'Matrix 4K [DUB] (1999)', '1999');

        expect(dados?.id).toBe(603);
        expect(urls.some(u => u.includes('/movie/603'))).toBe(true);
        expect(urls.some(u => u.includes('/search/movie'))).toBe(false);
    });

    it('sem tmdb_id (M3U/Stalker), continua caindo na busca por nome', async () => {
        responderCom({
            '/search/movie': { results: [{ id: 604 }] },
            '/movie/604': { id: 604, title: 'Outro' },
        });

        const dados = await resolveMovieDetails(undefined, 'Filme Sem Id Nenhum', '2001');

        expect(dados?.id).toBe(604);
        expect(urls.some(u => u.includes('/search/movie'))).toBe(true);
    });

    it('id que a TMDB recusa cai na busca por nome em vez de ficar sem ficha', async () => {
        responderCom({
            '/search/movie': { results: [{ id: 605 }] },
            '/movie/605': { id: 605, title: 'Achado pela busca' },
        });

        const dados = await resolveMovieDetails('999999', 'Filme Com Id Torto', '2002');

        expect(urls.some(u => u.includes('/movie/999999'))).toBe(true);
        expect(urls.some(u => u.includes('/search/movie'))).toBe(true);
        expect(dados?.id).toBe(605);
    });

    it('série com tmdb_id: sinopse e títulos de episódio saem do MESMO show', async () => {
        responderCom({ '/tv/1396': { id: 1396, name: 'Breaking Bad' } });

        const dados = await resolveSeriesDetails('1396', 'Breaking Bad (2008)', '2008');

        expect(dados?.id).toBe(1396);
        expect(urls.some(u => u.includes('/search/tv'))).toBe(false);
    });
});
