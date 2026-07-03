/**
 * Multi-playlist model — PURE helpers (no 'electron' import) so the
 * migration and list operations are unit-testable with vitest.
 *
 * Storage model (electron-store):
 *   playlists: PlaylistEntry[]          — every saved Xtream provider
 *   activePlaylistId: string | undefined — which one the app is logged into
 *   auth: { url, username, password, userInfo } — MIRROR of the active
 *       playlist's credentials. Everything else in the main process keeps
 *       reading store.get('auth'), so the rest of the app is untouched.
 *
 * Data separation (v1, documented limitation):
 *   - favorites / watch-later / history / watch progress stay GLOBAL across
 *     playlists. They key by stream ids, which differ per provider, so
 *     collisions are possible but accepted for v1.
 *   - streams/EPG caches are per-active-playlist and cleared on switch.
 */

export interface PlaylistEntry {
    id: string
    name: string
    url: string
    username: string
    password: string
    userInfo?: unknown
    addedAt: number
    /** 'xtream' (default, absent on legacy entries) or 'm3u'. */
    type?: 'xtream' | 'm3u'
}

/** What the renderer is allowed to see — never includes the password. */
export interface PublicPlaylist {
    id: string
    name: string
    url: string
    username: string
    active: boolean
    type: 'xtream' | 'm3u'
}

export interface AuthShape {
    url?: string
    username?: string
    password?: string
    userInfo?: unknown
}

export function createPlaylistId(): string {
    return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Default display name when the user didn't provide one: username@host. */
export function derivePlaylistName(url: string, username: string): string {
    try {
        return `${username}@${new URL(url).host}`
    } catch {
        return `${username}@${url}`
    }
}

export function toPublicPlaylist(entry: PlaylistEntry, activePlaylistId: string | undefined): PublicPlaylist {
    return {
        type: entry.type ?? 'xtream',
        id: entry.id,
        name: entry.name,
        url: entry.url,
        username: entry.username,
        active: entry.id === activePlaylistId
    }
}

export interface MigrationResult {
    playlists: PlaylistEntry[]
    activePlaylistId: string | undefined
    changed: boolean
}

/**
 * One-time migration from the single-`auth` model to the playlists model.
 * - playlists already populated → just repair a dangling activePlaylistId.
 * - playlists empty + complete legacy auth → auth becomes playlists[0], active.
 * - otherwise (fresh install / logged out) → nothing to do.
 */
export function migrateAuthToPlaylists(
    auth: AuthShape,
    playlists: PlaylistEntry[],
    activePlaylistId: string | undefined,
    fallbackName?: string
): MigrationResult {
    if (playlists.length > 0) {
        const activeExists = activePlaylistId !== undefined
            && playlists.some(p => p.id === activePlaylistId)
        if (activeExists) {
            return { playlists, activePlaylistId, changed: false }
        }
        // Dangling/missing active id. Only auto-activate when a legacy auth
        // mirror says we are logged in; otherwise stay logged out.
        if (auth.url && auth.username && auth.password) {
            const match = playlists.find(p => p.url === auth.url && p.username === auth.username)
            return { playlists, activePlaylistId: (match ?? playlists[0]).id, changed: true }
        }
        return { playlists, activePlaylistId: undefined, changed: activePlaylistId !== undefined }
    }

    if (auth.url && auth.username && auth.password) {
        const entry: PlaylistEntry = {
            id: createPlaylistId(),
            name: fallbackName || derivePlaylistName(auth.url, auth.username),
            url: auth.url,
            username: auth.username,
            password: auth.password,
            userInfo: auth.userInfo,
            addedAt: Date.now()
        }
        return { playlists: [entry], activePlaylistId: entry.id, changed: true }
    }

    return { playlists: [], activePlaylistId: undefined, changed: false }
}

export interface UpsertInput {
    name?: string
    url: string
    username: string
    password: string
    userInfo?: unknown
    type?: 'xtream' | 'm3u'
}

export interface UpsertResult {
    playlists: PlaylistEntry[]
    entry: PlaylistEntry
}

/**
 * Add a playlist, or update the existing one with the same url+username
 * (re-login to a saved provider must not create duplicates).
 */
export function upsertPlaylist(playlists: PlaylistEntry[], input: UpsertInput): UpsertResult {
    const existing = playlists.find(p => p.url === input.url && p.username === input.username)
    if (existing) {
        const updated: PlaylistEntry = {
            ...existing,
            password: input.password,
            userInfo: input.userInfo ?? existing.userInfo,
            name: input.name?.trim() || existing.name,
            type: input.type ?? existing.type
        }
        return {
            playlists: playlists.map(p => (p.id === existing.id ? updated : p)),
            entry: updated
        }
    }

    const entry: PlaylistEntry = {
        id: createPlaylistId(),
        name: input.name?.trim() || derivePlaylistName(input.url, input.username),
        url: input.url,
        username: input.username,
        password: input.password,
        userInfo: input.userInfo,
        addedAt: Date.now(),
        type: input.type
    }
    return { playlists: [...playlists, entry], entry }
}

export interface RemoveResult {
    playlists: PlaylistEntry[]
    activePlaylistId: string | undefined
    removed: boolean
    /** True when the removed playlist was active, so callers must re-login/clear. */
    activeChanged: boolean
}

/**
 * Remove a playlist. If it was the active one, fall back to the first
 * remaining playlist (or logged-out state when none remain).
 */
export function removePlaylistById(
    playlists: PlaylistEntry[],
    id: string,
    activePlaylistId: string | undefined
): RemoveResult {
    const remaining = playlists.filter(p => p.id !== id)
    if (remaining.length === playlists.length) {
        return { playlists, activePlaylistId, removed: false, activeChanged: false }
    }

    if (activePlaylistId !== id) {
        return { playlists: remaining, activePlaylistId, removed: true, activeChanged: false }
    }

    return {
        playlists: remaining,
        activePlaylistId: remaining.length > 0 ? remaining[0].id : undefined,
        removed: true,
        activeChanged: true
    }
}

export function renamePlaylist(playlists: PlaylistEntry[], id: string, name: string): PlaylistEntry[] {
    const trimmed = name.trim()
    if (!trimmed) return playlists
    return playlists.map(p => (p.id === id ? { ...p, name: trimmed } : p))
}
