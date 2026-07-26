/**
 * Multi-playlist manager — store-backed side of playlistsModel.ts.
 *
 * Owns every write to `playlists` / `activePlaylistId` and keeps the legacy
 * `auth` entry mirroring the ACTIVE playlist so auth:check, streams:*,
 * certificatePolicy and providerEpg keep working without changes.
 */
import store from './store'
import log from './logger'
import {
    migrateAuthToPlaylists,
    removePlaylistById,
    renamePlaylist,
    toPublicPlaylist,
    upsertPlaylist,
} from './playlistsModel'
import type { PlaylistEntry, PublicPlaylist, UpsertInput } from './playlistsModel'

function getPlaylists(): PlaylistEntry[] {
    const playlists = store.get('playlists')
    return Array.isArray(playlists) ? playlists : []
}

function getActivePlaylistId(): string | undefined {
    return store.get('activePlaylistId')
}

/** Public read of the active playlist id (renderer scopes per-playlist user-state by it). */
export function getActivePlaylistIdPublic(): string | null {
    return getActivePlaylistId() ?? null
}

/** Point the legacy `auth` mirror at one playlist (or clear it). */
function mirrorAuth(entry: PlaylistEntry | null) {
    if (entry) {
        store.set('auth', {
            url: entry.url,
            username: entry.username,
            password: entry.password,
            userInfo: entry.userInfo
        })
    } else {
        store.set('auth', {})
    }
}

/** Run once on startup: legacy single `auth` → playlists[0] (active). */
export function migratePlaylistsOnStartup() {
    const result = migrateAuthToPlaylists(store.get('auth'), getPlaylists(), getActivePlaylistId())
    if (!result.changed) return

    store.set('playlists', result.playlists)
    if (result.activePlaylistId) {
        store.set('activePlaylistId', result.activePlaylistId)
        const active = result.playlists.find(p => p.id === result.activePlaylistId)
        if (active) mirrorAuth(active)
    } else {
        store.delete('activePlaylistId')
    }
    log.info('[Playlists] Migrated store to multi-playlist model:',
        result.playlists.length, 'playlist(s), active:', result.activePlaylistId ?? 'none')
}

export function listPublicPlaylists(): PublicPlaylist[] {
    const activeId = getActivePlaylistId()
    return getPlaylists().map(p => toPublicPlaylist(p, activeId))
}

export function findPlaylist(id: string): PlaylistEntry | undefined {
    return getPlaylists().find(p => p.id === id)
}

/**
 * Save (or update) a playlist with already-validated credentials and make it
 * the active one. Single write path used by auth:login and playlists:add.
 */
export function saveAndActivatePlaylist(input: UpsertInput): PlaylistEntry {
    const { playlists, entry } = upsertPlaylist(getPlaylists(), input)
    // Re-adicionar à mão é intenção nova: sai do ledger de apagadas, senão a
    // própria playlist ficaria bloqueada pro sync por 30 dias.
    clearRemovedPlaylist(input.url, input.username)
    store.set('playlists', playlists)
    store.set('activePlaylistId', entry.id)
    mirrorAuth(entry)
    return entry
}

/** Make a saved playlist active (credentials already revalidated by caller). */
export function activatePlaylist(id: string, userInfo?: unknown): PlaylistEntry | null {
    const playlists = getPlaylists()
    const entry = playlists.find(p => p.id === id)
    if (!entry) return null

    const updated: PlaylistEntry = userInfo !== undefined ? { ...entry, userInfo } : entry
    if (userInfo !== undefined) {
        store.set('playlists', playlists.map(p => (p.id === id ? updated : p)))
    }
    store.set('activePlaylistId', id)
    mirrorAuth(updated)
    return updated
}

export interface RemovePlaylistOutcome {
    removed: boolean
    /** Playlist that became active as fallback, if the active one was removed. */
    newActive: PlaylistEntry | null
    /** True when the removal logged the app out (no playlists remain). */
    loggedOut: boolean
    activeChanged: boolean
}

/** TTL do ledger de playlists apagadas — mesma janela dos tombstones do renderer. */
export const REMOVED_PLAYLIST_TTL_MS = 30 * 24 * 3600_000

/** Chave estável de uma playlist no ledger (credencial identifica a entrada). */
export function removedPlaylistKey(url: string, username: string): string {
    return `${url.trim()}|${username.trim()}`
}

/** Ledger podado (entradas velhas saem para não bloquear re-adição pra sempre). */
export function getRemovedPlaylists(nowMs: number = Date.now()): Record<string, number> {
    const raw = store.get('removedPlaylists') ?? {}
    const alive: Record<string, number> = {}
    for (const [key, at] of Object.entries(raw)) {
        if (typeof at === 'number' && nowMs - at < REMOVED_PLAYLIST_TTL_MS) alive[key] = at
    }
    return alive
}

/** Marca a playlist como apagada de propósito (o sync não pode ressuscitá-la). */
function recordRemovedPlaylist(entry: { url: string; username: string }): void {
    const ledger = getRemovedPlaylists()
    ledger[removedPlaylistKey(entry.url, entry.username)] = Date.now()
    store.set('removedPlaylists', ledger)
}

/** Re-adicionar manualmente limpa o tombstone (intenção nova do usuário). */
export function clearRemovedPlaylist(url: string, username: string): void {
    const ledger = getRemovedPlaylists()
    if (delete ledger[removedPlaylistKey(url, username)]) store.set('removedPlaylists', ledger)
}

