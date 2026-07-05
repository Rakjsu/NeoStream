// Favorites localStorage utility (adapted for profiles)
import { profileService } from './profileService';
import { playlistScopedKey, hasKnownPlaylistId } from './activePlaylistService';
import { syncTombstones, tombstoneItemKey } from './syncTombstones';

// localStorage key base. Per-profile per-playlist key is
// `neostream_profile_${profileId}__pl_${activePlaylistId}`; the legacy
// per-profile-only key `neostream_profile_${profileId}` is the migration source.
const KEY_BASE = 'neostream_profile';

export type FavoriteType = 'series' | 'movie' | 'channel';

export interface FavoriteItem {
    id: string;
    type: FavoriteType;
    title: string;
    poster: string;
    rating?: string;
    year?: string;
    addedAt: string;
    // Extra metadata
    seriesId?: number;
    streamId?: number;
}

interface FavoriteProfileData {
    favorites?: FavoriteItem[];
}

export const favoritesService = {
    // Get all favorites for active profile
    getAll(): FavoriteItem[] {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return [];

        // Get favorites from profile or initialize empty array
        const profileData = this.getProfileData();
        return profileData.favorites || [];
    },

    // Add item to favorites
    add(item: Omit<FavoriteItem, 'addedAt'>): boolean {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return false;

        try {
            const profileData = this.getProfileData();
            const favorites = profileData.favorites || [];

            // Check if already exists
            if (favorites.some((i: FavoriteItem) => i.id === item.id && i.type === item.type)) {
                return false; // Already in favorites
            }

            const favoriteItem: FavoriteItem = {
                ...item,
                addedAt: new Date().toISOString()
            };

            favorites.push(favoriteItem);
            this.saveProfileData({ ...profileData, favorites });
            return true;
        } catch (error) {
            console.error('Error adding to favorites:', error);
            return false;
        }
    },

    // Remove item from favorites
    remove(id: string, type: FavoriteType): boolean {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return false;

        try {
            const profileData = this.getProfileData();
            const favorites = (profileData.favorites || []).filter(
                (i: FavoriteItem) => !(i.id === id && i.type === type)
            );
            this.saveProfileData({ ...profileData, favorites });
            // Deletions ledger so the machine sync propagates the removal.
            syncTombstones.record(playlistScopedKey(KEY_BASE, activeProfile.id), tombstoneItemKey(id, type));
            return true;
        } catch (error) {
            console.error('Error removing from favorites:', error);
            return false;
        }
    },

    // Toggle favorite status
    toggle(item: Omit<FavoriteItem, 'addedAt'>): boolean {
        if (this.has(item.id, item.type)) {
            this.remove(item.id, item.type);
            return false; // Now NOT favorite
        } else {
            this.add(item);
            return true; // Now IS favorite
        }
    },

    // Check if item is in favorites
    has(id: string, type: FavoriteType): boolean {
        const favorites = this.getAll();
        return favorites.some(i => i.id === id && i.type === type);
    },

    // Clear all favorites
    clear(): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        const profileData = this.getProfileData();
        this.saveProfileData({ ...profileData, favorites: [] });
    },

    // Get profile data from localStorage (per-profile per-playlist key)
    getProfileData(): FavoriteProfileData {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return {};

        this.migrate();
        try {
            const key = playlistScopedKey(KEY_BASE, activeProfile.id);
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) as FavoriteProfileData : {};
        } catch {
            return {};
        }
    },

    // Save profile data to localStorage (per-profile per-playlist key)
    saveProfileData(data: FavoriteProfileData): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        const key = playlistScopedKey(KEY_BASE, activeProfile.id);
        localStorage.setItem(key, JSON.stringify(data));
    },

    /**
     * One-time, idempotent migration: copy the legacy per-profile-only key
     * `neostream_profile_${profileId}` into the per-(profile,playlist) key for
     * the CURRENT active playlist (the only playlist data existed under until
     * now), then remove the old key. Skipped while the active playlist id is
     * unknown ('default' race) — it re-runs next access once known.
     */
    migrate(): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;
        if (!hasKnownPlaylistId()) return;

        const oldKey = `${KEY_BASE}_${activeProfile.id}`;
        const old = localStorage.getItem(oldKey);
        if (old === null) return;

        const newKey = playlistScopedKey(KEY_BASE, activeProfile.id);
        if (localStorage.getItem(newKey) === null) {
            localStorage.setItem(newKey, old);
        }
        localStorage.removeItem(oldKey);
    }
};
