// App Notification Service
// Centralized notification system for all app notifications

import { profileService } from './profileService';
import { favoritesService } from './favoritesService';
import { watchProgressService } from './watchProgressService';
import { languageService } from './languageService';

// Notification types
export type NotificationType =
    | 'new_season'
    | 'new_episodes'
    | 'download_complete'
    | 'download_failed'
    | 'download_started'
    | 'program_reminder';

export interface AppNotification {
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    poster?: string;
    contentId?: string;
    contentType?: 'movie' | 'series' | 'episode';
    createdAt: string;
    read: boolean;
    // Extra data for specific types
    meta?: {
        seriesId?: string;
        seriesName?: string;
        seasonNumber?: number;
        episodeNumber?: number;
        newSeasons?: number;
        newEpisodes?: number;
    };
}

export interface SeriesEpisodeData {
    seriesId: string;
    seriesName: string;
    poster: string;
    lastKnownSeasons: number;
    lastKnownEpisodes: number;
    lastChecked: string;
}

type NotificationCallback = (notifications: AppNotification[]) => void;

/** How often the background new-episode check runs while the app is open. */
export const EPISODE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

class AppNotificationService {
    private readonly STORAGE_KEY_PREFIX = 'app_notifications';
    private readonly SERIES_DATA_KEY_PREFIX = 'series_episode_data';
    private listeners: NotificationCallback[] = [];
    private isCheckingEpisodes = false;
    // Background periodic check bookkeeping (single shared timer).
    private periodicTimer: ReturnType<typeof setInterval> | null = null;

    // Get storage key for current profile
    private getStorageKey(suffix: string): string {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return `${suffix}_default`;
        return `${suffix}_${activeProfile.id}`;
    }

    // Get stored series data
    private getSeriesData(): Map<string, SeriesEpisodeData> {
        try {
            const key = this.getStorageKey(this.SERIES_DATA_KEY_PREFIX);
            const data = localStorage.getItem(key);
            if (!data) return new Map();
            const parsed = JSON.parse(data);
            return new Map(Object.entries(parsed));
        } catch {
            return new Map();
        }
    }

    // Save series data
    private saveSeriesData(data: Map<string, SeriesEpisodeData>): void {
        const key = this.getStorageKey(this.SERIES_DATA_KEY_PREFIX);
        const obj = Object.fromEntries(data);
        localStorage.setItem(key, JSON.stringify(obj));
    }

