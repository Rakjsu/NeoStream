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
        `${base}_${profileId}__pl_${playlistId}`
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
