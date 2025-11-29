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
}

export interface UpdateProfileData {
    name?: string;
    avatar?: string;
    pin?: string | null; // null to remove PIN
}
