import { describe, it, expect } from 'vitest'
import {
    derivePlaylistName,
    migrateAuthToPlaylists,
    removePlaylistById,
    renamePlaylist,
    toPublicPlaylist,
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
