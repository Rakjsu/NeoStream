// Favorites localStorage utility (adapted for profiles)
import { profileService } from './profileService';

export interface FavoriteItem {
    id: string;
    type: 'series' | 'movie';
    title: string;
    poster: string;
    rating?: string;
    year?: string;
    addedAt: string;
    // Extra metadata
    seriesId?: number;
    streamId?: number;
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
    remove(id: string, type: 'series' | 'movie'): boolean {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return false;

        try {
            const profileData = this.getProfileData();
            const favorites = (profileData.favorites || []).filter(
                (i: FavoriteItem) => !(i.id === id && i.type === type)
            );
            this.saveProfileData({ ...profileData, favorites });
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
    has(id: string, type: 'series' | 'movie'): boolean {
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

    // Get profile data from localStorage
    getProfileData(): any {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return {};

        try {
            const key = `neostream_profile_${activeProfile.id}`;
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    },

    // Save profile data to localStorage
    saveProfileData(data: any): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        const key = `neostream_profile_${activeProfile.id}`;
        localStorage.setItem(key, JSON.stringify(data));
    }
};
