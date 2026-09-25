/**
 * Storage overview: how much disk the app's writable areas use, with cache
 * cleanup. Downloads and DVR files have their own management UIs — here they
 * are reported (and the folder can be opened), while the caches
 * (catalog.db / epg_cache) and the timeshift buffer can be cleared in
 * place.
 *
 * O cache do catálogo NÃO é uma pasta: desde o item 19 ele é o catalog.db
 * (+ WAL/SHM) no userData, e a pasta legada virou catalog-cache-backup. Quem
 * sabe onde ele mora e como esvaziá-lo é o próprio catalogCache (#D048).
 */

import { app, ipcMain, shell } from 'electron'
import path from 'node:path'
import fsp from 'node:fs/promises'
import log from './logger'
import { recordingsDir } from './dvrHandlers'
import { isTimeshiftRunning, timeshiftDir } from './timeshiftHandlers'
import { getErrorMessage } from './errorMessage'
import { catalogCacheDiskPaths, clearCatalogCache } from './catalogCache'

export type StorageArea = 'downloads' | 'recordings' | 'catalogCache' | 'epgCache' | 'timeshift'

/**
 * Áreas limpáveis por aqui. Downloads e DVR ficam DE FORA de propósito: o que
 * o usuário baixou ou gravou tem tela própria e não pode sumir num clique
 * perdido no meio do diagnóstico.
 *
 * `timeshift` entra porque é a única pasta grande SEM dono na interface: uma
 * janela de ~30 min de MPEG-TS do canal ao vivo, facilmente alguns GB, que
 * ninguém gerencia em lugar nenhum.
 */
const CLEARABLE: readonly StorageArea[] = ['catalogCache', 'epgCache', 'timeshift']

/**
 * Pasta de cada área que É uma pasta. O cache do catálogo fica de fora de
 * propósito (#D048): ele mora solto no userData (catalog.db + WAL/SHM), então
 * a "pasta" dele seria o userData inteiro — e um `fsp.rm` genérico nela
 * levaria downloads e gravações junto.
 */
type FolderArea = Exclude<StorageArea, 'catalogCache'>

function areaPath(area: FolderArea): string {
    switch (area) {
        case 'downloads': return path.join(app.getPath('userData'), 'downloads')
        case 'recordings': return recordingsDir()
        case 'epgCache': return path.join(app.getPath('userData'), 'epg_cache')
        case 'timeshift': return timeshiftDir()
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

/** Tamanho de um arquivo OU pasta; ausente conta 0. */
async function pathSize(target: string): Promise<number> {
    try {
        const info = await fsp.stat(target)
        if (info.isDirectory()) return await dirSize(target)
        return info.isFile() ? info.size : 0
    } catch {
        return 0
    }
}

async function areaSize(area: StorageArea): Promise<number> {
    if (area === 'catalogCache') {
        const sizes = await Promise.all(catalogCacheDiskPaths().map(pathSize))
        return sizes.reduce((total, size) => total + size, 0)
    }
    return dirSize(areaPath(area))
}

export function setupStorageManager() {
    ipcMain.handle('storage:usage', async () => {
        try {
            const areas: StorageArea[] = ['downloads', 'recordings', 'catalogCache', 'epgCache', 'timeshift']
            const sizes = await Promise.all(areas.map(async (area) => ({
                area,
                bytes: await areaSize(area)
            })))
            return { success: true, areas: sizes }
        } catch (error) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('storage:clear-cache', async (_e, { area }: { area?: StorageArea }) => {
        if (!area || !CLEARABLE.includes(area)) {
            return { success: false, error: 'area not clearable' }
        }
        // Apagar o buffer embaixo do ffmpeg que está gravando nele derruba o
        // que o usuário está assistindo — e no Windows nem apaga (o handle do
        // segmento aberto dá EBUSY). Quem está no ⏪ sai pelo "voltar ao vivo"
        // antes.
        if (area === 'timeshift' && isTimeshiftRunning()) {
            return { success: false, error: 'timeshift running' }
        }
        try {
            if (area === 'catalogCache') await clearCatalogCache()
            else await fsp.rm(areaPath(area), { recursive: true, force: true })
            log.info('[Storage] cleared', area)
            return { success: true }
        } catch (error) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('storage:open-area', async (_e, { area }: { area?: StorageArea }) => {
        if (!area) return { success: false }
        // O catálogo abre o userData, onde o catalog.db está. Antes abria (e
        // CRIAVA, pelo mkdir) a pasta legada catalog-cache vazia — que o boot
        // seguinte "migrava" por cima do backup da migração de verdade.
        if (area === 'catalogCache') {
            await shell.openPath(app.getPath('userData'))
            return { success: true }
        }
        const target = areaPath(area)
        await fsp.mkdir(target, { recursive: true }).catch(() => undefined)
        await shell.openPath(target)
        return { success: true }
    })
}
