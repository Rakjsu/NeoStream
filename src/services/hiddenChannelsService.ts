// 🙈 Hidden channels: stream ids the user never wants in the Live TV list
// (right-click on a channel card toggles). Persisted per profile per playlist,
// the same scoping favorites use.
import { profileService } from './profileService';
import { playlistScopedKey } from './activePlaylistService';

const KEY_BASE = 'neostream_hidden_channels';

function storageKey(): string | null {
    const activeProfile = profileService.getActiveProfile();
    if (!activeProfile) return null;
    return playlistScopedKey(KEY_BASE, activeProfile.id);
}

export const hiddenChannelsService = {
    getAll(): Set<string> {
        const key = storageKey();
        if (!key) return new Set();
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]');
            return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
        } catch {
            return new Set();
        }
    },

    /** Toggles one channel id and returns the NEW set (handy for setState). */
    toggle(channelId: string): Set<string> {
        const ids = this.getAll();
        if (ids.has(channelId)) ids.delete(channelId);
        else ids.add(channelId);
        const key = storageKey();
        if (key) localStorage.setItem(key, JSON.stringify([...ids]));
        return ids;
    },

    isHidden(channelId: string): boolean {
        return this.getAll().has(channelId);
    }
};
