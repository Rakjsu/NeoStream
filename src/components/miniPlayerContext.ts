import { createContext, useContext } from 'react';

export interface MiniPlayerContent {
    src: string;
    title: string;
    poster?: string;
    contentId?: string;
    contentType?: 'movie' | 'series' | 'live';
    currentTime?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    onExpand?: (currentTime: number) => void;
}

export interface MiniPlayerContextType {
    isActive: boolean;
    content: MiniPlayerContent | null;
    startMiniPlayer: (content: MiniPlayerContent) => void;
    stopMiniPlayer: () => void;
    getCurrentTime: () => number;
}

export const MiniPlayerContext = createContext<MiniPlayerContextType | null>(null);

export function useMiniPlayer() {
    const context = useContext(MiniPlayerContext);
    if (!context) {
        throw new Error('useMiniPlayer must be used within MiniPlayerProvider');
    }
    return context;
}
