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

import { hiddenChannelsService } from './hiddenChannelsService';

describe('hiddenChannelsService', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('toggle hides, toggle again unhides, and persists', () => {
        expect(hiddenChannelsService.isHidden('42')).toBe(false);

        const afterHide = hiddenChannelsService.toggle('42');
        expect(afterHide.has('42')).toBe(true);
        expect(hiddenChannelsService.isHidden('42')).toBe(true);
        expect(localStorage.getItem('neostream_hidden_channels_p1__pl_plA')).toBe('["42"]');

        const afterUnhide = hiddenChannelsService.toggle('42');
        expect(afterUnhide.has('42')).toBe(false);
        expect(hiddenChannelsService.isHidden('42')).toBe(false);
    });

    it('is scoped per profile and per playlist', () => {
        hiddenChannelsService.toggle('7');
        expect(hiddenChannelsService.isHidden('7')).toBe(true);

        playlistId = 'plB';
        expect(hiddenChannelsService.isHidden('7')).toBe(false);

        playlistId = 'plA';
        activeId = 'p2';
        expect(hiddenChannelsService.isHidden('7')).toBe(false);

        activeId = 'p1';
        expect(hiddenChannelsService.isHidden('7')).toBe(true);
    });

    it('no active profile → empty set and toggle is a safe no-op', () => {
        activeId = null;
        expect(hiddenChannelsService.getAll().size).toBe(0);
        expect(() => hiddenChannelsService.toggle('1')).not.toThrow();
        expect(localStorage.length).toBe(0);
    });

    it('corrupted storage falls back to empty', () => {
        localStorage.setItem('neostream_hidden_channels_p1__pl_plA', '{nope');
        expect(hiddenChannelsService.getAll().size).toBe(0);
    });
});
