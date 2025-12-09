import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import store from './store';

interface UpdateConfig {
    checkFrequency: 'on-open' | '1-day' | '1-week' | '1-month';
    autoInstall: boolean;
    lastCheck: number;
    skippedVersion?: string;
}

const DEFAULT_CONFIG: UpdateConfig = {
    checkFrequency: 'on-open',
    autoInstall: false,
    lastCheck: 0
};

export function initializeAutoUpdater(mainWindow: BrowserWindow) {
    // Get or initialize config
    const getConfig = (): UpdateConfig => {
        const stored = store.get('updateConfig');
        return stored ? { ...DEFAULT_CONFIG, ...stored } : DEFAULT_CONFIG;
    };

    // Save config
    const saveConfig = (config: Partial<UpdateConfig>) => {
        const current = getConfig();
        store.set('updateConfig', { ...current, ...config });
    };

    // Update last check timestamp
    const updateLastCheck = () => {
        saveConfig({ lastCheck: Date.now() });
    };

    // Check if should check for updates based on frequency
    const shouldCheckForUpdates = (): boolean => {
        const config = getConfig();
        const now = Date.now();
        const lastCheck = config.lastCheck || 0;

        const intervals = {
            'on-open': 0, // Always check on app open
            '1-day': 24 * 60 * 60 * 1000,
            '1-week': 7 * 24 * 60 * 60 * 1000,
            '1-month': 30 * 24 * 60 * 60 * 1000
        };

        const interval = intervals[config.checkFrequency];
        return (now - lastCheck) >= interval;
    };

    // Configure autoUpdater
    autoUpdater.autoDownload = false; // Manual download control
    autoUpdater.autoInstallOnAppQuit = true;
    // Disable code signature verification for unsigned apps
    autoUpdater.forceDevUpdateConfig = true;

    // Setup event handlers
    autoUpdater.on('checking-for-update', () => {
        console.log('Checking for updates...');
        mainWindow.webContents.send('update:checking');
    });

    autoUpdater.on('update-available', (info) => {
        console.log('Update available:', info.version);

        const config = getConfig();

        // Skip if user marked this version to skip
        if (config.skippedVersion === info.version) {
            console.log('Skipping version:', info.version);
            return;
        }

        mainWindow.webContents.send('update:available', info);

        // Auto-download if configured
        if (config.autoInstall) {
            console.log('Auto-downloading update...');
            autoUpdater.downloadUpdate();
        }
    });

    autoUpdater.on('update-not-available', () => {
        console.log('No updates available');
        mainWindow.webContents.send('update:not-available');
        updateLastCheck();
    });

    autoUpdater.on('download-progress', (progress) => {
        console.log(`Download progress: ${progress.percent}%`);
        mainWindow.webContents.send('update:download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log('Update downloaded:', info.version);
        mainWindow.webContents.send('update:downloaded', info);

        const config = getConfig();
        if (config.autoInstall) {
            // Give user 5 seconds before auto-installing
            setTimeout(() => {
                console.log('Auto-installing update...');
                autoUpdater.quitAndInstall(false, true);
            }, 5000);
        }
    });

    autoUpdater.on('error', (error) => {
        console.error('Auto-updater error:', error);
        mainWindow.webContents.send('update:error', {
            message: error.message,
            stack: error.stack
        });
    });

    // IPC Handlers
    ipcMain.handle('update:check-now', async () => {
        try {
            const result = await autoUpdater.checkForUpdates();
            updateLastCheck();

            if (result) {
                return {
                    updateAvailable: result.updateInfo.version !== autoUpdater.currentVersion.version,
                    currentVersion: autoUpdater.currentVersion.version,
                    latestVersion: result.updateInfo.version,
                    updateInfo: result.updateInfo
                };
            }

            return {
                updateAvailable: false,
                currentVersion: autoUpdater.currentVersion.version
            };
        } catch (error: any) {
            console.error('Error checking for updates:', error);
            return {
                updateAvailable: false,
                currentVersion: autoUpdater.currentVersion.version,
                error: error.message
            };
        }
    });

    ipcMain.handle('update:download', async () => {
        try {
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (error: any) {
            console.error('Error downloading update:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update:install', () => {
        try {
            // Quit and install immediately
            autoUpdater.quitAndInstall(false, true);
            return { success: true };
        } catch (error: any) {
            console.error('Error installing update:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update:get-config', () => {
        return getConfig();
    });

    ipcMain.handle('update:set-config', (_, config: Partial<UpdateConfig>) => {
        saveConfig(config);
        return { success: true };
    });

    ipcMain.handle('update:skip-version', (_, version: string) => {
        saveConfig({ skippedVersion: version });
        return { success: true };
    });

    // Check for updates on app ready if configured
    if (shouldCheckForUpdates()) {
        // Wait 5 seconds after app starts to check for updates
        setTimeout(() => {
            console.log('Checking for updates (scheduled)...');
            autoUpdater.checkForUpdates().catch(err => {
                console.error('Scheduled update check failed:', err);
            });
        }, 5000);
    }

    // Set up periodic checking (every hour)
    setInterval(() => {
        if (shouldCheckForUpdates()) {
            console.log('Checking for updates (periodic)...');
            autoUpdater.checkForUpdates().catch(err => {
                console.error('Periodic update check failed:', err);
            });
        }
    }, 60 * 60 * 1000); // Every hour

    console.log('Auto-updater initialized');
}
