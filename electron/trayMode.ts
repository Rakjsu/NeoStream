import { app, ipcMain, Tray, Menu, Notification, nativeImage, type BrowserWindow } from 'electron'
import path from 'path'
import Store from 'electron-store'
import log from './logger'

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

function buildTrayMenu(getWin: () => BrowserWindow | null) {
    if (!tray) return
    const config = getConfig()
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Abrir NeoStream', click: () => showWindow(getWin) },
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
        if (quitting || !getConfig().closeToTray) return
        e.preventDefault()
        win.hide()
        if (!balloonShown) {
            balloonShown = true
            new Notification({
                title: 'NeoStream continua rodando',
                body: 'Gravações agendadas e lembretes seguem ativos. Use a bandeja para sair de vez.',
            }).show()
        }
    })
}
