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

export function removePlaylist(id: string): RemovePlaylistOutcome {
    const result = removePlaylistById(getPlaylists(), id, getActivePlaylistId())
    if (!result.removed) {
        return { removed: false, newActive: null, loggedOut: false, activeChanged: false }
    }

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
