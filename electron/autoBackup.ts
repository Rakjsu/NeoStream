/**
 * Scheduled automatic backups (main process, works with the app in the tray).
 *
 * The backup PAYLOAD lives in the renderer (localStorage + playlists), so the
 * flow is a round trip: the hourly clock decides a backup is due → main asks
 * the renderer ('backup:auto-collect') → the renderer builds the same payload
 * as the manual export and hands it back ('backup:auto-save') → main writes
 * `neostream-backup-YYYY-MM-DD.json` into the chosen folder and prunes old
 * files (keeps the newest KEEP_FILES).
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import Store from 'electron-store'
import log from './logger'

interface AutoBackupConfig {
    enabled: boolean
    dirPath: string
    intervalDays: number
    lastBackupAt: number
}

const store = new Store<{ autoBackup: AutoBackupConfig }>({ name: 'auto-backup' })

const DEFAULTS: AutoBackupConfig = { enabled: false, dirPath: '', intervalDays: 7, lastBackupAt: 0 }
const CHECK_EVERY_MS = 60 * 60 * 1000
const KEEP_FILES = 8
const FILE_PREFIX = 'neostream-backup-'

function getConfig(): AutoBackupConfig {
    return { ...DEFAULTS, ...(store.get('autoBackup') as Partial<AutoBackupConfig> | undefined) }
}

function setConfig(partial: Partial<AutoBackupConfig>): AutoBackupConfig {
    const next = { ...getConfig(), ...partial }
    store.set('autoBackup', next)
    return next
}

/** Pure-ish: is a backup due? (exported for tests via protocol split not needed — trivial) */
export function isBackupDue(config: AutoBackupConfig, nowMs: number): boolean {
    if (!config.enabled || !config.dirPath) return false
    return nowMs - config.lastBackupAt >= config.intervalDays * 24 * 3600_000
}

/**
 * ☁️ Pastas locais dos provedores de nuvem instalados (o cliente de sync do
 * provedor faz o upload sozinho — o app só grava o arquivo lá dentro).
 */
export function detectCloudDirs(): { provider: string; path: string }[] {
    const home = app.getPath('home')
    const candidates = [
        { provider: 'OneDrive', path: process.env.OneDrive || path.join(home, 'OneDrive') },
        { provider: 'Dropbox', path: path.join(home, 'Dropbox') },
        { provider: 'Google Drive', path: path.join(home, 'Google Drive') },
    ]
    return candidates.filter(c => {
        try { return fs.existsSync(c.path) } catch { return false }
    })
}

async function pruneOldBackups(dirPath: string): Promise<void> {
    try {
        const entries = await fsp.readdir(dirPath)
        const backups = entries
            .filter(name => name.startsWith(FILE_PREFIX) && name.endsWith('.json'))
            .sort() // date-stamped names sort chronologically
        const doomed = backups.slice(0, Math.max(0, backups.length - KEEP_FILES))
        for (const name of doomed) {
            await fsp.rm(path.join(dirPath, name), { force: true })
        }
    } catch (error) {
        log.warn('[AutoBackup] prune failed:', error)
    }
}

export function setupAutoBackup(getWin: () => BrowserWindow | null) {
    ipcMain.handle('backup:auto-config-get', () => ({ success: true, config: getConfig() }))

    ipcMain.handle('backup:auto-config-set', (_e, partial: Partial<AutoBackupConfig>) => {
        const next = setConfig({
            enabled: partial?.enabled === true,
            ...(typeof partial?.dirPath === 'string' ? { dirPath: partial.dirPath } : {})
        })
        return { success: true, config: next }
    })

    ipcMain.handle('backup:cloud-dirs', () => ({ success: true, dirs: detectCloudDirs() }))

    // Atalho "salvar na nuvem": subpasta própria na pasta sincronizada + liga o auto-backup.
    ipcMain.handle('backup:cloud-use', (_e, { dirPath }: { dirPath: string }) => {
        const valid = detectCloudDirs().some(c => c.path === dirPath)
        if (!valid) return { success: false, error: 'unknown cloud dir' }
        const config = setConfig({ dirPath: path.join(dirPath, 'NeoStream Backups'), enabled: true })
        return { success: true, config }
    })

    ipcMain.handle('backup:choose-dir', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Pasta dos backups automáticos',
            defaultPath: app.getPath('documents'),
            properties: ['openDirectory', 'createDirectory']
        })
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true }
        }
        const config = setConfig({ dirPath: result.filePaths[0] })
        return { success: true, config }
    })

    // Renderer hands back the collected payload; main writes + prunes.
    ipcMain.handle('backup:auto-save', async (_e, { json }: { json: string }) => {
        try {
            const config = getConfig()
            if (!config.dirPath) return { success: false, error: 'no dirPath' }
            await fsp.mkdir(config.dirPath, { recursive: true })
            const date = new Date().toISOString().slice(0, 10)
            const filePath = path.join(config.dirPath, `${FILE_PREFIX}${date}.json`)
            await fsp.writeFile(filePath, json, 'utf-8')
            setConfig({ lastBackupAt: Date.now() })
            await pruneOldBackups(config.dirPath)
            log.info('[AutoBackup] saved', filePath)
            return { success: true, path: filePath }
        } catch (error) {
            log.error('[AutoBackup] save failed:', error)
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    // Hourly clock: when due, ask the renderer to collect the payload.
    setInterval(() => {
        if (!isBackupDue(getConfig(), Date.now())) return
        const win = getWin()
        if (win && !win.isDestroyed()) {
            win.webContents.send('backup:auto-collect')
        }
    }, CHECK_EVERY_MS)

    log.info('[AutoBackup] initialized')
}
