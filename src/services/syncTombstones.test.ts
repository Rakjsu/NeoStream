import { describe, it, expect, beforeEach } from 'vitest';
import {
    tombstoneItemKey,
    pruneTombstones,
    syncTombstones,
    TOMBSTONES_KEY,
    TOMBSTONE_TTL_MS,
    type TombstoneMap,
} from './syncTombstones';

describe('tombstoneItemKey', () => {
    it('monta "id::type" (mesma chave do syncMerge)', () => {
        expect(tombstoneItemKey(42, 'movie')).toBe('42::movie');
        expect(tombstoneItemKey('abc', 'series')).toBe('abc::series');
    });

    it('sem type → sufixo vazio', () => {
        expect(tombstoneItemKey(7)).toBe('7::');
    });
});

describe('pruneTombstones', () => {
    const now = 1_750_000_000_000;

    it('mantém entradas dentro do TTL e descarta as expiradas', () => {
        const map: TombstoneMap = {
            favorites: {
                'a::movie': now - 1000, // fresca
                'b::movie': now - TOMBSTONE_TTL_MS - 1, // expirada
            },
        };
        expect(pruneTombstones(map, now)).toEqual({
            favorites: { 'a::movie': now - 1000 },
        });
    });

    it('storageKey que fica vazio some do mapa', () => {
        const map: TombstoneMap = {
            watchLater: { 'x::': now - TOMBSTONE_TTL_MS - 1 },
        };
        expect(pruneTombstones(map, now)).toEqual({});
    });

    it('valores malformados (não-objeto / não-número) são ignorados sem quebrar', () => {
        const map = {
            ok: { 'a::': now },
            weird: null,
            alsoWeird: 'string',
            badValues: { 'b::': 'not-a-number' },
        } as unknown as TombstoneMap;
        expect(pruneTombstones(map, now)).toEqual({ ok: { 'a::': now } });
    });
});

describe('syncTombstones.record', () => {
    beforeEach(() => localStorage.clear());

    it('grava a remoção no ledger com o timestamp atual', () => {
        const before = Date.now();
        syncTombstones.record('favorites', tombstoneItemKey(9, 'movie'));
        const stored = JSON.parse(localStorage.getItem(TOMBSTONES_KEY)!) as TombstoneMap;
        expect(stored.favorites['9::movie']).toBeGreaterThanOrEqual(before);
    });

    it('poda entradas expiradas ao gravar (ledger não cresce pra sempre)', () => {
        const stale: TombstoneMap = {
            favorites: { 'old::movie': Date.now() - TOMBSTONE_TTL_MS - 1 },
        };
        localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(stale));
        syncTombstones.record('favorites', 'new::movie');
        const stored = JSON.parse(localStorage.getItem(TOMBSTONES_KEY)!) as TombstoneMap;
        expect(stored.favorites['old::movie']).toBeUndefined();
        expect(stored.favorites['new::movie']).toBeTypeOf('number');
    });

    it('ledger corrompido no localStorage é tratado como vazio', () => {
        localStorage.setItem(TOMBSTONES_KEY, '{{{nope');
        syncTombstones.record('favorites', 'a::movie');
        const stored = JSON.parse(localStorage.getItem(TOMBSTONES_KEY)!) as TombstoneMap;
        expect(Object.keys(stored.favorites)).toEqual(['a::movie']);
    });
});
