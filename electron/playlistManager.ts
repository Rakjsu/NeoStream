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
    updatePlaylist,
    upsertPlaylist,
} from './playlistsModel'
import type { PlaylistEntry, PlaylistPatch, PublicPlaylist, UpdateReason, UpsertInput } from './playlistsModel'

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
    // userInfo no cadastro vem de um authenticate recém-feito → carimba a hora
    // (sem o carimbo, o aviso de expiração trataria o retrato como eterno).
    const stamped: PlaylistEntry = input.userInfo !== undefined ? { ...entry, userInfoAt: Date.now() } : entry
    // Re-adicionar à mão é intenção nova: sai do ledger de apagadas, senão a
    // própria playlist ficaria bloqueada pro sync por 30 dias.
    clearRemovedPlaylist(input.url, input.username)
    store.set('playlists', playlists.map(p => (p.id === entry.id ? stamped : p)))
    store.set('activePlaylistId', entry.id)
    mirrorAuth(stamped)
    return stamped
}

/** Make a saved playlist active (credentials already revalidated by caller). */
export function activatePlaylist(id: string, userInfo?: unknown): PlaylistEntry | null {
    const playlists = getPlaylists()
    const entry = playlists.find(p => p.id === id)
    if (!entry) return null

    // userInfo aqui veio de um authenticate recém-feito → carimba a hora.
    const updated: PlaylistEntry = userInfo !== undefined ? { ...entry, userInfo, userInfoAt: Date.now() } : entry
    if (userInfo !== undefined) {
        store.set('playlists', playlists.map(p => (p.id === id ? updated : p)))
    }
    store.set('activePlaylistId', id)
    mirrorAuth(updated)
    return updated
}

/** Active entry with everything (main-only — inclui senha e userInfo). */
export function getActivePlaylist(): PlaylistEntry | null {
    const id = getActivePlaylistId()
    if (!id) return null
    return getPlaylists().find(p => p.id === id) ?? null
}

/**
 * Grava um userInfo recém-confirmado com o provedor na playlist ATIVA (com
 * carimbo de hora) e re-espelha o `auth`. É o que impede o aviso de expiração
 * de decidir por um retrato do dia do cadastro.
 */
