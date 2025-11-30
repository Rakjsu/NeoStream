import type { UpdateInfo, UpdateConfig, DownloadProgress, UpdateCheckResult } from '../types/update';

/**
 * Service for managing application updates in the renderer process
 * Communicates with the main process via IPC
 */
export const updateService = {
    /**
     * Manually check for updates
     */
    checkForUpdates: async (): Promise<UpdateCheckResult> => {
        try {
            const result = await window.ipcRenderer.invoke('update:check-now');
            return result;
        } catch (error) {
            console.error('Failed to check for updates:', error);
            return {
                updateAvailable: false,
                currentVersion: '0.0.0'
            };
        }
    },

    /**
     * Download the available update
     */
    downloadUpdate: async (): Promise<{ success: boolean; error?: string }> => {
        try {
            return await window.ipcRenderer.invoke('update:download');
        } catch (error) {
            console.error('Failed to download update:', error);
            return { success: false, error: (error as Error).message };
        }
    },

    /**
     * Install the downloaded update and restart application
     */
    installUpdate: async (): Promise<void> => {
        try {
            await window.ipcRenderer.invoke('update:install');
        } catch (error) {
            console.error('Failed to install update:', error);
        }
    },

    /**
     * Get current update configuration
     */
    getConfig: async (): Promise<UpdateConfig> => {
        try {
            return await window.ipcRenderer.invoke('update:get-config');
        } catch (error) {
            console.error('Failed to get update config:', error);
            return {
                checkFrequency: 'on-open',
                autoInstall: false,
                lastCheck: 0
            };
        }
    },

    /**
     * Update configuration settings
     */
    setConfig: async (config: Partial<UpdateConfig>): Promise<{ success: boolean }> => {
        try {
            return await window.ipcRenderer.invoke('update:set-config', config);
        } catch (error) {
            console.error('Failed to set update config:', error);
            return { success: false };
        }
    },

    /**
     * Skip a specific version
     */
    skipVersion: async (version: string): Promise<{ success: boolean }> => {
        try {
            return await window.ipcRenderer.invoke('update:skip-version', version);
        } catch (error) {
            console.error('Failed to skip version:', error);
            return { success: false };
        }
    },

    /**
     * Register callback for when update checking starts
     */
    onCheckingForUpdate: (callback: () => void): (() => void) => {
        const handler = () => callback();
        window.ipcRenderer.on('update:checking', handler);

        // Return cleanup function
        return () => window.ipcRenderer.off('update:checking', handler);
    },

    /**
     * Register callback for when an update is available
     */
    onUpdateAvailable: (callback: (info: UpdateInfo) => void): (() => void) => {
        const handler = (_: any, info: UpdateInfo) => callback(info);
        window.ipcRenderer.on('update:available', handler);

        return () => window.ipcRenderer.off('update:available', handler);
    },

    /**
     * Register callback for when no update is available
     */
    onUpdateNotAvailable: (callback: () => void): (() => void) => {
        const handler = () => callback();
        window.ipcRenderer.on('update:not-available', handler);

        return () => window.ipcRenderer.off('update:not-available', handler);
    },

    /**
     * Register callback for download progress updates
     */
    onDownloadProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
        const handler = (_: any, progress: DownloadProgress) => callback(progress);
        window.ipcRenderer.on('update:download-progress', handler);

        return () => window.ipcRenderer.off('update:download-progress', handler);
    },

    /**
     * Register callback for when update is downloaded
     */
    onUpdateDownloaded: (callback: (info: UpdateInfo) => void): (() => void) => {
        const handler = (_: any, info: UpdateInfo) => callback(info);
        window.ipcRenderer.on('update:downloaded', handler);

        return () => window.ipcRenderer.off('update:downloaded', handler);
    },

    /**
     * Register callback for update errors
     */
    onUpdateError: (callback: (error: Error) => void): (() => void) => {
        const handler = (_: any, error: Error) => callback(error);
        window.ipcRenderer.on('update:error', handler);

        return () => window.ipcRenderer.off('update:error', handler);
    }
};
