import { describe, it, expect, vi, beforeEach } from 'vitest'

// Store em memória com a mesma superfície usada pelo playlistManager.
vi.mock('./store', () => {
    const data = new Map<string, unknown>()
    return {
        default: {
            get: (key: string) => data.get(key),
            set: (key: string, value: unknown) => { data.set(key, value) },
            delete: (key: string) => { data.delete(key) },
        },
    }
})
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import store from './store'
import type { PlaylistEntry } from './playlistsModel'
import {
    migratePlaylistsOnStartup,
    listPublicPlaylists,
    saveAndActivatePlaylist,
    activatePlaylist,
    removePlaylist,
    renameStoredPlaylist,
    deactivatePlaylists,
    getActivePlaylistIdPublic,
    exportPlaylistsForBackup,
    importPlaylistsFromBackup,
} from './playlistManager'

const auth = () => store.get('auth') as { url?: string; username?: string; password?: string }
const playlists = () => (store.get('playlists') ?? []) as PlaylistEntry[]

beforeEach(() => {
    store.set('auth', {})
    store.set('playlists', [])
    store.delete('activePlaylistId')
})

describe('migratePlaylistsOnStartup (legado auth único → multi-playlist)', () => {
    it('auth legado completo vira playlists[0] ativa, com o espelho mantido', () => {
        store.set('auth', { url: 'http://prov.tv:80', username: 'user', password: 'secret' })
        migratePlaylistsOnStartup()

        const all = playlists()
        expect(all).toHaveLength(1)
        expect(all[0]).toMatchObject({ url: 'http://prov.tv:80', username: 'user', password: 'secret' })
        expect(store.get('activePlaylistId')).toBe(all[0].id)
        expect(auth().url).toBe('http://prov.tv:80')
    })

    it('instalação limpa (sem auth) não cria nada', () => {
        migratePlaylistsOnStartup()
        expect(playlists()).toHaveLength(0)
        expect(store.get('activePlaylistId')).toBeUndefined()
    })

    it('activePlaylistId pendurado sem auth logado → volta a deslogado', () => {
        const entry = saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p' })
        store.set('activePlaylistId', 'pl_que_nao_existe')
        store.set('auth', {})
        migratePlaylistsOnStartup()
        expect(store.get('activePlaylistId')).toBeUndefined()
        expect(playlists().map(p => p.id)).toEqual([entry.id]) // a playlist salva fica
    })
})

describe('saveAndActivatePlaylist / activatePlaylist (caminho único de escrita)', () => {
    it('salva, ativa e espelha o auth; relogin no mesmo provedor não duplica', () => {
        const first = saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p1' })
        expect(getActivePlaylistIdPublic()).toBe(first.id)
        expect(auth()).toMatchObject({ url: 'http://a.tv', username: 'u', password: 'p1' })

        // Mesma url+username = update, não entrada nova (senha atualizada).
        saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p2' })
        expect(playlists()).toHaveLength(1)
        expect(auth().password).toBe('p2')
    })

    it('activatePlaylist troca o espelho; id desconhecido → null sem efeito', () => {
        const a = saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p' })
        const b = saveAndActivatePlaylist({ url: 'http://b.tv', username: 'u', password: 'p' })
        expect(activatePlaylist(a.id)).toMatchObject({ id: a.id })
        expect(auth().url).toBe('http://a.tv')

        expect(activatePlaylist('pl_fantasma')).toBeNull()
        expect(getActivePlaylistIdPublic()).toBe(a.id)
        expect(b.id).not.toBe(a.id)
    })

    it('listPublicPlaylists nunca expõe a senha e marca a ativa', () => {
        saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'segredo' })
        const pub = listPublicPlaylists()
        expect(pub).toHaveLength(1)
        expect(pub[0].active).toBe(true)
        expect(JSON.stringify(pub)).not.toContain('segredo')
    })
})

describe('removePlaylist (fallback de ativa e logout)', () => {
    it('remover uma NÃO ativa não mexe na ativa', () => {
        const a = saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p' })
        const b = saveAndActivatePlaylist({ url: 'http://b.tv', username: 'u', password: 'p' })
        const outcome = removePlaylist(a.id)
        expect(outcome).toMatchObject({ removed: true, activeChanged: false, loggedOut: false })
        expect(getActivePlaylistIdPublic()).toBe(b.id)
    })

    it('remover a ativa promove outra e re-espelha o auth', () => {
        const a = saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p' })
        const b = saveAndActivatePlaylist({ url: 'http://b.tv', username: 'u', password: 'p' })
        const outcome = removePlaylist(b.id) // b é a ativa
        expect(outcome.removed).toBe(true)
        expect(outcome.activeChanged).toBe(true)
        expect(outcome.newActive?.id).toBe(a.id)
        expect(auth().url).toBe('http://a.tv')
    })

    it('remover a última desloga (auth limpo, sem ativa)', () => {
        const a = saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p' })
        const outcome = removePlaylist(a.id)
        expect(outcome).toMatchObject({ removed: true, loggedOut: true, newActive: null })
        expect(getActivePlaylistIdPublic()).toBeNull()
        expect(auth()).toEqual({})
    })

    it('id inexistente → removed false, nada muda', () => {
        saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p' })
        expect(removePlaylist('pl_fantasma').removed).toBe(false)
        expect(playlists()).toHaveLength(1)
    })
})

describe('rename / deactivate', () => {
    it('renameStoredPlaylist persiste; id desconhecido → false', () => {
        const a = saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p' })
        expect(renameStoredPlaylist(a.id, 'Casa')).toBe(true)
        expect(playlists()[0].name).toBe('Casa')
        expect(renameStoredPlaylist('pl_fantasma', 'X')).toBe(false)
    })

    it('deactivatePlaylists (logout) limpa ativa+espelho e preserva as salvas', () => {
        saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p' })
        deactivatePlaylists()
        expect(getActivePlaylistIdPublic()).toBeNull()
        expect(auth()).toEqual({})
        expect(playlists()).toHaveLength(1)
    })
})

describe('backup (export/import sem ativar nem validar)', () => {
    it('exporta só os 4 campos de credencial', () => {
        saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p', userInfo: { exp: 1 } })
        expect(exportPlaylistsForBackup()).toEqual([{ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' }])
    })

    it('importa válidas, pula inválidas e não mexe na ativa', () => {
        const active = saveAndActivatePlaylist({ url: 'http://ativa.tv', username: 'u', password: 'p' })
        const imported = importPlaylistsFromBackup([
            { name: 'Nova', url: 'http://nova.tv', username: 'x', password: 'y' },
            { name: 'Sem url', url: '  ', username: 'x', password: 'y' },
            { name: 'Sem senha', url: 'http://z.tv', username: 'x', password: undefined as unknown as string },
            // Mesmo provedor da ativa: atualiza em vez de duplicar.
            { name: 'Ativa', url: 'http://ativa.tv', username: 'u', password: 'p-nova' },
        ])
        expect(imported).toBe(2)
        expect(playlists()).toHaveLength(2)
        expect(playlists().find(p => p.id === active.id)?.password).toBe('p-nova')
        expect(getActivePlaylistIdPublic()).toBe(active.id)
    })

    it('lote todo inválido → 0 e nenhuma escrita', () => {
        expect(importPlaylistsFromBackup([{ name: '', url: '', username: '', password: '' }])).toBe(0)
        expect(playlists()).toHaveLength(0)
    })
})
