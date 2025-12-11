/**
 * Download Service
 * Manages content downloads with progress tracking and queue management
 */

export interface DownloadItem {
    id: string;
    name: string;
    type: 'movie' | 'series' | 'episode';
    url: string;
    cover: string;
    localCover?: string; // Cached poster path
    size: number;
    downloadedBytes: number;
    status: 'pending' | 'downloading' | 'paused' | 'completed' | 'failed';
    progress: number;
    filePath?: string;
    error?: string;
    createdAt: number;
    completedAt?: number;
    // Series specific
    seriesName?: string;
    seriesId?: string;
    season?: number;
    episode?: number;
    // Metadata
    plot?: string;
    rating?: string;
    year?: string;
    genres?: string[];
    duration?: number;
    tmdbId?: number;
}

export interface StorageInfo {
    used: number;
    total: number;
    available: number;
    downloadsPath: string;
}

type DownloadEventCallback = (item: DownloadItem) => void;

class DownloadService {
    private downloads: Map<string, DownloadItem> = new Map();
    private queue: string[] = [];
    private isProcessing: boolean = false;
    private maxConcurrent: number = 2;
    private activeDownloads: number = 0;
    private listeners: Map<string, DownloadEventCallback[]> = new Map();
    private dbName = 'neostream_downloads';
    private storeName = 'downloads';
    private db: IDBDatabase | null = null;

    constructor() {
        this.initDB();
    }

    private async initDB(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);

