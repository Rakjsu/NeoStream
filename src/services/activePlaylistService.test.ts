import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    init,
    getActivePlaylistId,
    hasKnownPlaylistId,
    playlistScopedKey,
} from './activePlaylistService';

const MIRROR_KEY = 'neostream_active_playlist_id';

// Reset the module-level cache between tests by re-importing fresh. Vitest
// caches modules per file, so we instead drive state through init() + the
// localStorage mirror, and ensure a clean mirror each test.
describe('activePlaylistService', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.unstubAllGlobals();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubInvoke(result: unknown) {
        vi.stubGlobal('window', {
            ipcRenderer: { invoke: vi.fn().mockResolvedValue(result) },
        });
    }

    it('init caches the id from IPC and mirrors it to localStorage', async () => {
        stubInvoke({ id: 'plX' });
        await init();
        expect(getActivePlaylistId()).toBe('plX');
        expect(localStorage.getItem(MIRROR_KEY)).toBe('plX');
        expect(hasKnownPlaylistId()).toBe(true);
    });

    it('init with null id drops the mirror and falls back to default', async () => {
        localStorage.setItem(MIRROR_KEY, 'stale');
        stubInvoke({ id: null });
        await init();
        // module var is null, mirror removed → 'default'
        expect(localStorage.getItem(MIRROR_KEY)).toBeNull();
        expect(getActivePlaylistId()).toBe('default');
        expect(hasKnownPlaylistId()).toBe(false);
    });

    it('getActivePlaylistId falls back to the localStorage mirror, then default', async () => {
        // After an init that nulls the cache, a later mirror write is still read.
        stubInvoke({ id: null });
        await init();
        localStorage.setItem(MIRROR_KEY, 'plMirror');
        expect(getActivePlaylistId()).toBe('plMirror');

        localStorage.removeItem(MIRROR_KEY);
        expect(getActivePlaylistId()).toBe('default');
    });

    it('playlistScopedKey composes base, profile, and active playlist id', async () => {
        stubInvoke({ id: 'plK' });
        await init();
        expect(playlistScopedKey('favs', 'profile7')).toBe('favs_profile7__pl_plK');
    });

    it('init tolerates IPC failure (keeps prior mirror)', async () => {
        localStorage.setItem(MIRROR_KEY, 'kept');
        vi.stubGlobal('window', {
            ipcRenderer: { invoke: vi.fn().mockRejectedValue(new Error('boom')) },
        });
        await init();
        expect(getActivePlaylistId()).toBe('kept');
    });
});
