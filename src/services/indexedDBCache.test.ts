import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { indexedDBCache } from './indexedDBCache';
import { KIDS_FILTER_CACHE_TTL_MS } from './cacheExpiry';

// Fake timers só pro Date: o fake-indexeddb usa timers reais internamente.
const NOW = new Date('2026-07-06T12:00:00Z').getTime();

describe('indexedDBCache', () => {
    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        await indexedDBCache.clearAll();
    });
    afterEach(() => vi.useRealTimers());

    it('grava e lê certificação de filme com nome normalizado (caixa/pontuação)', async () => {
        await indexedDBCache.setCacheMovie('  The Movie: Reloaded!  ', '12', ['Ação']);
        const hit = await indexedDBCache.getCachedMovie('the movie reloaded');
        expect(hit).toMatchObject({ certification: '12', genres: ['Ação'] });
        expect(await indexedDBCache.getCachedMovie('outro filme')).toBeNull();
    });

    it('entrada expirada vira miss (e é apagada na leitura)', async () => {
        // Grava no passado, além do TTL.
        vi.setSystemTime(NOW - KIDS_FILTER_CACHE_TTL_MS - 1000);
        await indexedDBCache.setCacheMovie('Velho', 'L', []);
        vi.setSystemTime(NOW);

        expect(await indexedDBCache.getCachedMovie('Velho')).toBeNull();
        // A leitura removeu a entrada — o bulk map não a inclui.
        const all = await indexedDBCache.getAllCachedMovies();
        expect(all.has('velho')).toBe(false);
    });

    it('stores de filme e série são independentes', async () => {
        await indexedDBCache.setCacheMovie('Nome Igual', '16', []);
        await indexedDBCache.setCacheSeries('Nome Igual', 'L', []);
        expect((await indexedDBCache.getCachedMovie('Nome Igual'))?.certification).toBe('16');
        expect((await indexedDBCache.getCachedSeries('Nome Igual'))?.certification).toBe('L');
    });

    it('hidden items: esconde, consulta e lista filtrado por tipo', async () => {
        await indexedDBCache.hideItem('movie', 'Filme Adulto');
        await indexedDBCache.hideItem('series', 'Série Adulta');

        expect(await indexedDBCache.isItemHidden('movie', 'filme adulto')).toBe(true);
        expect(await indexedDBCache.isItemHidden('series', 'Filme Adulto')).toBe(false);
        expect(await indexedDBCache.getHiddenItems('movie')).toEqual(['filme adulto']);
        // A normalização descarta caracteres não a-z0-9 (acentos inclusos).
        expect(await indexedDBCache.getHiddenItems('series')).toEqual(['srie adulta']);
    });

    it('cleanupExpired varre os dois stores e conta as remoções', async () => {
        vi.setSystemTime(NOW - KIDS_FILTER_CACHE_TTL_MS - 1000);
        await indexedDBCache.setCacheMovie('Filme Velho', 'L', []);
        await indexedDBCache.setCacheSeries('Série Velha', 'L', []);
        vi.setSystemTime(NOW);
        await indexedDBCache.setCacheMovie('Filme Novo', '12', []);
        await indexedDBCache.setCacheSeries('Série Nova', '14', []);

        const removed = await indexedDBCache.cleanupExpired();
        expect(removed).toBe(2);
        expect((await indexedDBCache.getAllCachedMovies()).has('filme novo')).toBe(true);
        expect((await indexedDBCache.getAllCachedMovies()).has('filme velho')).toBe(false);
        expect((await indexedDBCache.getAllCachedSeries()).has('srie nova')).toBe(true);
    });

    it('getAllCachedMovies devolve o mapa nome→certificação das entradas frescas', async () => {
        await indexedDBCache.setCacheMovie('Um', 'L', []);
        await indexedDBCache.setCacheMovie('Dois', null, []);
        const all = await indexedDBCache.getAllCachedMovies();
        expect(all.get('um')).toBe('L');
        expect(all.get('dois')).toBeNull();
        expect(all.size).toBe(2);
    });
});