export function removePlaylist(id: string): RemovePlaylistOutcome {
    const antes = getPlaylists().find(p => p.id === id)
    const result = removePlaylistById(getPlaylists(), id, getActivePlaylistId())
    if (!result.removed) {
        return { removed: false, newActive: null, loggedOut: false, activeChanged: false }
    }

    if (antes) recordRemovedPlaylist(antes)
    store.set('playlists', result.playlists)

    if (!result.activeChanged) {
        return { removed: true, newActive: null, loggedOut: false, activeChanged: false }
    }

    if (result.activePlaylistId) {
        const newActive = result.playlists.find(p => p.id === result.activePlaylistId) ?? null
        if (newActive) {
            store.set('activePlaylistId', newActive.id)
            mirrorAuth(newActive)
        }
        return { removed: true, newActive, loggedOut: false, activeChanged: true }
    }

    store.delete('activePlaylistId')
    mirrorAuth(null)
    return { removed: true, newActive: null, loggedOut: true, activeChanged: true }
}

export function renameStoredPlaylist(id: string, name: string): boolean {
    const playlists = getPlaylists()
    const updated = renamePlaylist(playlists, id, name)
    if (updated === playlists) return false
    store.set('playlists', updated)
    return true
}

/** Logout: clear the active playlist + auth mirror, keep saved playlists. */
export function deactivatePlaylists() {
    store.delete('activePlaylistId')
    mirrorAuth(null)
}

// ---- Backup export/import -------------------------------------------------

export interface PlaylistBackupEntry {
    name: string
    url: string
    username: string
    password: string
    /** Quando a credencial mudou na origem (ausente em backups antigos). */
    credentialsUpdatedAt?: number
}

/** Full playlist entries for the backup file (passwords stay in main until here). */
export function exportPlaylistsForBackup(): PlaylistBackupEntry[] {
    return getPlaylists().map(p => ({
        name: p.name,
        url: p.url,
        username: p.username,
        password: p.password,
        ...(p.credentialsUpdatedAt ? { credentialsUpdatedAt: p.credentialsUpdatedAt } : {})
    }))
}

/**
 * Import playlists from a backup WITHOUT activating or validating against the
 * provider (the machine may be offline during a restore). Existing entries
 * (same url+username) keep their password unless the backup differs.
 */
/** Entries with passwords + type for the phone hand-off deep link (main-only). */
export interface SetupExportEntry {
    id: string
    name: string
    url: string
    username: string
    password: string
    type?: 'xtream' | 'm3u' | 'stalker'
}

export function exportPlaylistsForSetup(): SetupExportEntry[] {
    return getPlaylists().map(p => ({
        id: p.id,
        name: p.name,
        url: p.url,
        username: p.username,
        password: p.password,
        type: p.type
    }))
}

/** Accounts from a NeoStream Mobile backup → saved playlists (no provider validation). */
export interface MobileAccountEntry {
    name?: string
    url: string
    username: string
    password: string
    type?: 'xtream' | 'm3u' | 'stalker'
}

export function importMobileAccounts(entries: MobileAccountEntry[]): number {
    let playlists = getPlaylists()
    let imported = 0
    for (const entry of entries) {
        if (!entry?.url?.trim() || typeof entry.username !== 'string' || typeof entry.password !== 'string') continue
        const result = upsertPlaylist(playlists, {
            name: entry.name,
            url: entry.url,
            username: entry.username,
            password: entry.password,
            type: entry.type === 'm3u' || entry.type === 'stalker' ? entry.type : 'xtream'
        })
        playlists = result.playlists
        imported++
    }
    if (imported > 0) {
        store.set('playlists', playlists)
        log.info('[Playlists] Imported', imported, 'account(s) from a mobile backup')
    }
    return imported
}

export function importPlaylistsFromBackup(entries: PlaylistBackupEntry[]): number {
    let playlists = getPlaylists()
    const removidas = getRemovedPlaylists()
    let imported = 0
    for (const entry of entries) {
        if (!entry?.url?.trim() || !entry?.username?.trim() || typeof entry.password !== 'string') continue
        // Apagada de propósito nesta máquina → o arquivo da outra máquina não
        // pode trazê-la de volta (era ressurreição permanente e auto-propagante).
        if (removidas[removedPlaylistKey(entry.url, entry.username)]) continue
        // Já existe aqui: só aceita a credencial remota se ela for comprovada-
        // mente MAIS NOVA. Antes o upsert sobrescrevia sempre — a senha
        // corrigida aqui voltava pra velha a cada ciclo (flip-flop entre as
        // máquinas), quebrando o switch e exportando credencial errada.
        const local = playlists.find(p => p.url === entry.url && p.username === entry.username)
        if (local) {
            const remoteAt = entry.credentialsUpdatedAt ?? 0
            const localAt = local.credentialsUpdatedAt ?? 0
            if (remoteAt <= localAt || local.password === entry.password) continue
        }
        const result = upsertPlaylist(playlists, {
            name: entry.name,
            url: entry.url,
            username: entry.username,
            password: entry.password
        })
        playlists = result.playlists
        imported++
    }
    if (imported > 0) {
        store.set('playlists', playlists)
        log.info('[Playlists] Imported', imported, 'playlist(s) from backup')
    }
    return imported
}
