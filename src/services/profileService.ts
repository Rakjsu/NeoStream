import type { Profile, ProfilesData, CreateProfileData, UpdateProfileData } from '../types/profile';

const STORAGE_KEY = 'neostream_profiles';
const MAX_PROFILES = 5;

// Simple SHA-256 hash (for demo - in production use a proper crypto library)
async function hashPin(pin: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Get all data from storage
function getStorageData(): ProfilesData {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) {
            return { profiles: [], activeProfileId: null };
        }
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading profiles from storage:', error);
        return { profiles: [], activeProfileId: null };
    }
}

// Save data to storage
function saveStorageData(data: ProfilesData): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error('Error saving profiles to storage:', error);
    }
}

// Generate unique ID
function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export const profileService = {
    // Get all profiles
    getAllProfiles(): Profile[] {
        const data = getStorageData();
        return data.profiles;
    },

    // Get active profile
    getActiveProfile(): Profile | null {
        const data = getStorageData();
        if (!data.activeProfileId) return null;
        return data.profiles.find(p => p.id === data.activeProfileId) || null;
    },

    // Set active profile
    setActiveProfile(profileId: string): boolean {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        if (!profile) return false;

        data.activeProfileId = profileId;
        profile.lastUsed = new Date().toISOString();
        saveStorageData(data);
        return true;
    },

    // Create new profile
    async createProfile(profileData: CreateProfileData): Promise<Profile | null> {
        const data = getStorageData();

        // Check limit
        if (data.profiles.length >= MAX_PROFILES) {
            console.error(`Cannot create profile: maximum of ${MAX_PROFILES} profiles reached`);
            return null;
        }

        // Validate name
        if (!profileData.name || profileData.name.trim().length === 0) {
            console.error('Profile name is required');
            return null;
        }

        if (profileData.name.length > 20) {
            console.error('Profile name must be 20 characters or less');
            return null;
        }

        const now = new Date().toISOString();
        const newProfile: Profile = {
            id: generateId(),
            name: profileData.name.trim(),
            avatar: profileData.avatar,
            pin: profileData.pin ? await hashPin(profileData.pin) : undefined,
            watchLater: [],
            continueWatching: [],
            createdAt: now,
            lastUsed: now
        };

        data.profiles.push(newProfile);

        // If this is the first profile, set it as active
        if (data.profiles.length === 1) {
            data.activeProfileId = newProfile.id;
        }

        saveStorageData(data);
        return newProfile;
    },

    // Update profile
    async updateProfile(profileId: string, updates: UpdateProfileData): Promise<boolean> {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        if (!profile) return false;

        if (updates.name !== undefined) {
            if (updates.name.trim().length === 0 || updates.name.length > 20) {
                console.error('Invalid profile name');
                return false;
            }
            profile.name = updates.name.trim();
        }

        if (updates.avatar !== undefined) {
            profile.avatar = updates.avatar;
        }

        if (updates.pin !== undefined) {
            if (updates.pin === null) {
                // Remove PIN
                delete profile.pin;
            } else {
                // Set or update PIN
                profile.pin = await hashPin(updates.pin);
            }
        }

        saveStorageData(data);
        return true;
    },

    // Delete profile
    deleteProfile(profileId: string): boolean {
        const data = getStorageData();

        // Cannot delete active profile
        if (data.activeProfileId === profileId) {
            console.error('Cannot delete active profile');
            return false;
        }

        const index = data.profiles.findIndex(p => p.id === profileId);
        if (index === -1) return false;

        data.profiles.splice(index, 1);
        saveStorageData(data);
        return true;
    },

    // Verify PIN
    async verifyPin(profileId: string, pin: string): Promise<boolean> {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        if (!profile) return false;

        // No PIN set
        if (!profile.pin) return true;

        const hashedPin = await hashPin(pin);
        return hashedPin === profile.pin;
    },

    // Check if profile has PIN
    hasPin(profileId: string): boolean {
        const data = getStorageData();
        const profile = data.profiles.find(p => p.id === profileId);
        return profile ? !!profile.pin : false;
    },

    // Migrate existing Watch Later data to default profile
    migrateExistingData(): void {
        const data = getStorageData();

        // Only migrate if no profiles exist
        if (data.profiles.length > 0) return;

        try {
            // Check for old Watch Later data
            const oldWatchLater = localStorage.getItem('watchLater');
            if (oldWatchLater) {
                const items = JSON.parse(oldWatchLater);

                // Create default profile with old data
                const now = new Date().toISOString();
                const defaultProfile: Profile = {
                    id: 'default',
                    name: 'Default',
                    avatar: '👤',
                    watchLater: items,
                    continueWatching: [],
                    createdAt: now,
                    lastUsed: now
                };

                data.profiles.push(defaultProfile);
                data.activeProfileId = 'default';
                saveStorageData(data);

                // Remove old data
                localStorage.removeItem('watchLater');
                console.log('Migrated existing Watch Later data to Default profile');
            }
        } catch (error) {
            console.error('Error migrating existing data:', error);
        }
    },

    // Initialize (call on app start)
    initialize(): void {
        this.migrateExistingData();

        const data = getStorageData();

        // If no profiles exist, create a default one
        if (data.profiles.length === 0) {
            this.createProfile({
                name: 'Default',
                avatar: '👤'
            });
        }
    }
};
