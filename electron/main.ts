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
import { setupCastHandlers, teardownCast } from './castHandlers'
import { setupWebRemote, teardownWebRemote } from './webRemoteServer'
import { closeCatalogStore } from './catalogCache'
import { setupDownloadHandlers } from './downloadHandlers'
import { initializeAutoUpdater } from './autoUpdater'
import { setupPipHandlers } from './pipHandlers'
import { setupCertificateErrorHandler } from './certificatePolicy'
import { setupMpvHandlers } from './mpvPlayer'
import { setupNotifyHandlers } from './notifyHandlers'
import { setupDiagnosticsHandlers } from './diagnosticsHandlers'
import { setupDvrHandlers } from './dvrHandlers'
import { setupTimeshiftHandlers, teardownTimeshift } from './timeshiftHandlers'
import { setupTrayMode, attachCloseToTray } from './trayMode'
import { setupWinIntegration, routeFromArgv } from './winIntegration'
import { setupStorageManager } from './storageManager'
import { setupAutoBackup } from './autoBackup'
import { setupTranscoder } from './transcoder'
import { setupSyncFolder } from './syncFolder'
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
setupCastHandlers()
setupWebRemote()
app.on('before-quit', () => { teardownCast(); teardownWebRemote(); teardownTimeshift(); closeCatalogStore(); })
setupDownloadHandlers()
setupCertificateErrorHandler()
setupMpvHandlers() // EXPERIMENTAL — MPV PoC
setupDiagnosticsHandlers()
setupDvrHandlers()
setupTimeshiftHandlers()

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

// 🪟 Uma instância só: relançamentos (jump list / atalhos) chegam via
// second-instance e roteiam na instância viva em vez de abrir outra janela.
if (!app.requestSingleInstanceLock()) {
    app.quit()
}
app.on('second-instance', (_event, argv) => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    const route = routeFromArgv(argv)
    if (route) win.webContents.send('tray:navigate', route)
})

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

    // Close button hides to the tray (scheduled recordings/reminders keep
    // running) unless the user disabled it or is quitting via the tray menu.
    attachCloseToTray(win)

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

    // Tray icon + "start with Windows" + close-to-tray IPC.
    setupTrayMode(() => win)

    // 🪟 Jump list + progresso na taskbar + thumbar play/pause (Windows).
    setupWinIntegration(() => win)

    // Boot direto por um atalho da jump list: navega quando o renderer subir.
    const initialRoute = routeFromArgv(process.argv)
    if (initialRoute && win) {
        win.webContents.once('did-finish-load', () => {
            win?.webContents.send('tray:navigate', initialRoute)
        })
    }
    setupStorageManager()
    setupAutoBackup(() => win)
    setupTranscoder()
    setupSyncFolder(() => win)

    // Initialize auto-updater after window is created
    if (win) {
        initializeAutoUpdater(win)
        setupPipHandlers(win)
    }
})
