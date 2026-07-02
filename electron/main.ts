// Keep this first: redirects userData when the Playwright E2E suite is
// driving the app (no-op otherwise). See electron/e2eUserData.ts.
import './e2eUserData'
import { app, BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import log from './logger'
import { setupIpcHandlers } from './ipcHandlers'

log.info('NeoStream main process starting')
import { setupDLNAHandlers } from './dlnaHandlers'
import { setupAirPlayHandlers } from './airplayHandlers'
import { setupDownloadHandlers } from './downloadHandlers'
import { initializeAutoUpdater } from './autoUpdater'
import { setupPipHandlers } from './pipHandlers'
import { setupCertificateErrorHandler } from './certificatePolicy'
import { setupMpvHandlers } from './mpvPlayer'
import { setupNotifyHandlers } from './notifyHandlers'
import { setupDiagnosticsHandlers } from './diagnosticsHandlers'
import { setupDvrHandlers } from './dvrHandlers'
import { setupYouTubeEmbedFix } from './youtubeEmbedFix'

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Enable Hardware Acceleration and HEVC
app.commandLine.appendSwitch('ignore-gpu-blacklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder') // Linux/Mac mostly, but good to have
// Windows HEVC support relies on OS extensions, but we can try to force some flags if needed.

setupIpcHandlers()
setupDLNAHandlers()
setupAirPlayHandlers()
setupDownloadHandlers()
setupCertificateErrorHandler()
setupMpvHandlers() // EXPERIMENTAL — MPV PoC
setupDiagnosticsHandlers()
setupDvrHandlers()

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

// Native notifications (program reminders) — needs the window for click-focus.
setupNotifyHandlers(() => win)

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(process.env.VITE_PUBLIC || '', 'neostream-logo.png'),
        backgroundColor: '#0f0f23',
        frame: false, // Frameless window for custom title bar
        maximizable: false, // Disable native maximize to prevent taskbar overlap
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
        },
    })

    // YouTube trailer embeds throw "Erro 153" from the packaged file:// origin
    // because they lack a valid Referer/Origin. Inject one for YouTube hosts so
    // both the "Ver Trailer" modal and the hover preview play inline.
    setupYouTubeEmbedFix(win.webContents.session)

    // Prevent any native maximize attempts (Win+Up, etc.)
    win.on('maximize', () => {
        win?.unmaximize()
    })

    // Test active push message to Renderer-process.
    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString())
    })

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL)
    } else {
        win.loadFile(path.join(process.env.DIST || '', 'index.html'))
    }
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
        win = null
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(() => {
    createWindow()

    // Initialize auto-updater after window is created
    if (win) {
        initializeAutoUpdater(win)
        setupPipHandlers(win)
    }
})
