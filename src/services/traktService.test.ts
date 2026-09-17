import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fetchTraktProfile,
    fetchTraktWatchlist,
    isTraktConnected,
    pickSearchHit,
    syncTraktMovieWatched,
    pickTmdbHitIds,
    splitTitleYear,
    starsToTraktRating,
} from './traktService';

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

describe('pickTmdbHitIds (resolução exata pelo TMDB id)', () => {
    it('extrai os ids do tipo pedido', () => {
        const results = [{ type: 'movie', movie: { ids: { trakt: 1, tmdb: 550 } } }];
        expect(pickTmdbHitIds(results, 'movie')).toEqual({ trakt: 1, tmdb: 550 });
    });

    it('ignora hits de outro tipo e lixo', () => {
        const results = [{ type: 'show', show: { ids: { trakt: 9 } } }];
        expect(pickTmdbHitIds(results, 'movie')).toBeNull();
        expect(pickTmdbHitIds(null, 'movie')).toBeNull();
        expect(pickTmdbHitIds([{}], 'show')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Renovacao do access token (o access do Trakt vence; sem isto todo /sync
// passava a dar 401 em silencio e a tela continuava dizendo "conectado").
// ---------------------------------------------------------------------------

const CREDS_KEY = 'neostream_trakt_creds';
const TOKEN_KEY = 'neostream_trakt_token';

interface ChamadaDublada { url: string; init?: RequestInit }

/** Duble de fetch que anota TODA chamada (url + init) pra inspecao depois. */
function dublarFetch(responder: (url: string, init?: RequestInit) => { status: number; body?: unknown }): ChamadaDublada[] {
    const chamadas: ChamadaDublada[] = [];
    vi.stubGlobal('fetch', vi.fn((url: unknown, init?: RequestInit) => {
        const alvo = String(url);
        chamadas.push({ url: alvo, init });
        const { status, body } = responder(alvo, init);
        return Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body ?? {}),
        } as unknown as Response);
    }));
    return chamadas;
}

function bearerDe(init?: RequestInit): string {
    return (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
}

const contar = (chamadas: ChamadaDublada[], trecho: string) => chamadas.filter(c => c.url.includes(trecho)).length;

describe('renovacao do access token no 401', () => {
    beforeEach(() => {
        localStorage.setItem(CREDS_KEY, JSON.stringify({ clientId: 'cid', clientSecret: 'segredo' }));
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ access: 'vencido', refresh: 'refresh-1' }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('troca o refresh por um access novo e repete a chamada uma vez', async () => {
        const chamadas = dublarFetch((url, init) => {
            if (url.includes('/oauth/token')) return { status: 200, body: { access_token: 'novo', refresh_token: 'refresh-2' } };
            if (bearerDe(init) !== 'Bearer novo') return { status: 401 };
            return { status: 200, body: { username: 'rakjs' } };
        });

        // a chamada REALMENTE completou depois do 401 (nao e so "nao explodiu")
        expect(await fetchTraktProfile()).toBe('rakjs');

        const renovacao = chamadas.find(c => c.url.includes('/oauth/token'));
        expect(JSON.parse(String(renovacao?.init?.body ?? '{}'))).toMatchObject({
            grant_type: 'refresh_token',
            refresh_token: 'refresh-1',
            client_id: 'cid',
            client_secret: 'segredo',
        });
        // o par novo tem que ficar GRAVADO, senao cada requisicao gasta um refresh
        expect(JSON.parse(localStorage.getItem(TOKEN_KEY) ?? '{}')).toEqual({ access: 'novo', refresh: 'refresh-2' });
        // exatamente UMA repeticao — nunca um laco
        expect(contar(chamadas, '/users/me')).toBe(2);
    });

    it('duas chamadas em paralelo gastam UM refresh so', async () => {
        const chamadas = dublarFetch((url, init) => {
            if (url.includes('/oauth/token')) return { status: 200, body: { access_token: 'novo', refresh_token: 'refresh-2' } };
            if (bearerDe(init) !== 'Bearer novo') return { status: 401 };
            return { status: 200, body: url.includes('/movies') ? [{ movie: { title: 'Duna' } }] : [{ show: { title: 'Arcane' } }] };
        });

        expect(await fetchTraktWatchlist()).toEqual([
            { kind: 'movie', title: 'Duna' },
            { kind: 'series', title: 'Arcane' },
        ]);
        // o refresh_token do Trakt e de uso unico: duas renovacoes = a 2a e recusada
        expect(contar(chamadas, '/oauth/token')).toBe(1);
    });

    it('renovacao que nao resolve o 401 nao vira laco', async () => {
        // o Trakt aceita o refresh mas a chamada continua 401 (escopo errado,
        // app revogado do lado de la...): tem que parar na PRIMEIRA repeticao,
        // senao cada requisicao queima uma cadeia inteira de refresh_token.
        const chamadas = dublarFetch(url => (url.includes('/oauth/token')
            ? { status: 200, body: { access_token: 'novo', refresh_token: 'refresh-2' } }
            : { status: 401 }));

        expect(await fetchTraktProfile()).toBe('');
        expect(contar(chamadas, '/users/me')).toBe(2);
        expect(contar(chamadas, '/oauth/token')).toBe(1);
        expect(isTraktConnected()).toBe(true); // o Trakt aceitou o refresh: nao desconecta
    });

    it('refresh recusado pelo Trakt desconecta, pra tela parar de dizer Conectado', async () => {
        dublarFetch(() => ({ status: 401 }));

        expect(await fetchTraktProfile()).toBe('');
        expect(isTraktConnected()).toBe(false);
    });

    // SO o 401 diz "este refresh nao vale mais". Recusa passageira NAO pode
    // deslogar ninguem — reconectar no Trakt e device code na mao, no site. O
    // 400 esta na lista de proposito: e o que o Trakt devolve se o corpo desta
    // requisicao estiver errado, e o formato dele veio da documentacao, nao de
    // uma medicao — um erro MEU nao pode custar a conexao do usuario.
    it.each([
        ['Trakt fora do ar (5xx)', 503],
        ['limite de requisicoes (429)', 429],
        ['corpo recusado (400)', 400],
    ])('%s NAO apaga a conexao', async (_nome, status) => {
        dublarFetch(url => (url.includes('/oauth/token') ? { status } : { status: 401 }));

        expect(await fetchTraktProfile()).toBe('');
        expect(isTraktConnected()).toBe(true);
        expect(JSON.parse(localStorage.getItem(TOKEN_KEY) ?? '{}').refresh).toBe('refresh-1');
    });

    it('rajada SEQUENCIAL com o mesmo access gasta UM refresh so', async () => {
        // `syncTraktMovieWatched` le o token UMA vez e faz duas idas seguidas
        // (busca o id, depois posta no /sync/history) com o MESMO valor. Sem
        // reler o token gravado, a segunda ida sairia com o access velho, daria
        // 401 e queimaria um segundo refresh_token.
        const chamadas = dublarFetch((url, init) => {
            if (url.includes('/oauth/token')) return { status: 200, body: { access_token: 'novo', refresh_token: 'refresh-2' } };
            if (bearerDe(init) !== 'Bearer novo') return { status: 401 };
            if (url.includes('/search/')) return { status: 200, body: [{ type: 'movie', score: 900, movie: { title: 'Duna', year: 2021, ids: { trakt: 1, slug: 'duna' } } }] };
            return { status: 200, body: {} };
        });

        expect(await syncTraktMovieWatched('Duna (2021)')).toBe(true);
        expect(contar(chamadas, '/oauth/token')).toBe(1);
    });

    it('erro que NAO e 401 nem tenta renovar', async () => {
        const chamadas = dublarFetch(() => ({ status: 500 }));

        expect(await fetchTraktProfile()).toBe('');
        expect(contar(chamadas, '/oauth/token')).toBe(0);
        expect(isTraktConnected()).toBe(true);
    });
});