            request.onsuccess = () => {
                this.db = request.result;
                this.loadDownloads();
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
        });
    }

    private async loadDownloads(): Promise<void> {
        if (!this.db) return;

        const transaction = this.db.transaction(this.storeName, 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAll();

        request.onsuccess = () => {
            const items = request.result as DownloadItem[];
            items.forEach(item => {
                // Reset downloading items to paused on app restart
                if (item.status === 'downloading') {
                    item.status = 'paused';
                }
                this.downloads.set(item.id, item);
            });
        };
    }

    private async saveDownload(item: DownloadItem): Promise<void> {
        if (!this.db) return;

        const transaction = this.db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        store.put(item);
    }

    private async deleteDownloadFromDB(id: string): Promise<void> {
        if (!this.db) return;

        const transaction = this.db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        store.delete(id);
    }

    // Event handling
    on(event: string, callback: DownloadEventCallback): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(callback);
    }

    off(event: string, callback: DownloadEventCallback): void {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    private emit(event: string, item: DownloadItem): void {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(cb => cb(item));
        }
    }

    // Generate unique ID
    private generateId(type: string, name: string): string {
        const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        return `${type}_${normalized}_${Date.now()}`;
    }

    // Add to download queue
    async addDownload(
        name: string,
        type: 'movie' | 'series' | 'episode',
        url: string,
        cover: string,
        seriesInfo?: { seriesName: string; seriesId?: string; season: number; episode: number },
        metadata?: {
            plot?: string;
            rating?: string;
            year?: string;
            genres?: string[];
            duration?: number;
            tmdbId?: number;
        }
    ): Promise<DownloadItem> {
        const id = this.generateId(type, name);

        // Cache the cover image - for episodes, use seriesName to avoid duplicates
        let localCover: string | undefined;
        try {
            // For episodes, use seriesName as cache key so all eps share same poster
            const cacheKey = type === 'episode' && seriesInfo?.seriesName
                ? `series_${seriesInfo.seriesName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
                : id;

            // First check if we already have the poster cached for this series
            if (type === 'episode' && seriesInfo?.seriesName) {
                const existingEp = Array.from(this.downloads.values()).find(
                    item => item.seriesName === seriesInfo.seriesName && item.localCover
                );
                if (existingEp?.localCover) {
                    localCover = existingEp.localCover;
                }
            }

            // Only download if we don't have it cached
            if (!localCover) {
                const cacheResult = await window.ipcRenderer.invoke('download:cache-image', {
                    url: cover,
                    id: cacheKey
                });
                if (cacheResult.success) {
                    localCover = cacheResult.localPath;
                }
            }
        } catch (e) {
            console.warn('Failed to cache cover image:', e);
        }

        const item: DownloadItem = {
            id,
            name,
            type,
            url,
            cover,
            localCover,
            size: 0,
            downloadedBytes: 0,
            status: 'pending',
            progress: 0,
            createdAt: Date.now(),
            ...(seriesInfo && {
                seriesName: seriesInfo.seriesName,
                seriesId: seriesInfo.seriesId,
                season: seriesInfo.season,
                episode: seriesInfo.episode
            }),
            ...(metadata && {
                plot: metadata.plot,
                rating: metadata.rating,
                year: metadata.year,
                genres: metadata.genres,
                duration: metadata.duration,
                tmdbId: metadata.tmdbId
            })
        };

        this.downloads.set(id, item);
        this.queue.push(id);
        await this.saveDownload(item);
        this.emit('added', item);

        this.processQueue();

        return item;
    }

    // Process download queue
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.activeDownloads >= this.maxConcurrent) {
            return;
        }

        const pendingId = this.queue.find(id => {
            const item = this.downloads.get(id);
            return item && item.status === 'pending';
        });

        if (!pendingId) return;

        this.activeDownloads++;
        const item = this.downloads.get(pendingId)!;
        item.status = 'downloading';
        this.emit('started', item);
        await this.saveDownload(item);

        try {
            await this.downloadFile(item);
        } catch (error: any) {
            item.status = 'failed';
            item.error = error.message || 'Download failed';
            this.emit('error', item);
            await this.saveDownload(item);
        }

        this.activeDownloads--;
        this.processQueue();
    }

    // Download file using Electron IPC
    private async downloadFile(item: DownloadItem): Promise<void> {
        return new Promise((resolve, reject) => {
            // Start download via IPC
            window.ipcRenderer.invoke('download:start', {
                id: item.id,
                url: item.url,
                name: item.name,
                type: item.type,
                seriesName: item.seriesName,
                season: item.season,
                episode: item.episode
            }).then((result: any) => {
                if (result.success) {
                    item.filePath = result.filePath;
                    item.size = result.size || 0;
                    item.status = 'completed';
                    item.progress = 100;
                    item.completedAt = Date.now();
                    this.emit('completed', item);
                    this.saveDownload(item);
                    resolve();
                } else {
                    reject(new Error(result.error || 'Download failed'));
                }
            }).catch(reject);

            // Listen for progress updates
            const progressHandler = (_event: any, data: { id: string; progress: number; downloadedBytes: number; totalBytes: number }) => {
                if (data.id === item.id) {
                    item.progress = data.progress;
                    item.downloadedBytes = data.downloadedBytes;
                    item.size = data.totalBytes;
                    this.emit('progress', item);
                }
            };

            window.ipcRenderer.on('download:progress', progressHandler);
        });
    }

    // Pause download
    async pauseDownload(id: string): Promise<void> {
        const item = this.downloads.get(id);
        if (item && item.status === 'downloading') {
            await window.ipcRenderer.invoke('download:pause', { id });
            item.status = 'paused';
            this.emit('paused', item);
            await this.saveDownload(item);
        }
    }

    // Resume download
    async resumeDownload(id: string): Promise<void> {
        const item = this.downloads.get(id);
        if (item && (item.status === 'paused' || item.status === 'failed')) {
            item.status = 'pending';
            item.error = undefined;
            this.queue.push(id);
            await this.saveDownload(item);
            this.processQueue();
        }
    }

    // Cancel download
    async cancelDownload(id: string): Promise<void> {
        const item = this.downloads.get(id);
        if (item) {
            if (item.status === 'downloading') {
                await window.ipcRenderer.invoke('download:cancel', { id });
            }

            // Remove file if exists
            if (item.filePath) {
                await window.ipcRenderer.invoke('download:delete-file', { filePath: item.filePath });
            }

            this.downloads.delete(id);
            this.queue = this.queue.filter(qId => qId !== id);
            await this.deleteDownloadFromDB(id);
            this.emit('cancelled', item);
        }
    }

    // Delete download (cancels if active, deletes file and removes from queue)
    async deleteDownload(id: string): Promise<void> {
        const item = this.downloads.get(id);
        if (item) {
            // Cancel if still downloading or pending
            if (item.status === 'downloading' || item.status === 'pending' || item.status === 'paused') {
                try {
                    await window.ipcRenderer.invoke('download:cancel', { id });
                } catch (e) {
                    console.warn('Failed to cancel download:', e);
                }
            }
            // Delete file if exists
            if (item.filePath) {
                await window.ipcRenderer.invoke('download:delete-file', { filePath: item.filePath });
            }
            this.downloads.delete(id);
            await this.deleteDownloadFromDB(id);
            this.emit('deleted', item);
        }
    }

    // Delete entire series (all episodes + folder)
    async deleteSeries(seriesName: string): Promise<void> {
        // Find all episodes of this series
        const seriesEpisodes = Array.from(this.downloads.values()).filter(
            item => item.type === 'episode' && item.seriesName === seriesName
        );

        // Delete each episode
        for (const ep of seriesEpisodes) {
            await this.deleteDownload(ep.id);
        }

        // Delete the series folder
        try {
            await window.ipcRenderer.invoke('download:delete-folder', { folderName: seriesName });
        } catch (e) {
            console.warn('Failed to delete series folder:', e);
        }
    }

    // Get all downloads
    getDownloads(): DownloadItem[] {
        return Array.from(this.downloads.values()).sort((a, b) => b.createdAt - a.createdAt);
    }

    // Get downloads by status
    getDownloadsByStatus(status: DownloadItem['status']): DownloadItem[] {
        return this.getDownloads().filter(item => item.status === status);
    }

    // Get storage info
    async getStorageInfo(): Promise<StorageInfo> {
        try {
            const result = await window.ipcRenderer.invoke('download:get-storage-info');
            return result;
        } catch {
            return {
                used: 0,
                total: 100 * 1024 * 1024 * 1024, // 100GB default
                available: 100 * 1024 * 1024 * 1024,
                downloadsPath: ''
            };
        }
    }

    // Open downloads folder
    async openDownloadsFolder(): Promise<void> {
        await window.ipcRenderer.invoke('download:open-folder');
    }

    // Check if content is downloaded
    isDownloaded(name: string, type: string): boolean {
        return Array.from(this.downloads.values()).some(
            item => item.name === name && item.type === type && item.status === 'completed'
        );
    }

    // Check if episode is already in queue (downloading, pending, or completed)
    isEpisodeInQueue(seriesName: string, season: number, episode: number): boolean {
        return Array.from(this.downloads.values()).some(
            item => item.type === 'episode' &&
                item.seriesName === seriesName &&
                item.season === season &&
                item.episode === episode &&
                (item.status === 'pending' || item.status === 'downloading' || item.status === 'completed')
        );
    }

    // Check if any episode from a season is in queue
    isSeasonInQueue(seriesName: string, season: number): boolean {
        return Array.from(this.downloads.values()).some(
            item => item.type === 'episode' &&
                item.seriesName === seriesName &&
                item.season === season &&
                (item.status === 'pending' || item.status === 'downloading' || item.status === 'completed' || item.status === 'paused')
        );
    }

    // Check if movie is already in queue
    isMovieInQueue(movieName: string): boolean {
        return Array.from(this.downloads.values()).some(
            item => item.type === 'movie' &&
                item.name === movieName &&
                (item.status === 'pending' || item.status === 'downloading' || item.status === 'completed' || item.status === 'paused')
        );
    }

    // Count episodes in queue for a season
    getSeasonDownloadCount(seriesName: string, season: number): number {
        return Array.from(this.downloads.values()).filter(
            item => item.type === 'episode' &&
                item.seriesName === seriesName &&
                item.season === season
        ).length;
    }

    // Get download by content
    getDownloadByContent(name: string, type: string): DownloadItem | undefined {
        return Array.from(this.downloads.values()).find(
            item => item.name === name && item.type === type
        );
    }

    // Get offline file path for playback (returns file:// URL or null)
    getOfflineFilePath(name: string, type: string): string | null {
        const item = Array.from(this.downloads.values()).find(
            item => item.name === name && item.type === type && item.status === 'completed' && item.filePath
        );
        if (item?.filePath) {
            // Convert Windows path to file:// URL
            const normalizedPath = item.filePath.replace(/\\/g, '/');
            return `file:///${normalizedPath}`;
        }
        return null;
    }

    // Get offline file path for series episode
    getOfflineEpisodePath(seriesName: string, season: number, episode: number): string | null {
        const item = Array.from(this.downloads.values()).find(
            item =>
                item.type === 'episode' &&
                item.seriesName === seriesName &&
                item.season === season &&
                item.episode === episode &&
                item.status === 'completed' &&
                item.filePath
        );
        if (item?.filePath) {
            const normalizedPath = item.filePath.replace(/\\/g, '/');
            return `file:///${normalizedPath}`;
        }
        return null;
    }

    // Format bytes to human readable
    formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Get downloads grouped by series for UI display
    getDownloadsGrouped(): {
        movies: DownloadItem[];
        series: {
            seriesName: string;
            seriesId?: string;
            cover: string;
            localCover?: string;
            plot?: string;
            rating?: string;
            year?: string;
            genres?: string[];
            seasons: {
                season: number;
                episodes: DownloadItem[]
            }[]
        }[]
    } {
        const movies = Array.from(this.downloads.values())
            .filter(item => item.type === 'movie')
            .sort((a, b) => b.createdAt - a.createdAt);

        const episodeItems = Array.from(this.downloads.values())
            .filter(item => item.type === 'episode' && item.seriesName);

        // Group episodes by series
        const seriesMap = new Map<string, {
            seriesName: string;
            seriesId?: string;
            cover: string;
            localCover?: string;
            plot?: string;
            rating?: string;
            year?: string;
            genres?: string[];
            seasonsMap: Map<number, DownloadItem[]>
        }>();

        episodeItems.forEach(ep => {
            const key = ep.seriesName!;
            if (!seriesMap.has(key)) {
                seriesMap.set(key, {
                    seriesName: ep.seriesName!,
                    seriesId: ep.seriesId,
                    cover: ep.cover,
                    localCover: ep.localCover,
                    plot: ep.plot,
                    rating: ep.rating,
                    year: ep.year,
                    genres: ep.genres,
                    seasonsMap: new Map()
                });
            }
            const seriesData = seriesMap.get(key)!;
            if (!seriesData.seasonsMap.has(ep.season!)) {
                seriesData.seasonsMap.set(ep.season!, []);
            }
            seriesData.seasonsMap.get(ep.season!)!.push(ep);
        });

        // Convert to array structure
        const series = Array.from(seriesMap.values()).map(s => ({
            seriesName: s.seriesName,
            seriesId: s.seriesId,
            cover: s.cover,
            localCover: s.localCover,
            plot: s.plot,
            rating: s.rating,
            year: s.year,
            genres: s.genres,
            seasons: Array.from(s.seasonsMap.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([season, episodes]) => ({
                    season,
                    episodes: episodes.sort((a, b) => (a.episode || 0) - (b.episode || 0))
                }))
        }));

        return { movies, series };
    }
}

export const downloadService = new DownloadService();
