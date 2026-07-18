// Watch Later localStorage utility (adapted for profiles, per-playlist scoped)
import { profileService } from './profileService';
import { playlistScopedKey, hasKnownPlaylistId } from './activePlaylistService';
import { syncTombstones, tombstoneItemKey } from './syncTombstones';
import type { Profile, WatchLaterItem } from '../types/profile';

// Re-export type for compatibility
export type { WatchLaterItem };

// localStorage key base. Per-profile per-playlist key is
// `neostream_watchlater_${profileId}__pl_${activePlaylistId}` and stores the
// WatchLaterItem[] array. The legacy location is the active profile's
// `watchLater` field inside `neostream_profiles`, which migrate() drains once.
const KEY_BASE = 'neostream_watchlater';

export const watchLaterService = {
    // Get all watch later items for active profile (current playlist scope)
    getAll(): WatchLaterItem[] {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return [];

        this.migrate();
        try {
            const key = playlistScopedKey(KEY_BASE, activeProfile.id);
            const data = localStorage.getItem(key);
            return data ? (JSON.parse(data) as WatchLaterItem[]) : [];
        } catch {
            return [];
        }
    },

    // Add item to watch later
    add(item: Omit<WatchLaterItem, 'addedAt'>): boolean {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return false;

        try {
            const items = this.getAll();

            // Check if already exists
            if (items.some(i => i.id === item.id && i.type === item.type)) {
                return false; // Already in list
            }

            const watchLaterItem: WatchLaterItem = {
                ...item,
                addedAt: new Date().toISOString()
            };

            items.push(watchLaterItem);
            this.save(activeProfile, items);
            return true;
        } catch (error) {
            console.error('Error adding to watch later:', error);
            return false;
        }
    },

    /** 🖐️ Reordena a lista (drag-n-drop): move fromIndex pra toIndex. */
    reorder(fromIndex: number, toIndex: number): WatchLaterItem[] {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return this.getAll();
        const items = this.getAll();
        if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) {
            return items;
        }
        const [moved] = items.splice(fromIndex, 1);
        items.splice(toIndex, 0, moved);
        this.save(activeProfile, items);
        return items;
    },

    // Remove item from watch later
    remove(id: string, type: 'series' | 'movie'): boolean {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return false;

        try {
            const items = this.getAll().filter(
                i => !(i.id === id && i.type === type)
            );
            this.save(activeProfile, items);
            // Deletions ledger so the machine sync propagates the removal.
            syncTombstones.record(playlistScopedKey(KEY_BASE, activeProfile.id), tombstoneItemKey(id, type));
            return true;
        } catch (error) {
            console.error('Error removing from watch later:', error);
            return false;
        }
    },

    // Check if item is in watch later
    has(id: string, type: 'series' | 'movie'): boolean {
        const items = this.getAll();
        return items.some(i => i.id === id && i.type === type);
    },

    // Clear all from active profile (current playlist scope)
    clear(): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        this.save(activeProfile, []);
    },

    // Persist the array to the per-(profile,playlist) key.
    save(profile: Profile, items: WatchLaterItem[]): void {
        const key = playlistScopedKey(KEY_BASE, profile.id);
        localStorage.setItem(key, JSON.stringify(items));
    },

    /**
     * One-time, idempotent migration: drain the legacy per-profile `watchLater`
     * field (stored inside `neostream_profiles`) into the per-(profile,playlist)
     * key for the CURRENT active playlist (the only playlist data existed under
     * until now), then clear the legacy field so it is not migrated twice.
     * Skipped while the active playlist id is unknown ('default' race) — it
     * re-runs next access once known. Runs for the active profile on access,
     * which is sufficient since watch-later is read per active profile.
     */
    migrate(): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;
        if (!hasKnownPlaylistId()) return;

        const legacy = activeProfile.watchLater;
        if (!legacy || legacy.length === 0) return;

        const newKey = playlistScopedKey(KEY_BASE, activeProfile.id);
        if (localStorage.getItem(newKey) === null) {
            localStorage.setItem(newKey, JSON.stringify(legacy));
        }

        // Clear the legacy field in the profiles store so it isn't re-migrated.
        activeProfile.watchLater = [];
        this.saveProfile(activeProfile);
    },

    // Helper to save the profile (with cleared legacy field) back to storage.
    saveProfile(profile: Profile): void {
        const allProfiles = profileService.getAllProfiles();
        const data = {
            profiles: allProfiles.map(p => (p.id === profile.id ? profile : p)),
            activeProfileId: profile.id
        };
        localStorage.setItem('neostream_profiles', JSON.stringify(data));
    }
};
