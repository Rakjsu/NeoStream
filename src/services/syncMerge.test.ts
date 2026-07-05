import { describe, it, expect } from 'vitest';
import { mergeSyncData } from './syncMerge';

const fav = (id: string, addedAt = '2026-01-01') => ({ id, type: 'movie', title: id, poster: '', addedAt });
const movie = (movieId: string, watchedAt: number, progress = 50) => ({
    movieId, movieName: movieId, profileId: 'p1', currentTime: 10, duration: 100, progress, watchedAt, completed: false,
});
const episode = (seriesId: string, season: number, ep: number, watchedAt: number) => ({
    seriesId, seasonNumber: season, episodeNumber: ep, profileId: 'p1', watchedAt, completed: false,
});

describe('mergeSyncData', () => {
    it('adota chaves que não existem localmente', () => {
        const result = mergeSyncData({}, { 'neostream_theme': '{"accent":"red"}' });
        expect(result.changed['neostream_theme']).toBe('{"accent":"red"}');
        expect(result.adoptedKeys).toBe(1);
    });

    it('ignora chaves fora da allowlist de backup', () => {
        const result = mergeSyncData({}, { 'tmdb_cache_x': 'lixo', 'evil': '1' });
        expect(result.changed).toEqual({});
    });

    it('prefs escalares existentes: local vence (sem thrash)', () => {
        const result = mergeSyncData({ 'neostream_language': 'pt' }, { 'neostream_language': 'en' });
        expect(result.changed).toEqual({});
    });

    it('favoritos do perfil: união por id, ordem local primeiro', () => {
        const local = JSON.stringify({ favorites: [fav('a')], other: 1 });
        const remote = JSON.stringify({ favorites: [fav('b'), fav('a')] });
        const result = mergeSyncData(
            { 'neostream_profile_p1__pl_x': local },
            { 'neostream_profile_p1__pl_x': remote },
        );
        const merged = JSON.parse(result.changed['neostream_profile_p1__pl_x']);
        expect(merged.favorites.map((f: { id: string }) => f.id)).toEqual(['a', 'b']);
        expect(merged.other).toBe(1);
        expect(result.addedItems).toBe(1);
    });

    it('watch-later: união por (id,type) sem duplicar', () => {
        const local = JSON.stringify([fav('a')]);
        const remote = JSON.stringify([fav('a'), fav('c')]);
        const result = mergeSyncData(
            { 'neostream_watchlater_p1__pl_x': local },
            { 'neostream_watchlater_p1__pl_x': remote },
        );
        expect(JSON.parse(result.changed['neostream_watchlater_p1__pl_x'])).toHaveLength(2);
    });

    it('progresso de filme: entrada mais recente (watchedAt) vence por item', () => {
        const local = JSON.stringify([movie('m1', 100, 20), movie('m2', 500)]);
        const remote = JSON.stringify([movie('m1', 200, 80), movie('m2', 400)]);
        const result = mergeSyncData(
            { 'movie_watch_progress_p1': local },
            { 'movie_watch_progress_p1': remote },
        );
        const merged = JSON.parse(result.changed['movie_watch_progress_p1']);
        const m1 = merged.find((m: { movieId: string }) => m.movieId === 'm1');
        const m2 = merged.find((m: { movieId: string }) => m.movieId === 'm2');
        expect(m1.progress).toBe(80); // remoto mais novo
        expect(m2.watchedAt).toBe(500); // local mais novo
    });

    it('progresso de série: chave por episódio, mais novo vence', () => {
        const local = JSON.stringify([episode('s1', 1, 1, 100)]);
        const remote = JSON.stringify([episode('s1', 1, 1, 50), episode('s1', 1, 2, 300)]);
        const result = mergeSyncData(
            { 'series_watch_progress_p1': local },
            { 'series_watch_progress_p1': remote },
        );
        const merged = JSON.parse(result.changed['series_watch_progress_p1']);
        expect(merged).toHaveLength(2);
        expect(merged.find((e: { episodeNumber: number }) => e.episodeNumber === 1).watchedAt).toBe(100);
    });

    it('registro de perfis: adiciona perfis só-remotos, mantém locais em conflito', () => {
        const local = JSON.stringify({ profiles: [{ id: 'p1', name: 'Local' }], activeProfileId: 'p1' });
        const remote = JSON.stringify({ profiles: [{ id: 'p1', name: 'Remoto' }, { id: 'p2', name: 'Novo' }] });
        const result = mergeSyncData({ 'neostream_profiles': local }, { 'neostream_profiles': remote });
        const merged = JSON.parse(result.changed['neostream_profiles']);
        expect(merged.profiles).toHaveLength(2);
        expect(merged.profiles[0].name).toBe('Local');
        expect(merged.activeProfileId).toBe('p1');
    });

    it('sem novidade: não marca chave como alterada (idempotente)', () => {
        const same = JSON.stringify([fav('a')]);
        const result = mergeSyncData(
            { 'neostream_watchlater_p1': same },
            { 'neostream_watchlater_p1': JSON.stringify([fav('a')]) },
        );
        expect(result.changed).toEqual({});
        expect(result.addedItems).toBe(0);
    });

    it('JSON remoto corrompido: mantém o local', () => {
        const result = mergeSyncData(
            { 'movie_watch_progress_p1': '[]' },
            { 'movie_watch_progress_p1': '{corrompido' },
        );
        expect(result.changed).toEqual({});
    });
});