export function refreshActiveUserInfo(userInfo: unknown, at: number = Date.now()): boolean {
    const id = getActivePlaylistId()
    const playlists = getPlaylists()
    const entry = playlists.find(p => p.id === id)
    if (!entry) return false
    const updated: PlaylistEntry = { ...entry, userInfo, userInfoAt: at }
    store.set('playlists', playlists.map(p => (p.id === id ? updated : p)))
    mirrorAuth(updated)
    return true
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

export interface UpdatePlaylistOutcome {
    updated: boolean
    reason?: UpdateReason
    entry: PlaylistEntry | null
    /** A editada é a ativa — o chamador precisa recarregar o renderer. */
    isActive: boolean
    /** url ou username mudaram: a playlist trocou de identidade para o sync. */
    identityChanged: boolean
    /** url, username ou senha mudaram: caches por id apontam pro provedor velho. */
    credentialsChanged: boolean
}

/**
 * Edita uma playlist salva mantendo o id (credenciais já validadas pelo
 * chamador). Relê o store na hora de gravar: entre a validação no provedor e
 * esta escrita o sync pode ter mexido na lista.
 */
export function updateStoredPlaylist(id: string, patch: PlaylistPatch): UpdatePlaylistOutcome {
    const playlists = getPlaylists()
    const antes = playlists.find(p => p.id === id)
    const result = updatePlaylist(playlists, id, patch)
    if (result.reason || !result.entry || !antes) {
        return {
            updated: false,
            reason: result.reason ?? 'not-found',
            entry: null,
            isActive: false,
            identityChanged: false,
            credentialsChanged: false
        }
    }
    const depois = result.entry
    const identityChanged = depois.url !== antes.url || depois.username !== antes.username
    const credentialsChanged = identityChanged || depois.password !== antes.password

    // Para o sync, editar A→B é "remover A + adicionar B": sem o tombstone de A,
    // o backup da outra máquina traria A de volta como duplicata da editada.
    // A chave sai da entrada ANTIGA, antes de gravar. E B sai do ledger, senão
    // uma playlist editada de volta para uma identidade apagada ficaria
    // bloqueada pro sync por 30 dias.
    if (identityChanged) {
        recordRemovedPlaylist(antes)
        clearRemovedPlaylist(depois.url, depois.username)
    }
    store.set('playlists', result.playlists)

    const isActive = getActivePlaylistId() === id
    if (isActive) mirrorAuth(depois)
    return { updated: true, entry: depois, isActive, identityChanged, credentialsChanged }
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
    /**
     * Tipo da lista. Sem ele o backup só sabia restaurar Xtream: a entrada
     * renascia SEM type na outra máquina, o `toPublicPlaylist` a mostrava como
     * 'xtream' e todo o roteamento do main (catálogo, switch, ficha, play,
     * download, EPG) caía no XtreamClient — a M3U e o portal Stalker voltavam
     * do backup e nunca mais abriam. Ausente em backups antigos (tratado como
     * 'xtream', que sempre foi o default).
     */
    type?: 'xtream' | 'm3u' | 'stalker'
}

/** Full playlist entries for the backup file (passwords stay in main until here). */
export function exportPlaylistsForBackup(): PlaylistBackupEntry[] {
    return getPlaylists().map(p => ({
        name: p.name,
        url: p.url,
        username: p.username,
        password: p.password,
        ...(p.credentialsUpdatedAt ? { credentialsUpdatedAt: p.credentialsUpdatedAt } : {}),
        ...(p.type ? { type: p.type } : {})
    }))
}

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

/**
 * Lista M3U vinda de FORA (arquivo do celular, backup/sync de outra máquina)
 * só entra por URL. Quem manda o payload escolhe o caminho, e cadastrar um
 * caminho de disco aqui abriria, pelo catálogo, um leitor de arquivo no
 * processo principal: `listaDeDiscoCadastrada` (ipcHandlers.ts) libera a
 * leitura de QUALQUER caminho que já esteja na lista com type 'm3u'.
 * Arquivo local entra só pelo diálogo do sistema (playlists:add-m3u-file).
 */
function m3uDeForaSemUrl(entry: { url: string; type?: string }): boolean {
    return entry.type === 'm3u' && !/^https?:\/\//i.test(entry.url.trim())
}

/**
 * Guarda comum aos dois imports de fora (arquivo do celular e backup de outra
 * máquina). Duas regressões moram aqui:
 *  - sem o ledger, o arquivo reimportava a playlist apagada de propósito em
 *    TODO ciclo, e a ressurreição se propagava de volta (permanente);
 *  - sem comparar o carimbo, o upsert sobrescrevia a senha sempre — a senha
 *    corrigida aqui voltava pra velha a cada ciclo (flip-flop entre as
 *    máquinas), quebrando o switch e exportando credencial errada.
 * Arquivo sem carimbo (legado, e todo backup de celular) nunca vence o local.
 */
function importeBloqueado(
    playlists: PlaylistEntry[],
    removidas: Record<string, number>,
    entry: { url: string; username: string; password: string; credentialsUpdatedAt?: number }
): boolean {
    if (removidas[removedPlaylistKey(entry.url, entry.username)]) return true
    const local = playlists.find(p => p.url === entry.url && p.username === entry.username)
    if (!local) return false
    const remoteAt = entry.credentialsUpdatedAt ?? 0
    const localAt = local.credentialsUpdatedAt ?? 0
    return remoteAt <= localAt || local.password === entry.password
}

export function importMobileAccounts(entries: MobileAccountEntry[]): number {
    let playlists = getPlaylists()
    const removidas = getRemovedPlaylists()
    let imported = 0
    for (const entry of entries) {
        if (!entry?.url?.trim() || typeof entry.username !== 'string' || typeof entry.password !== 'string') continue
        if (m3uDeForaSemUrl(entry)) continue
        if (importeBloqueado(playlists, removidas, entry)) continue
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

/**
 * Import playlists from a backup WITHOUT activating or validating against the
 * provider (the machine may be offline during a restore). Existing entries
 * (same url+username) keep their password unless the backup is provably newer.
 */
export function importPlaylistsFromBackup(entries: PlaylistBackupEntry[]): number {
    let playlists = getPlaylists()
    const removidas = getRemovedPlaylists()
    let imported = 0
    for (const entry of entries) {
        if (!entry?.url?.trim() || !entry?.username?.trim() || typeof entry.password !== 'string') continue
        // Mesmo portão do import do celular: o backup também vem de fora.
        if (m3uDeForaSemUrl(entry)) continue
        if (importeBloqueado(playlists, removidas, entry)) continue
        const result = upsertPlaylist(playlists, {
            name: entry.name,
            url: entry.url,
            username: entry.username,
            password: entry.password,
            // Só 'm3u'/'stalker' viajam. 'xtream' já é o default do
            // `toPublicPlaylist`, e deixar undefined faz o upsert PRESERVAR o
            // type local (`input.type ?? existing.type`) quando um backup
            // legado (sem o campo) reencontra uma entrada tipada aqui — sem
            // isso um arquivo antigo rebaixaria um Stalker que funcionava.
            type: entry.type === 'm3u' || entry.type === 'stalker' ? entry.type : undefined
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
