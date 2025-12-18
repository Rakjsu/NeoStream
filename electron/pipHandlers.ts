/**
 * PiP (Picture-in-Picture) Window Handlers
 * Manages IPC communication for the independent PiP window
 */

import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pipWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;

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

export function setupPipHandlers(mainWin: BrowserWindow) {
    mainWindow = mainWin;

    // Open PiP window
    ipcMain.handle('pip:open', async (_event, content: PipContent) => {
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
            webPreferences: {
                preload: path.join(__dirname, 'preload.mjs'),
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: false,
            },
        });

        // Position in bottom-right corner of screen
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        pipWindow.setPosition(screenWidth - 420, screenHeight - 280);

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
            console.log('PiP window loaded');
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
        return true;
    });

    // Forward control commands from main window to PiP
    ipcMain.on('pip:control', (_event, action: string, value?: number) => {
        if (pipWindow && !pipWindow.isDestroyed()) {
            pipWindow.webContents.send('pip:control', action, value);
        }
    });

    // Forward state updates from PiP to main window
    ipcMain.on('pip:state', (_event, state: { playing: boolean; currentTime: number; duration: number }) => {
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
}

export function closePipWindow() {
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.close();
        pipWindow = null;
    }
}
