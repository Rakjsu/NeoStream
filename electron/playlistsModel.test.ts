import { describe, it, expect } from 'vitest'
import {
    derivePlaylistName,
    diffPlaylistPatch,
    migrateAuthToPlaylists,
    removePlaylistById,
    renamePlaylist,
    toPublicPlaylist,
    updatePlaylist,
    upsertPlaylist,
} from './playlistsModel'
import type { PlaylistEntry } from './playlistsModel'

const entry = (overrides: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
    id: 'pl_a',
    name: 'Playlist A',
    url: 'http://a.example.com:8080',
    username: 'alice',
    password: 'secret-a',
    addedAt: 1000,
    ...overrides
})

describe('derivePlaylistName', () => {
    it('builds username@host from a valid url', () => {
        expect(derivePlaylistName('http://tv.example.com:8080/path', 'bob')).toBe('bob@tv.example.com:8080')
    })

    it('falls back to the raw url when parsing fails', () => {
        expect(derivePlaylistName('not a url', 'bob')).toBe('bob@not a url')
    })
})

describe('migrateAuthToPlaylists', () => {
    it('migrates a legacy auth entry into playlists[0] as active', () => {
        const auth = { url: 'http://x.com', username: 'u', password: 'p', userInfo: { status: 'Active' } }
        const result = migrateAuthToPlaylists(auth, [], undefined)

        expect(result.changed).toBe(true)
        expect(result.playlists).toHaveLength(1)
        expect(result.playlists[0]).toMatchObject({
            url: 'http://x.com',
            username: 'u',
            password: 'p',
            userInfo: { status: 'Active' },
            name: 'u@x.com'
        })
        expect(result.activePlaylistId).toBe(result.playlists[0].id)
    })

    it('uses the provided fallback name when given', () => {
        const auth = { url: 'http://x.com', username: 'u', password: 'p' }
        const result = migrateAuthToPlaylists(auth, [], undefined, 'Minha Playlist')
        expect(result.playlists[0].name).toBe('Minha Playlist')
    })

    it('does nothing on a fresh install (no auth, no playlists)', () => {
        const result = migrateAuthToPlaylists({}, [], undefined)
        expect(result.changed).toBe(false)
        expect(result.playlists).toEqual([])
        expect(result.activePlaylistId).toBeUndefined()
    })

    it('does nothing for incomplete legacy auth (missing password)', () => {
        const result = migrateAuthToPlaylists({ url: 'http://x.com', username: 'u' }, [], undefined)
        expect(result.changed).toBe(false)
        expect(result.playlists).toEqual([])
    })

    it('is idempotent when playlists exist and active id is valid', () => {
        const playlists = [entry()]
        const result = migrateAuthToPlaylists({}, playlists, 'pl_a')
        expect(result.changed).toBe(false)
        expect(result.playlists).toBe(playlists)
        expect(result.activePlaylistId).toBe('pl_a')
    })

    it('repairs a dangling active id by matching the auth mirror', () => {
        const playlists = [entry(), entry({ id: 'pl_b', url: 'http://b.com', username: 'bob' })]
        const auth = { url: 'http://b.com', username: 'bob', password: 'p' }
        const result = migrateAuthToPlaylists(auth, playlists, 'pl_gone')
        expect(result.changed).toBe(true)
        expect(result.activePlaylistId).toBe('pl_b')
    })

    it('clears a dangling active id when logged out (empty auth)', () => {
        const result = migrateAuthToPlaylists({}, [entry()], 'pl_gone')
        expect(result.changed).toBe(true)
        expect(result.activePlaylistId).toBeUndefined()
    })
})

describe('upsertPlaylist', () => {
    it('appends a new playlist with a derived name', () => {
        const { playlists, entry: added } = upsertPlaylist([entry()], {
            url: 'http://b.com',
            username: 'bob',
            password: 'pw'
        })
        expect(playlists).toHaveLength(2)
        expect(added.name).toBe('bob@b.com')
        expect(added.id).not.toBe('pl_a')
    })

    it('updates the existing playlist on same url+username (no duplicates)', () => {
        const { playlists, entry: updated } = upsertPlaylist([entry()], {
            url: 'http://a.example.com:8080',
            username: 'alice',
            password: 'new-password',
            userInfo: { status: 'Active' },
            name: 'Renamed'
        })
        expect(playlists).toHaveLength(1)
        expect(updated.id).toBe('pl_a')
        expect(updated.password).toBe('new-password')
        expect(updated.name).toBe('Renamed')
        expect(updated.userInfo).toEqual({ status: 'Active' })
    })

    it('keeps the previous name when no name is provided on update', () => {
        const { entry: updated } = upsertPlaylist([entry()], {
            url: 'http://a.example.com:8080',
            username: 'alice',
            password: 'pw2'
        })
        expect(updated.name).toBe('Playlist A')
    })
})

describe('removePlaylistById', () => {
    const two = [entry(), entry({ id: 'pl_b', name: 'B', url: 'http://b.com', username: 'bob' })]

    it('removes a non-active playlist without touching the active id', () => {
        const result = removePlaylistById(two, 'pl_b', 'pl_a')
        expect(result.removed).toBe(true)
        expect(result.activeChanged).toBe(false)
        expect(result.activePlaylistId).toBe('pl_a')
        expect(result.playlists.map(p => p.id)).toEqual(['pl_a'])
    })

    it('falls back to the first remaining playlist when removing the active one', () => {
        const result = removePlaylistById(two, 'pl_a', 'pl_a')
        expect(result.removed).toBe(true)
        expect(result.activeChanged).toBe(true)
        expect(result.activePlaylistId).toBe('pl_b')
    })

    it('logs out when the last playlist is removed', () => {
        const result = removePlaylistById([entry()], 'pl_a', 'pl_a')
        expect(result.removed).toBe(true)
        expect(result.activeChanged).toBe(true)
        expect(result.activePlaylistId).toBeUndefined()
        expect(result.playlists).toEqual([])
    })

    it('reports removed=false for an unknown id', () => {
        const result = removePlaylistById(two, 'pl_zzz', 'pl_a')
        expect(result.removed).toBe(false)
        expect(result.playlists).toBe(two)
    })
})

