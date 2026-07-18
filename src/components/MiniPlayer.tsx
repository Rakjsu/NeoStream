/**
 * Mini Player Context
 * Provides a floating mini player that persists across navigation
 */

import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { usageStatsService } from '../services/usageStatsService';
import { MiniPlayerContext, type MiniPlayerContent, type MiniPlayerContextType } from './miniPlayerContext';
import { FloatingMiniPlayer } from './FloatingMiniPlayer';

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

const PIP_CHANNEL_WINDOW = 300;

/** Slice the channel list to a window centered on the current channel. */
function limitChannelWindow(
    channelList: MiniPlayerContent['channelList'],
    contentId?: string
): MiniPlayerContent['channelList'] {
    if (!channelList || channelList.length <= PIP_CHANNEL_WINDOW) return channelList;
    const index = Math.max(0, channelList.findIndex(c => String(c.id) === String(contentId)));
    const half = Math.floor(PIP_CHANNEL_WINDOW / 2);
    const start = Math.min(Math.max(0, index - half), channelList.length - PIP_CHANNEL_WINDOW);
    return channelList.slice(start, start + PIP_CHANNEL_WINDOW);
}

export function MiniPlayerProvider({ children }: { children: ReactNode }) {
    const [isActive, setIsActive] = useState(false);
    const [content, setContent] = useState<MiniPlayerContent | null>(null);
    const [inAppContent, setInAppContent] = useState<MiniPlayerContent | null>(null);
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
                episodeNumber: newContent.episodeNumber,
                // The content travels as a URL query param, so cap the zapping
                // list to a window of channels centered on the current one.
                channelList: limitChannelWindow(newContent.channelList, newContent.contentId)
            };
            window.ipcRenderer.invoke('pip:open', serializableContent).catch(console.error);
        }
    }, []);

    /** In-app floating mini-player: same content, rendered as an overlay card. */
    const startInAppMiniPlayer = useCallback((newContent: MiniPlayerContent) => {
        setInAppContent(newContent);
        setIsActive(true);
        videoTimeRef.current = newContent.currentTime || 0;
        if (newContent.contentId && newContent.title) {
            usageStatsService.startSession(
                newContent.contentId,
                newContent.contentType || 'movie',
                newContent.title
            );
        }
    }, []);

    const stopMiniPlayer = useCallback(() => {
        usageStatsService.endSession();
        setIsActive(false);
        setContent(null);
        setInAppContent(null);
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


                // Episodes via IPC (works for Xtream, M3U and Stalker alike).
                const infoResult = await window.ipcRenderer.invoke('series:get-info', {
                    seriesId: data.seriesId
                }) as { success: boolean; info?: SeriesInfoResponse };

                if (!infoResult.success || !infoResult.info) {
                    window.ipcRenderer.send(data.responseChannel, null);
                    return;
                }

                const seriesData = infoResult.info;
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
                    // Resolve the episode URL via IPC (Xtream, M3U e Stalker).
                    const urlResult = await window.ipcRenderer.invoke('streams:get-series-url', {
                        streamId: nextEpData.id,
                        container: nextEpData.container_extension || 'mp4'
                    }) as { success: boolean; url?: string };
                    if (!urlResult.success || !urlResult.url) {
                        window.ipcRenderer.send(data.responseChannel, null);
                        return;
                    }
                    const streamUrl = urlResult.url;
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
            startInAppMiniPlayer,
            stopMiniPlayer,
            getCurrentTime,
            isActive
        };
        return () => {
            delete window.__miniPlayerContext;
        };
    }, [startMiniPlayer, startInAppMiniPlayer, stopMiniPlayer, getCurrentTime, isActive]);

    const handleInAppTime = useCallback((time: number) => {
        videoTimeRef.current = time;
    }, []);

    const closeInAppMiniPlayer = useCallback(() => {
        usageStatsService.endSession();
        setIsActive(false);
        setInAppContent(null);
        videoTimeRef.current = 0;
    }, []);

    return (
        <MiniPlayerContext.Provider value={{ isActive, content, startMiniPlayer, startInAppMiniPlayer, stopMiniPlayer, getCurrentTime }}>
            {children}
            {/* External PiP window handles "real" PiP; below is the in-app floating card. */}
            {inAppContent && (
                <FloatingMiniPlayer
                    content={inAppContent}
                    onZap={(zapPatch) => setInAppContent(prev => (prev ? { ...prev, ...zapPatch, currentTime: 0 } : prev))}
                    onTime={handleInAppTime}
                    onClose={closeInAppMiniPlayer}
                    onExpand={(time) => {
                        window.dispatchEvent(new CustomEvent('miniPlayerExpand', {
                            detail: {
                                src: inAppContent.src,
                                title: inAppContent.title,
                                poster: inAppContent.poster,
                                contentId: inAppContent.contentId,
                                contentType: inAppContent.contentType,
                                currentTime: time,
                                seasonNumber: inAppContent.seasonNumber,
                                episodeNumber: inAppContent.episodeNumber
                            }
                        }));
                        inAppContent.onExpand?.(time);
                        setIsActive(false);
                        setInAppContent(null);
                    }}
                />
            )}
        </MiniPlayerContext.Provider>
    );
}

