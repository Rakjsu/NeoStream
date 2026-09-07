import { describe, it, expect, beforeEach, vi } from 'vitest';

let activeId: string | null = 'p1';
vi.mock('./profileService', () => ({
    profileService: {
        getActiveProfile: () => (activeId ? { id: activeId } : null)
    }
}));

let playlistId = 'plA';
vi.mock('./activePlaylistService', () => ({
    getActivePlaylistId: () => playlistId,
    hasKnownPlaylistId: () => playlistId !== 'default',
    playlistScopedKey: (base: string, profileId: string) =>
        `${base}_${profileId}__pl_${playlistId}`,
    playlistScopedKeyFor: (base: string, profileId: string, pl: string) =>
        `${base}_${profileId}__pl_${pl}`
}));

import { favoritesService } from './favoritesService';

const fav = (id: string) => ({
    id, type: 'movie' as const, title: 'T', poster: 'p'
});

describe('favoritesService — per-playlist scoping', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('a favorite added under playlist A is not present under B; present again under A', () => {
        playlistId = 'plA';
        expect(favoritesService.add(fav('m1'))).toBe(true);
        expect(favoritesService.has('m1', 'movie')).toBe(true);

        playlistId = 'plB';
        expect(favoritesService.has('m1', 'movie')).toBe(false);
        expect(favoritesService.getAll()).toEqual([]);

        playlistId = 'plA';
        expect(favoritesService.has('m1', 'movie')).toBe(true);
        expect(localStorage.getItem('neostream_profile_p1__pl_plA')).toBeTruthy();
        expect(localStorage.getItem('neostream_profile_p1__pl_plB')).toBeNull();
    });

    it('isolates favorites across profiles too', () => {
        activeId = 'p1';
        favoritesService.add(fav('m1'));
        activeId = 'p2';
        expect(favoritesService.has('m1', 'movie')).toBe(false);
    });
});

describe('favoritesService — per-profile → per-playlist migration', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('copies the legacy per-profile key into the active playlist scope, then removes it', () => {
        localStorage.setItem('neostream_profile_p1', JSON.stringify({ favorites: [{ ...fav('m1'), addedAt: 'x' }] }));

        // Any access migrates.
        expect(favoritesService.has('m1', 'movie')).toBe(true);

        expect(localStorage.getItem('neostream_profile_p1')).toBeNull();
        const scoped = JSON.parse(localStorage.getItem('neostream_profile_p1__pl_plA')!);
        expect(scoped.favorites.map((f: { id: string }) => f.id)).toEqual(['m1']);
    });

    it('is idempotent and does not clobber existing scoped favorites', () => {
        localStorage.setItem('neostream_profile_p1__pl_plA', JSON.stringify({ favorites: [{ ...fav('keep'), addedAt: 'x' }] }));
        localStorage.setItem('neostream_profile_p1', JSON.stringify({ favorites: [{ ...fav('old'), addedAt: 'x' }] }));

        favoritesService.getAll(); // migrate
        favoritesService.getAll(); // no-op

        expect(localStorage.getItem('neostream_profile_p1')).toBeNull();
        const scoped = JSON.parse(localStorage.getItem('neostream_profile_p1__pl_plA')!);
        expect(scoped.favorites.map((f: { id: string }) => f.id)).toEqual(['keep']);
    });

    it('is skipped while the active playlist id is unknown (default fallback)', () => {
        playlistId = 'default';
        localStorage.setItem('neostream_profile_p1', JSON.stringify({ favorites: [{ ...fav('m1'), addedAt: 'x' }] }));

        favoritesService.getAll();

        expect(localStorage.getItem('neostream_profile_p1')).toBeTruthy();
        expect(localStorage.getItem('neostream_profile_p1__pl_default')).toBeNull();
    });
});

describe('favoritesService — leitura de outra playlist e gravação em lote', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('getAllFromPlaylist lê a lista velha sem trocar a ativa', () => {
        // O caso do transferidor: o usuário cadastrou plB e quer os favoritos
        // que ficaram presos em plA.
        playlistId = 'plA';
        favoritesService.add(fav('m1'));
        favoritesService.add({ ...fav('s9'), type: 'series' });

        playlistId = 'plB';
        expect(favoritesService.getAll()).toEqual([]);
        expect(favoritesService.getAllFromPlaylist('plA').map(f => f.id)).toEqual(['m1', 's9']);
        // Ler não pode mexer em nada.
        expect(favoritesService.getAll()).toEqual([]);
    });

    it('getAllFromPlaylist com playlist inexistente ou vazia devolve lista vazia', () => {
        expect(favoritesService.getAllFromPlaylist('nao-existe')).toEqual([]);
        expect(favoritesService.getAllFromPlaylist('')).toEqual([]);
    });

    it('getAllFromPlaylist respeita o perfil ativo', () => {
        activeId = 'p1';
        playlistId = 'plA';
        favoritesService.add(fav('m1'));
        activeId = 'p2';
        expect(favoritesService.getAllFromPlaylist('plA')).toEqual([]);
    });

    it('addMany grava em lote, preserva o addedAt e pula os repetidos', () => {
        const antigo = '2020-05-05T10:00:00.000Z';
        const entraram = favoritesService.addMany([
            { ...fav('m1'), addedAt: antigo },
            { ...fav('m2'), addedAt: antigo },
        ]);
        expect(entraram).toBe(2);
        expect(favoritesService.getAll().map(f => f.addedAt)).toEqual([antigo, antigo]);

        // m1 repetido + m3 novo: só o novo entra.
        expect(favoritesService.addMany([
            { ...fav('m1'), addedAt: antigo },
            { ...fav('m3'), addedAt: antigo },
        ])).toBe(1);
        expect(favoritesService.getAll().map(f => f.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('addMany não conta duas vezes um id repetido DENTRO do lote', () => {
        expect(favoritesService.addMany([
            { ...fav('m1'), addedAt: 'x' },
            { ...fav('m1'), addedAt: 'x' },
        ])).toBe(1);
        expect(favoritesService.getAll()).toHaveLength(1);
    });

    it('addMany com lista vazia não grava nada', () => {
        expect(favoritesService.addMany([])).toBe(0);
        expect(localStorage.getItem('neostream_profile_p1__pl_plA')).toBeNull();
    });

    it('o mesmo id em tipos diferentes não colide', () => {
        expect(favoritesService.addMany([
            { ...fav('7'), type: 'movie', addedAt: 'x' },
            { ...fav('7'), type: 'series', addedAt: 'x' },
        ])).toBe(2);
    });
});
