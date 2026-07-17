/**
 * PiP (Picture-in-Picture) Window Handlers
 * Manages IPC communication for the independent PiP window
 */

import { BrowserWindow, ipcMain, screen, globalShortcut } from 'electron';
import type { IpcMainEvent } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import Store from 'electron-store';

import log from './logger'
// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pipWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let currentPipContent: PipContent | null = null;
let clickThroughMode = false;

interface PipContent {
    src: string;
    title: string;
    poster?: string;
    contentId?: string;
    contentType?: 'movie' | 'series' | 'live';
    currentTime?: number;
    seasonNumber?: number;
    episodeNumber?: number;
}

// Multi-monitor: which display hosts the PiP window (absent = primary).
const pipStore = new Store<{ pipDisplayId?: number }>({ name: 'pip-config' });

function pickPipDisplay() {
    const preferredId = pipStore.get('pipDisplayId');
    if (typeof preferredId === 'number') {
        const match = screen.getAllDisplays().find(d => d.id === preferredId);
        if (match) return match;
    }
    return screen.getPrimaryDisplay();
}

export function setupPipHandlers(mainWin: BrowserWindow) {
    mainWindow = mainWin;

    // Multi-monitor: list displays + persist which one hosts the PiP window.
    ipcMain.handle('pip:get-display-config', () => ({
        success: true,
        displays: screen.getAllDisplays().map((d, index) => ({
            id: d.id,
            label: d.label || `Monitor ${index + 1}`,
            width: d.size.width,
            height: d.size.height,
            primary: d.id === screen.getPrimaryDisplay().id,
        })),
        selectedId: typeof pipStore.get('pipDisplayId') === 'number' ? pipStore.get('pipDisplayId') : null,
    }));

    ipcMain.handle('pip:set-display', (_event, data: { displayId: number | null }) => {
        if (typeof data?.displayId === 'number') pipStore.set('pipDisplayId', data.displayId);
        else pipStore.delete('pipDisplayId');
        // A live PiP window hops to the new display right away.
        if (pipWindow && !pipWindow.isDestroyed()) {
            const area = pickPipDisplay().workArea;
            pipWindow.setPosition(area.x + area.width - 420, area.y + area.height - 280);
        }
        return { success: true };
    });

    // Open PiP window
    ipcMain.handle('pip:open', async (_event, content: PipContent) => {
        // Store current content
        currentPipContent = content;

        // Close existing PiP window if any
        if (pipWindow && !pipWindow.isDestroyed()) {
            pipWindow.close();
        }

        const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

        pipWindow = new BrowserWindow({
            width: 400,
            height: 250,
            minWidth: 320,
            minHeight: 200,
            maxWidth: 800,
            maxHeight: 500,
            frame: false, // No native window frame
            transparent: true, // Allow transparent/rounded corners
            alwaysOnTop: true, // Stay on top of other windows
            resizable: true,
            skipTaskbar: false, // Show in taskbar
            hasShadow: true,
            focusable: true, // Can receive focus independently
            movable: true, // Can be moved
            parent: undefined, // No parent - completely independent window
            modal: false, // Not a modal
            webPreferences: {
                preload: path.join(__dirname, 'preload.mjs'),
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: false,
            },
        });

        // Position in bottom-right corner of the configured display (falls
        // back to the primary when the saved monitor is gone).
        const area = pickPipDisplay().workArea;
        pipWindow.setPosition(area.x + area.width - 420, area.y + area.height - 280);

        // Load PiP page with content data encoded in URL
        const encodedContent = encodeURIComponent(JSON.stringify(content));
        if (VITE_DEV_SERVER_URL) {
            pipWindow.loadURL(`${VITE_DEV_SERVER_URL}#/pip?data=${encodedContent}`);
        } else {
            pipWindow.loadFile(path.join(process.env.DIST || '', 'index.html'), {
                hash: `/pip?data=${encodedContent}`
            });
        }

        // Forward state updates from PiP to main window
        pipWindow.webContents.on('did-finish-load', () => {
            log.info('PiP window loaded');
        });

        pipWindow.on('closed', () => {
            pipWindow = null;
            // Notify main window that PiP was closed
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('pip:closed');
            }
        });

        return true;
    });

    // Close PiP window
    ipcMain.handle('pip:close', async () => {
        if (pipWindow && !pipWindow.isDestroyed()) {
            pipWindow.close();
            pipWindow = null;
        }
        currentPipContent = null;
        return true;
    });

    // Get current PiP state (if open)
    ipcMain.handle('pip:getState', async () => {
        if (pipWindow && !pipWindow.isDestroyed() && currentPipContent) {
            return {
                isOpen: true,
                content: currentPipContent
            };
        }
        return { isOpen: false, content: null };
    });

    // Close PiP and return its current state (for resuming in main player)
    ipcMain.handle('pip:close-and-get', async () => {
        let state = { isOpen: false, content: null as PipContent | null };
        if (pipWindow && !pipWindow.isDestroyed() && currentPipContent) {
            state = {
                isOpen: true,
                content: { ...currentPipContent }
            };
            pipWindow.close();
            pipWindow = null;
        }
        currentPipContent = null;
        return state;
    });

    // Forward control commands from main window to PiP
    ipcMain.on('pip:control', (_event, action: string, value?: number) => {
        if (pipWindow && !pipWindow.isDestroyed()) {
            pipWindow.webContents.send('pip:control', action, value);
        }
    });

    // Forward state updates from PiP to main window and keep currentTime synced
    ipcMain.on('pip:state', (_event, state: { playing: boolean; currentTime: number; duration: number }) => {
        // Update currentPipContent with latest time
        if (currentPipContent && state.currentTime) {
            currentPipContent.currentTime = state.currentTime;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pip:state', state);
        }
    });

    // Expand PiP to full player in main window
    ipcMain.handle('pip:expand', async (_event, content: PipContent) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            // Bring main window to front
            mainWindow.show();
            mainWindow.focus();
            // Send expand event to main window
            mainWindow.webContents.send('pip:expand', content);
        }
        // Close PiP window
        if (pipWindow && !pipWindow.isDestroyed()) {
            pipWindow.close();
            pipWindow = null;
        }
        return true;
    });

    // Get next episode info for auto-advance in PiP
    ipcMain.handle('pip:getNextEpisode', async (_event, data: { seriesId: string; currentSeason: number; currentEpisode: number }) => {
        log.info('[PiP Main] getNextEpisode request:', data);
        // Forward request to main window and wait for response
        if (mainWindow && !mainWindow.isDestroyed()) {
            return new Promise((resolve) => {
                const responseChannel = `pip:nextEpisodeResponse:${Date.now()}`;
                log.info('[PiP Main] Waiting for response on:', responseChannel);

                const handler = (_event: IpcMainEvent, response: unknown) => {
                    log.info('[PiP Main] Received response:', response);
                    ipcMain.removeListener(responseChannel, handler);
                    resolve(response);
                };

                ipcMain.once(responseChannel, handler);

                // Request next episode from main window
                mainWindow!.webContents.send('pip:requestNextEpisode', {
                    ...data,
                    responseChannel
                });

                // Timeout after 10 seconds
                setTimeout(() => {
                    log.info('[PiP Main] Timeout waiting for response');
                    ipcMain.removeListener(responseChannel, handler);
                    resolve(null);
                }, 10000);
            });
        }
        return null;
    });

    // Toggle click-through mode (mouse passes through PiP window)
    ipcMain.handle('pip:clickThrough', async (_event, enabled: boolean) => {
        clickThroughMode = enabled;
        if (pipWindow && !pipWindow.isDestroyed()) {
            pipWindow.setIgnoreMouseEvents(enabled, { forward: true });
            // Notify PiP window of state change
            pipWindow.webContents.send('pip:clickThroughChanged', enabled);
        }
        return clickThroughMode;
    });

    // Get click-through state
    ipcMain.handle('pip:getClickThrough', async () => {
        return clickThroughMode;
    });

    // Register F9 global shortcut
    globalShortcut.register('F9', () => {
        if (pipWindow && !pipWindow.isDestroyed()) {
            clickThroughMode = !clickThroughMode;
            pipWindow.setIgnoreMouseEvents(clickThroughMode, { forward: true });
            pipWindow.webContents.send('pip:clickThroughChanged', clickThroughMode);
        }
    });
}

export function closePipWindow() {
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.close();
        pipWindow = null;
    }
}
