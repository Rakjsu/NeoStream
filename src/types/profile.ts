export interface ContinueWatchingItem {
    id: string;
    type: 'movie' | 'series';
    name: string;
    cover: string;
    progress: number; // 0-100 percentage
    timestamp: number; // Position in seconds
    duration: number; // Total duration in seconds
    lastWatched: string; // ISO date string
    // For series only:
    seasonNumber?: number;
    episodeNumber?: number;
    episodeTitle?: string;
}

export interface WatchLaterItem {
    id: string;
    type: 'movie' | 'series';
    name: string;
    cover: string;
    addedAt: string; // ISO date string
}

export interface Profile {
    id: string;
    name: string;
    avatar: string; // Base64 image data or emoji
    pin?: string; // SHA-256 hash (optional)
    isKids?: boolean; // Kids profile with content filtering
    isGuest?: boolean; // Temporary guest profile — data wiped when the session ends
    preferredQuality?: '4k' | 'fhd' | 'hd' | 'sd' | 'auto'; // Preferred quality for live TV
    /** Theme accent preset id (themeService AccentId) applied when this profile activates. */
    accentColor?: string;
    watchLater: WatchLaterItem[];
    continueWatching: ContinueWatchingItem[];
    createdAt: string; // ISO date string
    lastUsed: string; // ISO date string
}

export interface ProfilesData {
    profiles: Profile[];
    activeProfileId: string | null;
}

export interface CreateProfileData {
    name: string;
    avatar: string;
    pin?: string; // Plain text, will be hashed
    isKids?: boolean;
    accentColor?: string;
}

export interface UpdateProfileData {
    name?: string;
    avatar?: string;
    pin?: string | null; // null to remove PIN
    isKids?: boolean;
    preferredQuality?: '4k' | 'fhd' | 'hd' | 'sd' | 'auto';
    accentColor?: string;
}
