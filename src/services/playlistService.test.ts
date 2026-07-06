import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playlistService } from './playlistService';

function mockIpc(handlers: Record<string, (payload?: unknown) => unknown>) {
    const invoke = vi.fn((channel: string, payload?: unknown) => {
        const h = handlers[channel];
        return Promise.resolve(h ? h(payload) : { success: false });
    });
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke };
    return invoke;
}

describe('playlistService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    describe('list', () => {
        it('devolve as playlists quando o main responde ok', async () => {
            const playlists = [
                { id: 'p1', name: 'Casa', url: 'http://x', username: 'u', active: true, type: 'xtream' as const },
            ];
            mockIpc({ 'playlists:list': () => ({ success: true, playlists }) });
            expect(await playlistService.list()).toEqual(playlists);
        });

        it('falha ou shape inesperado → lista vazia', async () => {
            mockIpc({ 'playlists:list': () => ({ success: false }) });
            expect(await playlistService.list()).toEqual([]);
            mockIpc({ 'playlists:list': () => ({ success: true, playlists: 'nope' }) });
            expect(await playlistService.list()).toEqual([]);
        });
    });

    it('add/switch/remove/rename repassam o payload pro canal certo', async () => {
        const invoke = mockIpc({
            'playlists:add': () => ({ success: true }),
            'playlists:switch': () => ({ success: true }),
            'playlists:remove': () => ({ success: true, loggedOut: true }),
            'playlists:rename': () => ({ success: true }),
        });
        await playlistService.add({ name: 'N', url: 'http://x', username: 'u', password: 'p' });
        await playlistService.switchTo('p1');
        const removed = await playlistService.remove('p1');
        await playlistService.rename('p2', 'Novo');

        expect(invoke).toHaveBeenCalledWith('playlists:add', { name: 'N', url: 'http://x', username: 'u', password: 'p' });
        expect(invoke).toHaveBeenCalledWith('playlists:switch', { id: 'p1' });
        expect(invoke).toHaveBeenCalledWith('playlists:rename', { id: 'p2', name: 'Novo' });
        expect(removed.loggedOut).toBe(true);
    });

    it('clearProviderCaches remove só os caches derivados do provedor', () => {
        localStorage.setItem('contentLastFetch', '123');
        localStorage.setItem('epg_test_results', '{}');
        localStorage.setItem('neostream_profiles', '{"keep":1}');
        playlistService.clearProviderCaches();
        expect(localStorage.getItem('contentLastFetch')).toBeNull();
        expect(localStorage.getItem('epg_test_results')).toBeNull();
        expect(localStorage.getItem('neostream_profiles')).toBe('{"keep":1}');
    });
});
