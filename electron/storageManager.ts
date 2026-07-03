/**
 * Storage overview: how much disk the app's writable areas use, with cache
 * cleanup. Downloads and DVR files have their own management UIs — here they
 * are reported (and the folder can be opened), while the caches
 * (catalog-cache / epg_cache) can be cleared in place.
 */

import { app, ipcMain, shell } from 'electron'
import path from 'node:path'
import fsp from 'node:fs/promises'
import log from './logger'
import { recordingsDir } from './dvrHandlers'

export type StorageArea = 'downloads' | 'recordings' | 'catalogCache' | 'epgCache'

function areaPath(area: StorageArea): string {
    switch (area) {
        case 'downloads': return path.join(app.getPath('userData'), 'downloads')
        case 'recordings': return recordingsDir()
        case 'catalogCache': return path.join(app.getPath('userData'), 'catalog-cache')
        case 'epgCache': return path.join(app.getPath('userData'), 'epg_cache')
    }
}

/** Recursive directory size in bytes; missing dirs count as 0. */
async function dirSize(dirPath: string): Promise<number> {
    let total = 0
    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true })
        for (const entry of entries) {
            const full = path.join(dirPath, entry.name)
            if (entry.isDirectory()) {
                total += await dirSize(full)
            } else if (entry.isFile()) {
                try {
                    total += (await fsp.stat(full)).size
                } catch { /* raced deletion */ }
            }
        }
    } catch { /* missing dir = 0 */ }
    return total
}

export function setupStorageManager() {
    ipcMain.handle('storage:usage', async () => {
        try {
            const areas: StorageArea[] = ['downloads', 'recordings', 'catalogCache', 'epgCache']
            const sizes = await Promise.all(areas.map(async (area) => ({
                area,
                bytes: await dirSize(areaPath(area))
            })))
            return { success: true, areas: sizes }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    // Only the cache areas are clearable here (downloads/DVR have their own UIs).
    ipcMain.handle('storage:clear-cache', async (_e, { area }: { area?: StorageArea }) => {
        if (area !== 'catalogCache' && area !== 'epgCache') {
            return { success: false, error: 'area not clearable' }
        }
        try {
            await fsp.rm(areaPath(area), { recursive: true, force: true })
            log.info('[Storage] cleared', area)
            return { success: true }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    ipcMain.handle('storage:open-area', async (_e, { area }: { area?: StorageArea }) => {
        if (!area) return { success: false }
        const target = areaPath(area)
        await fsp.mkdir(target, { recursive: true }).catch(() => undefined)
        await shell.openPath(target)
        return { success: true }
    })
}
