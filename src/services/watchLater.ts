// Watch Later localStorage utility (adapted for profiles)
import { profileService } from './profileService';
import type { WatchLaterItem } from '../types/profile';

// Re-export type for compatibility
export type { WatchLaterItem };

export const watchLaterService = {
    // Get all watch later items for active profile
    getAll(): WatchLaterItem[] {
        const activeProfile = profileService.getActiveProfile();
        return activeProfile ? activeProfile.watchLater : [];
    },

    // Add item to watch later
    add(item: Omit<WatchLaterItem, 'addedAt'>): boolean {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return false;

        try {
            // Check if already exists
            if (activeProfile.watchLater.some(i => i.id === item.id && i.type === item.type)) {
                return false; // Already in list
            }

            const watchLaterItem: WatchLaterItem = {
                ...item,
                addedAt: new Date().toISOString()
            };

            activeProfile.watchLater.push(watchLaterItem);
            this.saveProfile(activeProfile);
            return true;
        } catch (error) {
            console.error('Error adding to watch later:', error);
            return false;
        }
    },

    // Remove item from watch later
    remove(id: string, type: 'series' | 'movie'): boolean {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return false;

        try {
            activeProfile.watchLater = activeProfile.watchLater.filter(
                i => !(i.id === id && i.type === type)
            );
            this.saveProfile(activeProfile);
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

    // Clear all from active profile
    clear(): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        activeProfile.watchLater = [];
        this.saveProfile(activeProfile);
    },

    // Helper to save profile back to storage
    saveProfile(profile: any): void {
        const allProfiles = profileService.getAllProfiles();
        const data = {
            profiles: allProfiles.map(p => p.id === profile.id ? profile : p),
            activeProfileId: profile.id
        };
        localStorage.setItem('neostream_profiles', JSON.stringify(data));
    }
};