describe('tombstones (remoções propagam)', () => {
    const NOW = Date.parse('2026-07-05T12:00:00Z');
    const tombKey = 'neostream_sync_tombstones';

    it('tombstone remoto remove item local mesmo com arrays idênticos', () => {
        const list = JSON.stringify([fav('a', '2026-01-01'), fav('b', '2026-01-01')]);
        const result = mergeSyncData(
            { 'neostream_watchlater_p1': list },
            {
                'neostream_watchlater_p1': list,
                [tombKey]: JSON.stringify({ 'neostream_watchlater_p1': { 'a::movie': NOW - 1000 } }),
            },
            NOW,
        );
        const merged = JSON.parse(result.changed['neostream_watchlater_p1']);
        expect(merged.map((i: { id: string }) => i.id)).toEqual(['b']);
        expect(result.removedItems).toBe(1);
        expect(result.changed[tombKey]).toContain('a::movie');
    });

    it('re-adicionar depois da remoção sobrevive (addedAt mais novo que o tombstone)', () => {
        const deletedAt = Date.parse('2026-03-01T00:00:00Z');
        const local = JSON.stringify([fav('a', '2026-04-01')]); // re-adicionado depois
        const result = mergeSyncData(
            { 'neostream_watchlater_p1': local },
            {
                'neostream_watchlater_p1': JSON.stringify([]),
                [tombKey]: JSON.stringify({ 'neostream_watchlater_p1': { 'a::movie': deletedAt } }),
            },
            NOW,
        );
        expect(result.changed['neostream_watchlater_p1']).toBeUndefined();
        expect(result.removedItems).toBe(0);
    });

    it('tombstone local barra item remoto (não volta do outro lado)', () => {
        const result = mergeSyncData(
            {
                'neostream_watchlater_p1': JSON.stringify([]),
                [tombKey]: JSON.stringify({ 'neostream_watchlater_p1': { 'x::movie': NOW - 5000 } }),
            },
            { 'neostream_watchlater_p1': JSON.stringify([fav('x', '2026-01-01')]) },
            NOW,
        );
        expect(result.changed['neostream_watchlater_p1']).toBeUndefined();
        expect(result.addedItems).toBe(0);
    });

    it('tombstones expiram depois de 30 dias', () => {
        const old = NOW - 31 * 24 * 3600_000;
        const result = mergeSyncData(
            { 'neostream_watchlater_p1': JSON.stringify([fav('a', '2026-01-01')]) },
            {
                'neostream_watchlater_p1': JSON.stringify([fav('a', '2026-01-01')]),
                [tombKey]: JSON.stringify({ 'neostream_watchlater_p1': { 'a::movie': old } }),
            },
            NOW,
        );
        // Expirado: nada removido, ledger mesclado vira vazio.
        expect(result.removedItems).toBe(0);
        expect(result.changed['neostream_watchlater_p1']).toBeUndefined();
    });

    it('favoritos dentro do objeto de perfil também respeitam o ledger', () => {
        const profileKey = 'neostream_profile_p1__pl_x';
        const local = JSON.stringify({ favorites: [fav('f1'), fav('f2')], other: 1 });
        const result = mergeSyncData(
            { [profileKey]: local },
            {
                [profileKey]: local,
                [tombKey]: JSON.stringify({ [profileKey]: { 'f1::movie': NOW - 100 } }),
            },
            NOW,
        );
        const merged = JSON.parse(result.changed[profileKey]);
        expect(merged.favorites.map((f: { id: string }) => f.id)).toEqual(['f2']);
        expect(merged.other).toBe(1);
    });

    it('ledger sem a chave no remoto ainda aplica a remoção local', () => {
        const result = mergeSyncData(
            {
                'neostream_watchlater_p1': JSON.stringify([fav('a', '2026-01-01')]),
            },
            {
                [tombKey]: JSON.stringify({ 'neostream_watchlater_p1': { 'a::movie': NOW - 100 } }),
            },
            NOW,
        );
        expect(JSON.parse(result.changed['neostream_watchlater_p1'])).toEqual([]);
        expect(result.removedItems).toBe(1);
    });
});
