/**
 * Disk-backed catalog cache (main process) — stale-while-revalidate for the
 * six Xtream list endpoints. Keyed by (playlistId, kind) so switching
 * playlists never bleeds data and switching BACK is instant.
 *
 * Policy (see cachedCatalogFetch):
 *   - fresh cache (< TTL)      → serve cache, no network
 *   - stale cache / no cache   → fetch provider, update cache
 *   - provider fetch fails     → serve stale cache if any (resilience)
 */

import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import log from './logger'
import { openCatalogStore, type CatalogStore } from './catalogDb'

export const CATALOG_CACHE_TTL_MS = 15 * 60 * 1000

export type CatalogKind =
    | 'live' | 'vod' | 'series'
    | 'live-categories' | 'vod-categories' | 'series-categories'

interface CacheEntry {
    fetchedAt: number
    data: unknown
}

// In-memory layer over the disk backend (SQLite, or legacy JSON files).
const memory = new Map<string, CacheEntry>()

function cacheDir(): string {
    return path.join(app.getPath('userData'), 'catalog-cache')
}

// 💾 Item 19: backend em SQLite (catalog.db). Lazy: o primeiro acesso abre o
// DB e migra os JSONs legados (que viram catalog-cache-backup). Qualquer erro
// → null e TUDO abaixo continua nos JSONs de sempre (rollback automático).
let sqliteStore: CatalogStore | null | undefined
function getStore(): CatalogStore | null {
    if (sqliteStore !== undefined) return sqliteStore
    sqliteStore = openCatalogStore(
        path.join(app.getPath('userData'), 'catalog.db'),
        cacheDir(),
        (message) => log.warn('[CatalogCache]', message),
    )
    if (sqliteStore) log.info('[CatalogCache] backend SQLite ativo (catalog.db)')
    else log.warn('[CatalogCache] backend SQLite indisponível — seguindo nos JSONs')
    return sqliteStore
}

/** Fecha o catalog.db (chamado no quit) e zera o estado do módulo. */
export function closeCatalogStore(): void {
    sqliteStore?.close()
    sqliteStore = undefined
    memory.clear()
}

function keyOf(playlistId: string, kind: CatalogKind): string {
    // Playlist ids are internal (createPlaylistId) but sanitize defensively.
    return `${playlistId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${kind}`
}

function fileOf(key: string): string {
    return path.join(cacheDir(), `${key}.json`)
}

/** Pure-ish freshness check (exported for tests). */
export function isFresh(fetchedAt: number, nowMs: number, ttlMs: number = CATALOG_CACHE_TTL_MS): boolean {
    return nowMs - fetchedAt < ttlMs
}

function readEntry(playlistId: string, kind: CatalogKind): CacheEntry | null {
    const key = keyOf(playlistId, kind)
    const inMemory = memory.get(key)
    if (inMemory) return inMemory
    const store = getStore()
    if (store) {
        const row = store.read(key)
        if (!row) return null
        memory.set(key, row)
        return row
    }
    // Fallback legado: JSON por chave (mesmo comportamento de sempre).
    try {
        const raw = fs.readFileSync(fileOf(key), 'utf-8')
        const parsed = JSON.parse(raw) as CacheEntry
        if (typeof parsed?.fetchedAt !== 'number' || !('data' in parsed)) return null
        memory.set(key, parsed)
        return parsed
    } catch {
        return null
    }
}

function writeEntry(playlistId: string, kind: CatalogKind, data: unknown): void {
    const key = keyOf(playlistId, kind)
    const entry: CacheEntry = { fetchedAt: Date.now(), data }
    memory.set(key, entry)
    const store = getStore()
    if (store) {
        // Fora do caminho da resposta (mesmo espírito do write-behind).
        setImmediate(() => store.write(key, entry))
        return
    }
    // Write-behind: the response never waits for the disk.
    void fsp.mkdir(cacheDir(), { recursive: true })
        .then(() => fsp.writeFile(fileOf(key), JSON.stringify(entry), 'utf-8'))
        .catch((error) => log.warn('[CatalogCache] write failed:', error))
}

/**
 * SWR wrapper used by the streams:/categories: handlers.
 * `forceRefresh` bypasses freshness (renderer auto-refresh / pull-to-refresh).
 */
export async function cachedCatalogFetch(
    playlistId: string,
    kind: CatalogKind,
    fetcher: () => Promise<unknown>,
    forceRefresh: boolean = false
): Promise<{ data: unknown; fromCache: boolean }> {
    const cached = readEntry(playlistId, kind)

    if (cached && !forceRefresh && isFresh(cached.fetchedAt, Date.now())) {
        return { data: cached.data, fromCache: true }
    }

    try {
        const data = await fetcher()
        writeEntry(playlistId, kind, data)
        return { data, fromCache: false }
    } catch (error) {
        if (cached) {
            log.warn(`[CatalogCache] provider fetch failed for ${kind} — serving stale cache:`,
                error instanceof Error ? error.message : String(error))
            return { data: cached.data, fromCache: true }
        }
        throw error
    }
}

/** Drop everything for one playlist (e.g. after it is removed). */
export function invalidatePlaylistCache(playlistId: string): void {
    for (const kind of ['live', 'vod', 'series', 'live-categories', 'vod-categories', 'series-categories'] as CatalogKind[]) {
        const key = keyOf(playlistId, kind)
        memory.delete(key)
        getStore()?.remove(key)
        // JSON legado some junto mesmo no backend SQLite (higiene do fallback).
        void fsp.rm(fileOf(key), { force: true }).catch(() => undefined)
    }
}