describe('renamePlaylist', () => {
    it('renames by id (trimmed)', () => {
        const renamed = renamePlaylist([entry()], 'pl_a', '  Novo Nome  ')
        expect(renamed[0].name).toBe('Novo Nome')
    })

    it('ignores empty names', () => {
        const playlists = [entry()]
        expect(renamePlaylist(playlists, 'pl_a', '   ')).toBe(playlists)
    })
})

describe('updatePlaylist (edição por id)', () => {
    const dois = () => [
        entry({ type: 'xtream' }),
        entry({ id: 'pl_b', name: 'Playlist B', url: 'http://b.example.com', username: 'bob', password: 'secret-b', addedAt: 2000 })
    ]

    it('troca url/usuário/senha mantendo id, addedAt e type — e carimba credentialsUpdatedAt', () => {
        // O ponto da função: favoritos e progresso são guardados por id de
        // playlist no renderer. Um "remover + adicionar" os perderia.
        const { playlists, entry: editada, reason } = updatePlaylist(
            [entry({ type: 'xtream', credentialsUpdatedAt: 5 })],
            'pl_a',
            { url: ' http://novo.example.com ', username: ' alice2 ', password: 'nova' },
            999
        )
        expect(reason).toBeUndefined()
        expect(editada).toMatchObject({
            id: 'pl_a', addedAt: 1000, type: 'xtream',
            url: 'http://novo.example.com', username: 'alice2', password: 'nova',
            credentialsUpdatedAt: 999
        })
        expect(playlists[0]).toBe(editada)
    })

    it('senha vazia mantém a atual; com o resto igual é "unchanged" e devolve o MESMO array', () => {
        const lista = [entry()]
        const r = updatePlaylist(lista, 'pl_a', { url: 'http://a.example.com:8080', username: 'alice', password: '' })
        expect(r.reason).toBe('unchanged')
        expect(r.playlists).toBe(lista)
    })

    it('só o nome: trimado, sem mexer no carimbo nem na senha', () => {
        const r = updatePlaylist([entry({ credentialsUpdatedAt: 5 })], 'pl_a', { name: '  Casa  ' }, 999)
        expect(r.reason).toBeUndefined()
        expect(r.entry).toMatchObject({ name: 'Casa', credentialsUpdatedAt: 5, password: 'secret-a' })
    })

    it('nome vazio mantém o atual', () => {
        const r = updatePlaylist([entry()], 'pl_a', { name: '   ', password: 'nova' })
        expect(r.entry?.name).toBe('Playlist A')
    })

    it('id desconhecido: mesmo array e not-found', () => {
        const lista = [entry()]
        const r = updatePlaylist(lista, 'pl_zzz', { name: 'X' })
        expect(r).toMatchObject({ reason: 'not-found', entry: null })
        expect(r.playlists).toBe(lista)
    })

    it('recusa assumir a identidade (url+usuário) de OUTRA entrada', () => {
        // Duas entradas com a mesma chave quebrariam todo find por identidade
        // (import do backup, migração do auth, ledger de apagadas).
        const lista = dois()
        const r = updatePlaylist(lista, 'pl_a', { url: 'http://b.example.com', username: 'bob' })
        expect(r.reason).toBe('duplicate')
        expect(r.playlists).toBe(lista)
    })

    it('a própria identidade não conta como colisão', () => {
        const r = updatePlaylist(dois(), 'pl_a', { url: 'http://a.example.com:8080', username: 'alice', password: 'outra' })
        expect(r.reason).toBeUndefined()
        expect(r.entry?.password).toBe('outra')
    })

    it('userInfo no patch grava userInfo e carimba userInfoAt', () => {
        const r = updatePlaylist([entry()], 'pl_a', { password: 'nova', userInfo: { status: 'Active' } }, 777)
        expect(r.entry).toMatchObject({ userInfo: { status: 'Active' }, userInfoAt: 777 })
    })

    it('as entradas não editadas mantêm a referência', () => {
        const lista = dois()
        const r = updatePlaylist(lista, 'pl_a', { password: 'nova' })
        expect(r.playlists).not.toBe(lista)
        expect(r.playlists[1]).toBe(lista[1])
    })
})

describe('diffPlaylistPatch', () => {
    it('trim e "vazio = manter"', () => {
        expect(diffPlaylistPatch(entry(), { name: ' Playlist A ', url: '', username: undefined, password: '' }))
            .toEqual({ nameChanged: false, urlChanged: false, usernameChanged: false, passwordChanged: false })
        expect(diffPlaylistPatch(entry(), { url: ' http://x ', password: 'p2' }))
            .toEqual({ nameChanged: false, urlChanged: true, usernameChanged: false, passwordChanged: true })
    })
})

describe('toPublicPlaylist', () => {
    it('exposes no password and flags the active playlist', () => {
        const pub = toPublicPlaylist(entry(), 'pl_a')
        expect(pub).toEqual({
            type: 'xtream',
            id: 'pl_a',
            name: 'Playlist A',
            url: 'http://a.example.com:8080',
            username: 'alice',
            active: true
        })
        expect('password' in pub).toBe(false)
    })
})
