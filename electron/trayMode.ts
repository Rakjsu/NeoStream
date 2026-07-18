import { app, ipcMain, Tray, Menu, Notification, nativeImage, powerSaveBlocker, type BrowserWindow } from 'electron'
import path from 'path'
import Store from 'electron-store'
import log from './logger'
import { activeRecordingCount } from './dvrHandlers'
import { closeAction } from './trayClosePolicy'

/**
 * Tray mode: closing the window hides the app to the system tray instead of
 * quitting, so scheduled recordings and program reminders keep firing.
 * Optional "start with Windows" via setLoginItemSettings.
 */

interface SystemConfig {
    closeToTray: boolean
    openAtLogin: boolean
}

const store = new Store<{ system: SystemConfig }>({ name: 'system-config' })

const DEFAULTS: SystemConfig = { closeToTray: true, openAtLogin: false }

function getConfig(): SystemConfig {
    return { ...DEFAULTS, ...(store.get('system') as Partial<SystemConfig> | undefined) }
}

function setConfig(partial: Partial<SystemConfig>): SystemConfig {
    const next = { ...getConfig(), ...partial }
    store.set('system', next)
    return next
}

let tray: Tray | null = null
let quitting = false
let balloonShown = false

// Pending DVR schedules, mirrored from the renderer (protects quit-on-close).
let pendingSchedules = 0

// Last playback state reported by the renderer (drives the tray media items).
let mediaState = { hasMedia: false, playing: false, title: '' }

// 🖥️ Blocker que impede a tela de apagar durante a reprodução.
let displayBlockerId: number | null = null

function applyLoginItem(config: SystemConfig) {
    // Packaged only — in dev this would register the bare electron.exe.
    if (!app.isPackaged) return
    app.setLoginItemSettings({ openAtLogin: config.openAtLogin })
}

function showWindow(getWin: () => BrowserWindow | null) {
    const win = getWin()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
}

function sendToRenderer(getWin: () => BrowserWindow | null, channel: string, ...args: unknown[]) {
    const win = getWin()
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

function buildTrayMenu(getWin: () => BrowserWindow | null) {
    if (!tray) return
    const config = getConfig()
    const title = mediaState.title.length > 34 ? `${mediaState.title.slice(0, 33)}…` : mediaState.title
    const mediaItems: Electron.MenuItemConstructorOptions[] = mediaState.hasMedia
        ? [
            {
                label: mediaState.playing ? `⏸ Pausar — ${title}` : `▶ Reproduzir — ${title}`,
                click: () => sendToRenderer(getWin, 'media:control', 'togglePlay'),
            },
            {
                label: '⏹ Parar reprodução',
                click: () => sendToRenderer(getWin, 'media:control', 'stop'),
            },
            { type: 'separator' },
        ]
        : []
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Abrir NeoStream', click: () => showWindow(getWin) },
        ...mediaItems,
        {
            label: '⏺ Gravações',
            click: () => {
                showWindow(getWin)
                sendToRenderer(getWin, 'tray:navigate', '/dashboard/downloads')
            },
        },
        { type: 'separator' },
        {
            label: 'Fechar para a bandeja',
            type: 'checkbox',
            checked: config.closeToTray,
            click: (item) => { setConfig({ closeToTray: item.checked }) },
        },
        {
            label: 'Iniciar com o Windows',
            type: 'checkbox',
            checked: config.openAtLogin,
            enabled: app.isPackaged,
            click: (item) => { applyLoginItem(setConfig({ openAtLogin: item.checked })) },
        },
        { type: 'separator' },
        { label: 'Sair', click: () => { quitting = true; app.quit() } },
    ]))
}

export function isQuitting(): boolean {
    return quitting
}

export function setupTrayMode(getWin: () => BrowserWindow | null) {
    app.on('before-quit', () => { quitting = true })

    const iconPath = path.join(process.env.VITE_PUBLIC || '', 'neostream-logo.png')
    try {
        const icon = nativeImage.createFromPath(iconPath)
        tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }))
        tray.setToolTip('NeoStream IPTV')
        tray.on('double-click', () => showWindow(getWin))
        buildTrayMenu(getWin)
    } catch (err) {
        log.warn('[Tray] failed to create tray icon:', err)
    }

    applyLoginItem(getConfig())

    // Renderer reports player state; the tray menu mirrors it.
    ipcMain.on('media:state', (_e, state: { hasMedia?: boolean; playing?: boolean; title?: string }) => {
        mediaState = {
            hasMedia: state?.hasMedia === true,
            playing: state?.playing === true,
            title: typeof state?.title === 'string' ? state.title : '',
        }
        // Tela acesa enquanto toca; libera o blocker ao pausar/parar.
        if (mediaState.hasMedia && mediaState.playing) {
            if (displayBlockerId === null || !powerSaveBlocker.isStarted(displayBlockerId)) {
                displayBlockerId = powerSaveBlocker.start('prevent-display-sleep')
            }
        } else if (displayBlockerId !== null && powerSaveBlocker.isStarted(displayBlockerId)) {
            powerSaveBlocker.stop(displayBlockerId)
            displayBlockerId = null
        }
        // 📺 Tooltip da bandeja mostra o que está tocando agora.
        try {
            tray?.setToolTip(mediaState.hasMedia && mediaState.title
                ? `NeoStream — ${mediaState.title}`
                : 'NeoStream IPTV')
        } catch { /* tray pode não existir */ }
        buildTrayMenu(getWin)
    })

    // Renderer mirrors how many DVR schedules are pending.
    ipcMain.on('dvr:schedules-changed', (_e, raw: unknown) => {
        const count = Number(raw)
        pendingSchedules = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
    })

    ipcMain.handle('system:get-config', () => ({ success: true, config: getConfig() }))
    ipcMain.handle('system:set-config', (_e, partial: Partial<SystemConfig>) => {
        const next = setConfig(partial ?? {})
        applyLoginItem(next)
        buildTrayMenu(getWin)
        return { success: true, config: next }
    })

    log.info('[Tray] Tray mode initialized')
}

/**
 * Wire the window's close button: hide to tray instead of quitting when the
 * feature is on. Call once per window created.
 */
export function attachCloseToTray(win: BrowserWindow) {
    win.on('close', (e) => {
        const action = closeAction({
            quitting,
            closeToTray: getConfig().closeToTray,
            activeRecordings: activeRecordingCount(),
            pendingSchedules,
        })
        if (action === 'quit') return
        e.preventDefault()
        win.hide()
        if (action === 'hold') {
            // Close-to-tray is OFF, but the DVR still has work — tell why we stayed.
            new Notification({
                title: 'Gravação protegida',
                body: 'Há gravação em andamento ou agendada — o NeoStream segue na bandeja até terminar. Use a bandeja para sair de vez.',
            }).show()
            return
        }
        if (!balloonShown) {
            balloonShown = true
            new Notification({
                title: 'NeoStream continua rodando',
                body: 'Gravações agendadas e lembretes seguem ativos. Use a bandeja para sair de vez.',
            }).show()
        }
    })
}
