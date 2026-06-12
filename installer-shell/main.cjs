// NeoStream IPTV — Installer Shell (main process)
// Frameless Electron window with the app's visual language; the real install
// is the standard electron-builder NSIS setup running silently (/S /D=dir)
// as a child process, so electron-updater auto-update keeps working.
'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const IS_PREVIEW =
    process.argv.includes('--preview') ||
    process.env.NEOSTREAM_INSTALLER_PREVIEW === '1';

const APP_NAME = 'NeoStream IPTV';
const APP_EXE = 'NeoStream IPTV.exe';

let mainWindow = null;
let installing = false;
let lastInstallDir = defaultInstallDir();

function defaultInstallDir() {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    return path.join(programFiles, APP_NAME);
}

function payloadPath() {
    // Packaged: extraResources → <resources>/payload.exe
    // Dev (npm run dev:installer-shell): installer-shell/payload.exe if staged
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'payload.exe');
    }
    return path.join(__dirname, 'payload.exe');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 760,
        height: 500,
        useContentSize: true,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        center: true,
        frame: false,
        show: false,
        backgroundColor: '#0f0f1a',
        title: `Instalação do ${APP_NAME}`,
        icon: path.join(__dirname, 'renderer', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    mainWindow.removeMenu();
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ─── IPC ────────────────────────────────────────────────────────────────

ipcMain.handle('installer:get-info', () => ({
    version: app.getVersion(),
    defaultDir: defaultInstallDir(),
    preview: IS_PREVIEW,
}));

ipcMain.handle('installer:choose-dir', async (_event, currentDir) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Escolher pasta de instalação',
        defaultPath: currentDir || defaultInstallDir(),
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Selecionar',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    let dir = result.filePaths[0];
    // If the user picked a generic parent dir, install into a subfolder
    // named after the app (same behavior as the NSIS assisted installer).
    if (path.basename(dir).toLowerCase() !== APP_NAME.toLowerCase()) {
        dir = path.join(dir, APP_NAME);
    }
    return dir;
});

ipcMain.handle('installer:start', (_event, installDir) => {
    if (installing) return { started: false, reason: 'already-running' };
    installing = true;
    lastInstallDir = installDir || defaultInstallDir();

    const sendDone = (code) => {
        installing = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('installer:done', { code });
        }
    };

    if (IS_PREVIEW) {
        // Visual preview: simulate ~8s of install, no child process.
        setTimeout(() => sendDone(0), 8000);
        return { started: true, preview: true };
    }

    const setup = payloadPath();
    if (!fs.existsSync(setup)) {
        installing = false;
        return { started: false, reason: 'payload-missing', payload: setup };
    }

    try {
        // NSIS silent install. /D= must be the LAST argument and must NOT be
        // quoted (everything after "/D=" up to end of line is the directory),
        // hence windowsVerbatimArguments with a single pre-joined string.
        const child = spawn(setup, [`/S /D=${lastInstallDir}`], {
            windowsVerbatimArguments: true,
            detached: false,
            stdio: 'ignore',
        });
        child.on('error', () => sendDone(-1));
        child.on('exit', (code) => sendDone(code === null ? -1 : code));
        return { started: true };
    } catch {
        installing = false;
        return { started: false, reason: 'spawn-failed' };
    }
});

ipcMain.handle('installer:launch-app', () => {
    if (IS_PREVIEW) return true;
    const exe = path.join(lastInstallDir, APP_EXE);
    if (!fs.existsSync(exe)) return false;
    // The shell runs elevated; launching through explorer.exe makes Windows
    // start the app de-elevated (as the interactive user). explorer.exe may
    // exit with a non-zero code even on success — ignore it.
    try {
        spawn('explorer.exe', [exe], { detached: true, stdio: 'ignore' }).unref();
        return true;
    } catch {
        return false;
    }
});

ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
});

ipcMain.handle('window:close', () => {
    app.quit();
});

// ─── Lifecycle ──────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
    app.whenReady().then(createWindow);
    app.on('window-all-closed', () => app.quit());
}
