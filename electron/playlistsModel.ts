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
    /**
     * Quando a CREDENCIAL desta entrada mudou pela última vez. É o que permite
     * o sync propagar uma senha corrigida sem reverter a correção: quem mudou
     * por último vence. Ausente em entradas legadas (tratadas como as mais
     * antigas, logo nunca vencem de uma entrada carimbada).
     */
    credentialsUpdatedAt?: number
    /** 'xtream' (default, absent on legacy entries), 'm3u' or 'stalker'. */
    type?: 'xtream' | 'm3u' | 'stalker'
    /**
     * Quando o userInfo foi confirmado com o provedor pela última vez.
     * Ausente em entradas legadas — tratadas como nunca confirmadas.
     */
    userInfoAt?: number
}

/**
 * Idade máxima de um userInfo pra valer como "fresco". O aviso de expiração
 * decidia por um retrato tirado NO CADASTRO da conta — quem renovava com o
 * provedor continuava vendo "sua lista expirou" pra sempre. Dentro do TTL o
 * retrato serve; fora dele, só rede.
 */
export const USER_INFO_TTL_MS = 6 * 3600_000

/** O retrato ainda vale, ou é hora de perguntar ao provedor? (PURO) */
export function isUserInfoFresh(userInfoAt: number | undefined, nowMs: number, ttlMs: number = USER_INFO_TTL_MS): boolean {
    return typeof userInfoAt === 'number' && Number.isFinite(userInfoAt) && nowMs - userInfoAt < ttlMs
}

/** What the renderer is allowed to see — never includes the password. */
export interface PublicPlaylist {
    id: string
    name: string
    url: string
    username: string
    active: boolean
    type: 'xtream' | 'm3u' | 'stalker'
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
    type?: 'xtream' | 'm3u' | 'stalker'
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
        const senhaMudou = existing.password !== input.password
        const updated: PlaylistEntry = {
            ...existing,
            password: input.password,
            credentialsUpdatedAt: senhaMudou ? Date.now() : existing.credentialsUpdatedAt,
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
        credentialsUpdatedAt: Date.now(),
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
    // Same array back = "nothing changed" to callers; an unknown id must not
    // look like a successful rename (map() alone would return a new array).
    if (!trimmed || !playlists.some(p => p.id === id)) return playlists
    return playlists.map(p => (p.id === id ? { ...p, name: trimmed } : p))
}

/**
 * ✏️ Editar uma playlist depois de cadastrada — POR ID.
 *
 * O `upsertPlaylist` casa por (url, username). Servir-se dele para "editar"
 * criaria OUTRA entrada com id novo sempre que a URL ou o usuário mudasse — e
 * favoritos, progresso e ocultos são guardados por id de playlist no renderer
 * (`neostream_profile_<perfil>__pl_<id>`). O usuário que corrigisse um domínio
 * abriria os Favoritos e encontraria o vazio. Por isso a edição preserva o id
 * e só troca o que foi pedido.
 *
 * Campo vazio/ausente no patch = manter o atual (inclusive a senha: o renderer
 * não a enxerga, então o formulário manda vazio para "não mexer").
 */
export interface PlaylistPatch {
    name?: string
    url?: string
    username?: string
    password?: string
    /** userInfo recém-confirmado com o provedor (carimba `userInfoAt`). */
    userInfo?: unknown
}

export interface PlaylistPatchDiff {
    nameChanged: boolean
    urlChanged: boolean
    usernameChanged: boolean
    passwordChanged: boolean
}

/** Valores efetivos do patch (trim + "vazio = manter"). */
function resolvePatch(entry: PlaylistEntry, patch: PlaylistPatch) {
    const name = patch.name?.trim() || entry.name
    const url = patch.url?.trim() || entry.url
    const username = patch.username?.trim() || entry.username
    const password = patch.password || entry.password
    return { name, url, username, password }
}

export function diffPlaylistPatch(entry: PlaylistEntry, patch: PlaylistPatch): PlaylistPatchDiff {
    const alvo = resolvePatch(entry, patch)
    return {
        nameChanged: alvo.name !== entry.name,
        urlChanged: alvo.url !== entry.url,
        usernameChanged: alvo.username !== entry.username,
        passwordChanged: alvo.password !== entry.password
    }
}

export type UpdateReason = 'not-found' | 'duplicate' | 'unchanged'

export interface UpdateResult {
    /** O MESMO array de entrada sempre que `reason` vier (convenção do rename). */
    playlists: PlaylistEntry[]
    entry: PlaylistEntry | null
    reason?: UpdateReason
}

export function updatePlaylist(
    playlists: PlaylistEntry[],
    id: string,
    patch: PlaylistPatch,
    now: number = Date.now()
): UpdateResult {
    const atual = playlists.find(p => p.id === id)
    if (!atual) return { playlists, entry: null, reason: 'not-found' }

    const alvo = resolvePatch(atual, patch)
    const diff = diffPlaylistPatch(atual, patch)
    const credencialMudou = diff.urlChanged || diff.usernameChanged || diff.passwordChanged
    if (!diff.nameChanged && !credencialMudou && patch.userInfo === undefined) {
        return { playlists, entry: atual, reason: 'unchanged' }
    }

    // Duas entradas com a mesma (url, username) quebrariam todo `find` por
    // identidade (import do backup, migração do auth legado, leitor de lista
    // em disco, chave do ledger de apagadas). O upsert nunca cria isso porque
    // funde; aqui, como o id manda, a colisão tem que ser recusada.
    if ((diff.urlChanged || diff.usernameChanged) &&
        playlists.some(p => p.id !== id && p.url === alvo.url && p.username === alvo.username)) {
        return { playlists, entry: null, reason: 'duplicate' }
    }

    const editada: PlaylistEntry = {
        ...atual,
        name: alvo.name,
        url: alvo.url,
        username: alvo.username,
        password: alvo.password,
        // É o carimbo que faz o sync entre máquinas aceitar a credencial mais
        // nova em vez de reverter a correção (LWW no importPlaylistsFromBackup).
        credentialsUpdatedAt: credencialMudou ? now : atual.credentialsUpdatedAt,
        ...(patch.userInfo !== undefined ? { userInfo: patch.userInfo, userInfoAt: now } : {})
    }
    return {
        playlists: playlists.map(p => (p.id === id ? editada : p)),
        entry: editada
    }
}
