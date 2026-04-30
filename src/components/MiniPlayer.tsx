/**
 * Mini Player Context
 * Provides a floating mini player that persists across navigation
 */

import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { usageStatsService } from '../services/usageStatsService';
import { MiniPlayerContext, type MiniPlayerContent, type MiniPlayerContextType } from './miniPlayerContext';

interface ProviderCredentials {
    url: string;
    username: string;
    password: string;
}

interface CredentialsResult {
    success: boolean;
    credentials: ProviderCredentials;
}

interface SeriesEpisode {
    id: string | number;
    episode_num: string | number;
    container_extension?: string;
}

interface SeriesInfoResponse {
    info?: {
        name?: string;
    };
    episodes?: Record<string, SeriesEpisode[]>;
}

declare global {
    interface Window {
        __miniPlayerContext?: Omit<MiniPlayerContextType, 'content'>;
    }
}

export function MiniPlayerProvider({ children }: { children: ReactNode }) {
    const [isActive, setIsActive] = useState(false);
    const [content, setContent] = useState<MiniPlayerContent | null>(null);
    const videoTimeRef = useRef<number>(0);

    const startMiniPlayer = useCallback((newContent: MiniPlayerContent) => {
        setContent(newContent);
        setIsActive(true);
        videoTimeRef.current = newContent.currentTime || 0;

        // Start usage tracking
        if (newContent.contentId && newContent.title) {
            usageStatsService.startSession(
                newContent.contentId,
                newContent.contentType || 'movie',
                newContent.title
            );
        }

        // Open external PiP window via IPC
        // Remove non-serializable properties (functions) before sending
        if (window.ipcRenderer) {
            const serializableContent = {
                src: newContent.src,
                title: newContent.title,
                poster: newContent.poster,
                contentId: newContent.contentId,
                contentType: newContent.contentType,
                currentTime: newContent.currentTime,
                seasonNumber: newContent.seasonNumber,
                episodeNumber: newContent.episodeNumber
            };
            window.ipcRenderer.invoke('pip:open', serializableContent).catch(console.error);
        }
    }, []);

    const stopMiniPlayer = useCallback(() => {
        usageStatsService.endSession();
        setIsActive(false);
        setContent(null);
        videoTimeRef.current = 0;

        // Close external PiP window
        if (window.ipcRenderer) {
            window.ipcRenderer.invoke('pip:close', {}).catch(console.error);
        }
    }, []);

    const getCurrentTime = useCallback(() => videoTimeRef.current, []);

    // Listen for PiP closed event from external window
    useEffect(() => {
        if (!window.ipcRenderer) return;

        const handlePipClosed = () => {
            usageStatsService.endSession();
            setIsActive(false);
            setContent(null);
            videoTimeRef.current = 0;
        };

        const handlePipState = (_event: unknown, state: { currentTime: number }) => {
            videoTimeRef.current = state.currentTime;
        };

        const handlePipExpand = (_event: unknown, expandContent: MiniPlayerContent) => {
            // Emit event for pages to handle expansion
            const expandEvent = new CustomEvent('miniPlayerExpand', {
                detail: {
                    src: expandContent.src,
                    title: expandContent.title,
                    poster: expandContent.poster,
                    contentId: expandContent.contentId,
                    contentType: expandContent.contentType,
                    currentTime: expandContent.currentTime,
                    seasonNumber: expandContent.seasonNumber,
                    episodeNumber: expandContent.episodeNumber
                }
            });
            window.dispatchEvent(expandEvent);

            // Also call the callback if provided
            if (expandContent.onExpand && expandContent.currentTime) {
                expandContent.onExpand(expandContent.currentTime);
            }

            setIsActive(false);
            setContent(null);
        };

        window.ipcRenderer.on('pip:closed', handlePipClosed);
        window.ipcRenderer.on('pip:state', handlePipState);
        window.ipcRenderer.on('pip:expand', handlePipExpand);

        // Handle request for next episode (from PiP window)
        const handleNextEpisodeRequest = async (_event: unknown, data: {
            seriesId: string;
            currentSeason: number;
            currentEpisode: number;
            responseChannel: string;
        }) => {
            try {
                // Get credentials for API call
                const result = await window.ipcRenderer.invoke('auth:get-credentials') as CredentialsResult;
                if (!result.success) {
                    window.ipcRenderer.send(data.responseChannel, null);
                    return;
                }

                const { url, username, password } = result.credentials;

                // Fetch series info to get episodes
                const response = await fetch(
                    `${url}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${data.seriesId}`
                );

                if (!response.ok) {
                    window.ipcRenderer.send(data.responseChannel, null);
                    return;
                }

                const seriesData = await response.json() as SeriesInfoResponse;
                const episodes = seriesData.episodes || {};
                
                // Find next episode
                let nextSeason = data.currentSeason;
                let nextEpisode = data.currentEpisode + 1;
                let nextEpData: SeriesEpisode | undefined;

                // Check if next episode exists in current season
                const currentSeasonEps = episodes[String(data.currentSeason)] || [];
                                
                // episode_num might be string or number, handle both
                nextEpData = currentSeasonEps.find((ep) => Number(ep.episode_num) === nextEpisode);
                
                // If not found, try first episode of next season
                if (!nextEpData) {
                    nextSeason = data.currentSeason + 1;
                    nextEpisode = 1;
                    const nextSeasonEps = episodes[String(nextSeason)] || [];
                    nextEpData = nextSeasonEps.find((ep) => Number(ep.episode_num) === 1);
                }

                if (nextEpData) {
                    // Build stream URL
                    const streamUrl = `${url}/series/${username}/${password}/${nextEpData.id}.${nextEpData.container_extension || 'mp4'}`;
                    const title = `${seriesData.info?.name || 'Series'} - S${nextSeason}E${nextEpisode}`;
                    
                    window.ipcRenderer.send(data.responseChannel, {
                        src: streamUrl,
                        title,
                        seasonNumber: nextSeason,
                        episodeNumber: nextEpisode
                    });
                } else {
                    window.ipcRenderer.send(data.responseChannel, null);
                }
            } catch (error) {
                console.error('[MiniPlayer] Error fetching next episode:', error);
                window.ipcRenderer.send(data.responseChannel, null);
            }
        };

        window.ipcRenderer.on('pip:requestNextEpisode', handleNextEpisodeRequest);

        return () => {
            window.ipcRenderer?.off('pip:closed', handlePipClosed);
            window.ipcRenderer?.off('pip:state', handlePipState);
            window.ipcRenderer?.off('pip:expand', handlePipExpand);
            window.ipcRenderer?.off('pip:requestNextEpisode', handleNextEpisodeRequest);
        };
    }, []);

    // Expose context globally for VideoPlayer access
    useEffect(() => {
        window.__miniPlayerContext = {
            startMiniPlayer,
            stopMiniPlayer,
            getCurrentTime,
            isActive
        };
        return () => {
            delete window.__miniPlayerContext;
        };
    }, [startMiniPlayer, stopMiniPlayer, getCurrentTime, isActive]);

    return (
        <MiniPlayerContext.Provider value={{ isActive, content, startMiniPlayer, stopMiniPlayer, getCurrentTime }}>
            {children}
            {/* External PiP window is now used instead of internal MiniPlayerUI */}
        </MiniPlayerContext.Provider>
    );
}

