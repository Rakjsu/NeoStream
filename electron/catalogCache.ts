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

const ALL_KINDS: CatalogKind[] = [
    'live', 'vod', 'series', 'live-categories', 'vod-categories', 'series-categories',
]

interface CacheEntry {
    fetchedAt: number
    data: unknown
}

// In-memory layer over the disk backend (SQLite, or legacy JSON files).
//
// 🚀 R5: a camada só guarda os seis kinds da playlist RESIDENTE. Antes ela
// crescia por playlist e só era limpa na REMOÇÃO da playlist ou no quit — quem
// alternava entre duas contas ficava com duas listas de 50 mil itens presas no
// main (medimos 34 MB por cópia de VOD). Trocar de playlist agora devolve a
// cópia antiga; o catalog.db recarrega em ~67 ms se o usuário voltar.
const memory = new Map<string, CacheEntry>()
let residentPlaylistId: string | null = null

/**
 * Chaves cuja cópia em DISCO já existe. Só estas podem sair da memória: o SWR
 * serve o cache velho quando o provedor cai, e despejar uma entrada cuja
 * gravação ainda está em voo (o `setImmediate` do writeEntry, ou o writeFile do
 * fallback JSON) apagaria a única cópia — é assim que "a lista some".
 */
const persisted = new Set<string>()

/** Despeja as chaves de outras playlists que já estão salvas em disco. */
function keepMemoryScopedTo(playlistId: string): void {
    if (residentPlaylistId === playlistId) return
    residentPlaylistId = playlistId
    const manter = new Set(ALL_KINDS.map(kind => keyOf(playlistId, kind)))
    for (const key of [...memory.keys()]) {
        if (!manter.has(key) && persisted.has(key)) memory.delete(key)
    }
}

/** Gravação concluída: a partir daqui a entrada pode ser despejada. */
function markPersisted(playlistId: string, key: string): void {
    persisted.add(key)
    if (residentPlaylistId !== playlistId) memory.delete(key)
}

/** Chaves vivas na camada de memória (exportado para os testes). */
export function catalogMemoryKeys(): string[] {
    return [...memory.keys()]
}

/**
 * Requisições em voo por (playlist, kind). Sem isto, os seis `cachedCatalogFetch`
 * que o Ctrl+K dispara em paralelo com o cache vencido viravam seis downloads +
 * seis parses + seis gravações da MESMA lista (o pior caso é a M3U, que ainda
 * paga um download inteiro por kind).
 */
const inFlight = new Map<string, Promise<{ data: unknown; fromCache: boolean }>>()

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
    residentPlaylistId = null
    persisted.clear()
    inFlight.clear()
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
    keepMemoryScopedTo(playlistId)
    const key = keyOf(playlistId, kind)
    const inMemory = memory.get(key)
    if (inMemory) return inMemory
    const store = getStore()
    if (store) {
        const row = store.read(key)
        if (!row) return null
        memory.set(key, row)
        persisted.add(key) // veio do disco: o disco tem
        return row
    }
    // Fallback legado: JSON por chave (mesmo comportamento de sempre).
    try {
        const raw = fs.readFileSync(fileOf(key), 'utf-8')
        const parsed = JSON.parse(raw) as CacheEntry
        if (typeof parsed?.fetchedAt !== 'number' || !('data' in parsed)) return null
        memory.set(key, parsed)
        persisted.add(key)
        return parsed
    } catch {
        return null
    }
}

function writeEntry(playlistId: string, kind: CatalogKind, data: unknown): void {
    keepMemoryScopedTo(playlistId)
    const key = keyOf(playlistId, kind)
    const entry: CacheEntry = { fetchedAt: Date.now(), data }
    memory.set(key, entry)
    // A cópia em disco anterior ficou velha: só volta a valer quando a nova
    // gravação terminar (até lá esta entrada não pode ser despejada).
    persisted.delete(key)
    const store = getStore()
    if (store) {
        // Fora do caminho da resposta (mesmo espírito do write-behind).
        setImmediate(() => {
            store.write(key, entry)
            markPersisted(playlistId, key)
        })
        return
    }
    // Write-behind: the response never waits for the disk.
    void fsp.mkdir(cacheDir(), { recursive: true })
        .then(() => fsp.writeFile(fileOf(key), JSON.stringify(entry), 'utf-8'))
        .then(() => markPersisted(playlistId, key))
        .catch((error) => log.warn('[CatalogCache] write failed:', error))
}

/** Descrição curta do que veio no lugar da lista, pro log/erro ficar acionável. */
function describeShape(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'string') {
        const head = value.trim().slice(0, 40)
        return `string ("${head}${value.length > 40 ? '…' : ''}")`
    }
    if (typeof value === 'object') {
        const keys = Object.keys(value as Record<string, unknown>).slice(0, 4)
        return `objeto {${keys.join(', ')}${keys.length === 4 ? ', …' : ''}}`
    }
    return typeof value
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

    // Só um fetch por (playlist, kind) de cada vez — quem chega no meio pega a
    // MESMA promessa. Vale inclusive para `forceRefresh`: a busca em voo já é
    // uma ida ao provedor, então repetir só duplicaria download, parse e escrita.
    const key = keyOf(playlistId, kind)
    const running = inFlight.get(key)
    if (running) return running

    const promise = runCatalogFetch(playlistId, kind, fetcher, cached)
        .finally(() => {
            if (inFlight.get(key) === promise) inFlight.delete(key)
        })
    inFlight.set(key, promise)
    return promise
}

async function runCatalogFetch(
    playlistId: string,
    kind: CatalogKind,
    fetcher: () => Promise<unknown>,
    cached: CacheEntry | null
): Promise<{ data: unknown; fromCache: boolean }> {
    try {
        const data = await fetcher()
        // 🛡️ Todo `kind` de catálogo é uma LISTA. Provedor com conta expirada,
        // senha trocada, domínio estacionado ou portal cativo responde 200 com
        // objeto/HTML — e o XtreamClient só rejeita status ≠ 200. Gravar isso
        // envenenava o cache por 15 min (sobrevivendo a restart) e o `.filter()`
        // do renderer estourava DENTRO do render, trocando Home/Filmes/Séries/TV
        // pela tela de erro. Tratar como falha faz o SWR servir o cache bom.
        if (!Array.isArray(data)) {
            throw new Error(
                `resposta inválida do provedor para "${kind}": esperava lista, veio ${describeShape(data)}`
            )
        }
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
    for (const kind of ALL_KINDS) {
        const key = keyOf(playlistId, kind)
        memory.delete(key)
        persisted.delete(key)
        // Uma busca em voo desta playlist ainda gravaria por cima depois do
        // invalidate — tirar do mapa faz a próxima chamada começar do zero.
        inFlight.delete(key)
        getStore()?.remove(key)
        // JSON legado some junto mesmo no backend SQLite (higiene do fallback).
        void fsp.rm(fileOf(key), { force: true }).catch(() => undefined)
    }
}