    // Get all notifications
    getNotifications(): AppNotification[] {
        try {
            const key = this.getStorageKey(this.STORAGE_KEY_PREFIX);
            const data = localStorage.getItem(key);
            if (!data) return [];
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    // Save notifications
    private saveNotifications(notifications: AppNotification[]): void {
        const key = this.getStorageKey(this.STORAGE_KEY_PREFIX);
        // Keep only last 50 notifications
        const trimmed = notifications.slice(0, 50);
        localStorage.setItem(key, JSON.stringify(trimmed));
        this.notifyListeners(trimmed);
    }

    // Add notification (public method for external use)
    addNotification(notification: Omit<AppNotification, 'id' | 'createdAt' | 'read'>): AppNotification {
        const notifications = this.getNotifications();

        const newNotification: AppNotification = {
            ...notification,
            id: `${notification.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            createdAt: new Date().toISOString(),
            read: false
        };

        notifications.unshift(newNotification);
        this.saveNotifications(notifications);

        return newNotification;
    }

    // Add download notification
    addDownloadNotification(
        status: 'started' | 'complete' | 'failed',
        contentName: string,
        contentType: 'movie' | 'series' | 'episode',
        poster?: string,
        meta?: { seriesName?: string; seasonNumber?: number; episodeNumber?: number }
    ): AppNotification {
        const typeMap = {
            started: 'download_started' as NotificationType,
            complete: 'download_complete' as NotificationType,
            failed: 'download_failed' as NotificationType
        };

        const t = (section: string, key: string) => languageService.t(section, key);

        const titleMap = {
            started: `📥 ${t('notifications', 'downloadStarted')}`,
            complete: `✅ ${t('notifications', 'downloadComplete')}`,
            failed: `❌ ${t('notifications', 'downloadFailed')}`
        };

        const messageMap = {
            started: `${t('downloads', 'downloading')?.replace('...', '') || 'Baixando'} "${contentName}"...`,
            complete: `"${contentName}" ${t('downloads', 'availableOffline') || 'está disponível offline!'}`,
            failed: `${t('downloads', 'failedTo') || 'Falha ao baixar'} "${contentName}". ${t('profile', 'tryAgain') || 'Tente novamente'}.`
        };

        return this.addNotification({
            type: typeMap[status],
            title: titleMap[status],
            message: messageMap[status],
            poster,
            contentType,
            meta
        });
    }

    // Get unread count
    getUnreadCount(): number {
        return this.getNotifications().filter(n => !n.read).length;
    }

    // Mark notification as read
    markAsRead(notificationId: string): void {
        const notifications = this.getNotifications();
        const notification = notifications.find(n => n.id === notificationId);
        if (notification) {
            notification.read = true;
            this.saveNotifications(notifications);
        }
    }

    // Mark all as read
    markAllAsRead(): void {
        const notifications = this.getNotifications();
        notifications.forEach(n => n.read = true);
        this.saveNotifications(notifications);
    }

    // Clear all notifications
    clearAll(): void {
        this.saveNotifications([]);
    }

    // Delete a specific notification
    deleteNotification(notificationId: string): void {
        const notifications = this.getNotifications().filter(n => n.id !== notificationId);
        this.saveNotifications(notifications);
    }

    // Subscribe to notification changes
    subscribe(callback: NotificationCallback): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    // Notify all listeners
    private notifyListeners(notifications: AppNotification[]): void {
        this.listeners.forEach(callback => callback(notifications));
    }

    // ========== Episode Checking ==========

    // Get all series to monitor (favorites + watched)
    private async getSeriesToMonitor(): Promise<Array<{ id: string; name: string; poster: string }>> {
        const seriesMap = new Map<string, { id: string; name: string; poster: string }>();

        // Get favorites (series only)
        const favorites = favoritesService.getAll().filter(f => f.type === 'series');
        favorites.forEach(f => {
            seriesMap.set(f.id, { id: f.id, name: f.title, poster: f.poster });
        });

        // Get series with watch progress
        const continueWatching = watchProgressService.getContinueWatching();
        continueWatching.forEach((progress, seriesId) => {
            if (!seriesMap.has(seriesId)) {
                seriesMap.set(seriesId, {
                    id: seriesId,
                    name: progress.seriesName,
                    poster: ''
                });
            }
        });

        return Array.from(seriesMap.values());
    }

    // Fetch series info from API
    private async fetchSeriesInfo(seriesId: string): Promise<{ seasons: number; episodes: number; poster: string } | null> {
        try {
            const result = await window.ipcRenderer.invoke('auth:get-credentials');
            if (!result.success) return null;

            const { url, username, password } = result.credentials;
            const response = await fetch(
                `${url}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${seriesId}`
            );

            if (!response.ok) return null;

            const data = await response.json();

            const episodes = data.episodes || {};
            const seasonKeys = Object.keys(episodes);
            const totalSeasons = seasonKeys.length;
            let totalEpisodes = 0;

            seasonKeys.forEach(season => {
                totalEpisodes += (episodes[season] || []).length;
            });

            return {
                seasons: totalSeasons,
                episodes: totalEpisodes,
                poster: data.info?.cover || ''
            };
        } catch (error) {
            console.error('Error fetching series info:', error);
            return null;
        }
    }

    // Check for new episodes
    async checkForNewEpisodes(): Promise<AppNotification[]> {
        if (this.isCheckingEpisodes) return [];
        this.isCheckingEpisodes = true;

        const newNotifications: AppNotification[] = [];

        try {
            const seriesToMonitor = await this.getSeriesToMonitor();
            const seriesData = this.getSeriesData();

            
            for (const series of seriesToMonitor) {
                const currentInfo = await this.fetchSeriesInfo(series.id);
                if (!currentInfo) continue;

                const storedData = seriesData.get(series.id);
                const poster = currentInfo.poster || series.poster;

                if (storedData) {
                    const newSeasons = currentInfo.seasons - storedData.lastKnownSeasons;
                    const newEpisodes = currentInfo.episodes - storedData.lastKnownEpisodes;

                    if (newSeasons > 0) {
                        const notification = this.addNotification({
                            type: 'new_season',
                            title: '🎉 Nova Temporada',
                            message: `${series.name}: ${newSeasons} nova${newSeasons > 1 ? 's' : ''} temporada${newSeasons > 1 ? 's' : ''}!`,
                            poster,
                            contentType: 'series',
                            contentId: series.id,
                            meta: {
                                seriesId: series.id,
                                seriesName: series.name,
                                newSeasons,
                                newEpisodes
                            }
                        });
                        newNotifications.push(notification);
                                            } else if (newEpisodes > 0) {
                        const notification = this.addNotification({
                            type: 'new_episodes',
                            title: '📺 Novos Episódios',
                            message: `${series.name}: ${newEpisodes} novo${newEpisodes > 1 ? 's' : ''} episódio${newEpisodes > 1 ? 's' : ''}!`,
                            poster,
                            contentType: 'series',
                            contentId: series.id,
                            meta: {
                                seriesId: series.id,
                                seriesName: series.name,
                                newEpisodes
                            }
                        });
                        newNotifications.push(notification);
                                            }
                }

                // Update stored data
                seriesData.set(series.id, {
                    seriesId: series.id,
                    seriesName: series.name,
                    poster,
                    lastKnownSeasons: currentInfo.seasons,
                    lastKnownEpisodes: currentInfo.episodes,
                    lastChecked: new Date().toISOString()
                });

                await new Promise(resolve => setTimeout(resolve, 100));
            }

            this.saveSeriesData(seriesData);
            
        } catch (error) {
            console.error('[Notifications] Error checking for new episodes:', error);
        } finally {
            this.isCheckingEpisodes = false;
        }

        return newNotifications;
    }

    // ========== Background periodic check ==========

    /** True while the background interval is running. */
    isPeriodicCheckRunning(): boolean {
        return this.periodicTimer !== null;
    }

    /**
     * Start (idempotent) the background new-episode check: runs once now, then
     * every `intervalMs` (default 6h). Overlap is prevented by the existing
     * `isCheckingEpisodes` guard inside checkForNewEpisodes (a tick that fires
     * while a prior run is still in flight is a no-op), and the per-series API
     * throttle is honoured because the same method is reused.
     *
     * Returns a teardown function that clears the interval. Calling start again
     * while already running is a no-op (the same single timer is kept), so
     * multiple mounts/unmounts can't spawn parallel intervals.
     */
    startPeriodicCheck(
        intervalMs: number = EPISODE_CHECK_INTERVAL_MS,
        options: { runImmediately?: boolean } = {}
    ): () => void {
        if (this.periodicTimer !== null) {
            // Already running — share the existing timer.
            return () => this.stopPeriodicCheck();
        }

        // Optionally run once on start. The caller (EpisodeToast) already does a
        // delayed one-shot to surface toasts, so it passes runImmediately:false
        // and relies on this only for the recurring cadence. The guard inside
        // checkForNewEpisodes swallows any overlap either way.
        if (options.runImmediately) {
            void this.checkForNewEpisodes();
        }

        this.periodicTimer = setInterval(() => {
            void this.checkForNewEpisodes();
        }, intervalMs);

        return () => this.stopPeriodicCheck();
    }

    /** Clear the background interval (no-op if not running). */
    stopPeriodicCheck(): void {
        if (this.periodicTimer !== null) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = null;
        }
    }

    // Remove series from tracking
    removeSeriesFromTracking(seriesId: string): void {
        const seriesData = this.getSeriesData();
        seriesData.delete(seriesId);
        this.saveSeriesData(seriesData);
    }

    /**
     * Drop tracked-series entries that are no longer monitored.
     *
     * `series_episode_data_<profile>` accumulates one entry per series we ever
     * checked for new episodes and is never pruned automatically
     * (removeSeriesFromTracking is only called by hand). The monitored set is
     * "favorites + series with watch progress" (see getSeriesToMonitor): once a
     * series leaves both, its entry is dead weight. This removes exactly those
     * stale entries and is a no-op when nothing is stale.
     *
     * Returns the number of entries removed (handy for tests/telemetry).
     */
    async pruneStaleSeriesData(): Promise<number> {
        const seriesData = this.getSeriesData();
        if (seriesData.size === 0) return 0;

        const monitored = await this.getSeriesToMonitor();
        const monitoredIds = new Set(monitored.map(s => s.id));

        let removed = 0;
        for (const seriesId of Array.from(seriesData.keys())) {
            if (!monitoredIds.has(seriesId)) {
                seriesData.delete(seriesId);
                removed += 1;
            }
        }

        if (removed > 0) {
            this.saveSeriesData(seriesData);
        }
        return removed;
    }
}

export const appNotificationService = new AppNotificationService();

// Re-export for backward compatibility
export const episodeNotificationService = appNotificationService;

// Type alias for backwards compatibility
export type EpisodeNotification = AppNotification;
