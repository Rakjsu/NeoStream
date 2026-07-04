/**
 * Multi-machine sync over a user-chosen synced folder (Dropbox/Drive/etc).
 *
 * Each machine owns one file, `neostream-sync-<machineId>.json`, holding the
 * same payload as the backup export. A cycle is: main reads the OTHER
 * machines' files and hands them to the renderer ('sync:apply-remote') → the
 * renderer merges them into localStorage (src/services/syncMerge.ts), then
 * collects a fresh payload and invokes 'sync:save' → main rewrites our file.
 * Cycles run shortly after boot and every 30 minutes while enabled.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import Store from 'electron-store'
import log from './logger'

interface SyncFolderConfig {
    enabled: boolean
    dirPath: string
    machineId: string
    lastSyncAt: number
}

export interface RemoteSyncFile {
    machineId: string
    json: string
}

const store = new Store<{ syncFolder: SyncFolderConfig }>({ name: 'sync-folder' })

const FILE_PREFIX = 'neostream-sync-'
const CYCLE_EVERY_MS = 30 * 60 * 1000
const BOOT_DELAY_MS = 20 * 1000

function newMachineId(): string {
    const host = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'maquina'
    const suffix = Math.random().toString(36).slice(2, 6)
    return `${host}-${suffix}`
}

function getConfig(): SyncFolderConfig {
    const saved = store.get('syncFolder') as Partial<SyncFolderConfig> | undefined
    const config: SyncFolderConfig = {
        enabled: false,
        dirPath: '',
        machineId: '',
        lastSyncAt: 0,
        ...saved,
    }
    if (!config.machineId) {
        config.machineId = newMachineId()
        store.set('syncFolder', config)
    }
    return config
}

function setConfig(partial: Partial<SyncFolderConfig>): SyncFolderConfig {
    const next = { ...getConfig(), ...partial }
    store.set('syncFolder', next)
    return next
}

/** Parse `neostream-sync-<machineId>.json` → machineId, or null. */
export function machineIdFromFileName(name: string): string | null {
    if (!name.startsWith(FILE_PREFIX) || !name.endsWith('.json')) return null
    const id = name.slice(FILE_PREFIX.length, -'.json'.length)
    return id ? id : null
}

async function readRemoteFiles(config: SyncFolderConfig): Promise<RemoteSyncFile[]> {
    const files: RemoteSyncFile[] = []
    const entries = await fsp.readdir(config.dirPath)
    for (const name of entries) {
        const machineId = machineIdFromFileName(name)
        if (!machineId || machineId === config.machineId) continue
        try {
            const json = await fsp.readFile(path.join(config.dirPath, name), 'utf-8')
            files.push({ machineId, json })
        } catch (error) {
            log.warn('[Sync] read failed for', name, error)
        }
    }
    return files
}

export function setupSyncFolder(getWin: () => BrowserWindow | null) {
    const startCycle = () => {
        const config = getConfig()
        if (!config.enabled || !config.dirPath) return
        const win = getWin()
        if (!win || win.isDestroyed()) return
        void readRemoteFiles(config)
            .then(files => {
                win.webContents.send('sync:apply-remote', { files })
            })
            .catch(error => log.warn('[Sync] cycle read failed:', error))
    }

    ipcMain.handle('sync:config-get', () => ({ success: true, config: getConfig() }))

    ipcMain.handle('sync:config-set', (_e, partial: { enabled?: boolean }) => {
        const next = setConfig({ enabled: partial?.enabled === true })
        if (next.enabled) startCycle()
        return { success: true, config: next }
    })

    ipcMain.handle('sync:choose-dir', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Pasta sincronizada entre máquinas',
            defaultPath: app.getPath('documents'),
            properties: ['openDirectory', 'createDirectory'],
        })
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true }
        }
        const config = setConfig({ dirPath: result.filePaths[0] })
        return { success: true, config }
    })

    ipcMain.handle('sync:run-now', () => {
        startCycle()
        return { success: true }
    })

    // Renderer hands back the merged payload; main writes our machine's file.
    ipcMain.handle('sync:save', async (_e, { json }: { json: string }) => {
        try {
            const config = getConfig()
            if (!config.enabled || !config.dirPath) return { success: false, error: 'sync disabled' }
            await fsp.mkdir(config.dirPath, { recursive: true })
            const filePath = path.join(config.dirPath, `${FILE_PREFIX}${config.machineId}.json`)
            await fsp.writeFile(filePath, json, 'utf-8')
            const next = setConfig({ lastSyncAt: Date.now() })
            log.info('[Sync] saved', filePath)
            return { success: true, path: filePath, config: next }
        } catch (error) {
            log.error('[Sync] save failed:', error)
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    setTimeout(startCycle, BOOT_DELAY_MS)
    setInterval(startCycle, CYCLE_EVERY_MS)

    log.info('[Sync] folder sync initialized')
}
