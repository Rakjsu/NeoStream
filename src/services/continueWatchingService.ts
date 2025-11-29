import { ContinueWatchingItem } from '../types/profile';
import { profileService } from './profileService';

const CLEANUP_DAYS = 7; // Remove completed items after 7 days
const COMPLETION_THRESHOLD = 95; // Consider >= 95% as completed

export const continueWatchingService = {
    // Update or add item to Continue Watching
    updateProgress(item: Omit<ContinueWatchingItem, 'lastWatched'>): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        const now = new Date().toISOString();
        const existingIndex = activeProfile.continueWatching.findIndex(
            cw => cw.id === item.id && cw.type === item.type
        );

        const continueItem: ContinueWatchingItem = {
            ...item,
            lastWatched: now
        };

        if (existingIndex >= 0) {
            // Update existing
            activeProfile.continueWatching[existingIndex] = continueItem;
        } else {
            // Add new (keep max 20 items)
            activeProfile.continueWatching.unshift(continueItem);
            if (activeProfile.continueWatching.length > 20) {
                activeProfile.continueWatching = activeProfile.continueWatching.slice(0, 20);
            }
        }

        // Update profile in storage
        this.saveProfile(activeProfile);
    },

    // Get all Continue Watching items for active profile
    getAll(): ContinueWatchingItem[] {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return [];

        // Sort by lastWatched (most recent first)
        return [...activeProfile.continueWatching].sort((a, b) =>
            new Date(b.lastWatched).getTime() - new Date(a.lastWatched).getTime()
        );
    },

    // Remove item from Continue Watching
    remove(id: string, type: 'movie' | 'series'): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        activeProfile.continueWatching = activeProfile.continueWatching.filter(
            item => !(item.id === id && item.type === type)
        );

        this.saveProfile(activeProfile);
    },

    // Clean up completed and old items
    cleanup(): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        const now = new Date();
        const cleanupDate = new Date(now.getTime() - CLEANUP_DAYS * 24 * 60 * 60 * 1000);

        activeProfile.continueWatching = activeProfile.continueWatching.filter(item => {
            // Remove if completed and older than CLEANUP_DAYS
            if (item.progress >= COMPLETION_THRESHOLD) {
                const lastWatched = new Date(item.lastWatched);
                return lastWatched > cleanupDate;
            }
            return true;
        });

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
