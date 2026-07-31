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
    getRemovedPlaylists,
    removedPlaylistKey,
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
    it('exporta só a credencial (+ carimbo de atualização), nunca o userInfo', () => {
        saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p', userInfo: { exp: 1 } })
        const [exported] = exportPlaylistsForBackup()
        expect(exported).toMatchObject({ name: 'Casa', url: 'http://a.tv', username: 'u', password: 'p' })
        expect(typeof exported.credentialsUpdatedAt).toBe('number')
        expect(Object.keys(exported).sort()).toEqual(
            ['credentialsUpdatedAt', 'name', 'password', 'url', 'username']
        )
    })

    // 🔒 Regressão (auditoria R1 — H4, cenário B): sem carimbo, o import
    // sobrescrevia a senha com a do arquivo remoto (possivelmente velha) e a
    // correção feita aqui voltava atrás a cada ciclo de sync.
    it('senha remota só vence se for comprovadamente mais nova', () => {
        const p1 = saveAndActivatePlaylist({ url: 'http://prov.tv', username: 'u', password: 'senha-velha' })
        const carimboAntigo = 1_000

        // Remoto com carimbo ANTIGO → ignorado (era o flip-flop).
        importPlaylistsFromBackup([
            { name: 'X', url: 'http://prov.tv', username: 'u', password: 'senha-obsoleta', credentialsUpdatedAt: carimboAntigo },
        ])
        expect(playlists().find(p => p.id === p1.id)?.password).toBe('senha-velha')

        // Backup legado (sem carimbo) também não derruba a credencial local.
        importPlaylistsFromBackup([
            { name: 'X', url: 'http://prov.tv', username: 'u', password: 'senha-de-backup-antigo' },
        ])
        expect(playlists().find(p => p.id === p1.id)?.password).toBe('senha-velha')

        // Remoto MAIS NOVO → aceito (a correção feita na outra máquina propaga).
        importPlaylistsFromBackup([
            { name: 'X', url: 'http://prov.tv', username: 'u', password: 'senha-nova', credentialsUpdatedAt: Date.now() + 60_000 },
        ])
        expect(playlists().find(p => p.id === p1.id)?.password).toBe('senha-nova')
    })

    it('importa válidas, pula inválidas e NÃO sobrescreve credencial existente', () => {
        const active = saveAndActivatePlaylist({ url: 'http://ativa.tv', username: 'u', password: 'p' })
        const imported = importPlaylistsFromBackup([
            { name: 'Nova', url: 'http://nova.tv', username: 'x', password: 'y' },
            { name: 'Sem url', url: '  ', username: 'x', password: 'y' },
            { name: 'Sem senha', url: 'http://z.tv', username: 'x', password: undefined as unknown as string },
            // Mesmo provedor da ativa, com senha VELHA: tem que ser ignorada.
            // (Antes o upsert sobrescrevia — era o bug: a senha corrigida aqui
            // voltava pra antiga a cada ciclo de sync e o switch quebrava.)
            { name: 'Ativa', url: 'http://ativa.tv', username: 'u', password: 'p-velha' },
        ])
        expect(imported).toBe(1)
        expect(playlists()).toHaveLength(2)
        expect(playlists().find(p => p.id === active.id)?.password).toBe('p')
        expect(getActivePlaylistIdPublic()).toBe(active.id)
    })

    // 🔒 Regressão (auditoria R1 — H4): sem ledger de deleções, o arquivo de
    // sync da outra máquina reimportava a playlist apagada em TODO ciclo — e a
    // ressurreição se propagava de volta. Apagar de novo não adiantava, nunca.
    it('playlist apagada não volta pelo import (ledger de deleções)', () => {
        const p1 = saveAndActivatePlaylist({ name: 'Provedor X', url: 'http://x.tv', username: 'u', password: 'p' })
        saveAndActivatePlaylist({ name: 'Outra', url: 'http://outra.tv', username: 'u2', password: 'p2' })
        removePlaylist(p1.id)
        expect(playlists()).toHaveLength(1)

        const imported = importPlaylistsFromBackup([
            { name: 'Provedor X', url: 'http://x.tv', username: 'u', password: 'p' },
        ])
        expect(imported).toBe(0)
        expect(playlists()).toHaveLength(1)
        expect(playlists().some(p => p.url === 'http://x.tv')).toBe(false)
    })

    it('re-adicionar à mão limpa o ledger (o sync volta a aceitar aquela playlist)', () => {
        const p1 = saveAndActivatePlaylist({ name: 'Provedor X', url: 'http://x.tv', username: 'u', password: 'p' })
        removePlaylist(p1.id)
        expect(getRemovedPlaylists()[removedPlaylistKey('http://x.tv', 'u')]).toBeTruthy();

        saveAndActivatePlaylist({ name: 'Provedor X', url: 'http://x.tv', username: 'u', password: 'p' })
        expect(getRemovedPlaylists()[removedPlaylistKey('http://x.tv', 'u')]).toBeUndefined();
    })

    it('lote todo inválido → 0 e nenhuma escrita', () => {
        expect(importPlaylistsFromBackup([{ name: '', url: '', username: '', password: '' }])).toBe(0)
        expect(playlists()).toHaveLength(0)
    })
})

// ------------------------------------------------ userInfo fresco --------

describe('refreshActiveUserInfo / getActivePlaylist', () => {
    it('grava userInfo novo com carimbo na ativa e re-espelha o auth', async () => {
        const { refreshActiveUserInfo, getActivePlaylist } = await import('./playlistManager')
        saveAndActivatePlaylist({ url: 'http://a.tv', username: 'u', password: 'p', userInfo: { exp_date: '1' } })

        expect(refreshActiveUserInfo({ exp_date: '999' }, 123)).toBe(true)

        const ativa = getActivePlaylist()
        expect(ativa?.userInfo).toEqual({ exp_date: '999' })
        expect(ativa?.userInfoAt).toBe(123)
        // O espelho `auth` é o que o auth:check devolve — tem que acompanhar.
        expect((store.get('auth') as { userInfo?: unknown }).userInfo).toEqual({ exp_date: '999' })
    })

    it('sem playlist ativa, devolve false e não inventa entrada', async () => {
        const { refreshActiveUserInfo } = await import('./playlistManager')
        deactivatePlaylists()
        expect(refreshActiveUserInfo({ exp_date: '999' })).toBe(false)
    })

    it('cadastrar com userInfo carimba a hora (retrato não nasce eterno)', () => {
        const antes = Date.now()
        const entry = saveAndActivatePlaylist({ url: 'http://b.tv', username: 'u', password: 'p', userInfo: { exp_date: '2' } })
        expect(entry.userInfoAt).toBeGreaterThanOrEqual(antes)
    })
})

describe('isUserInfoFresh', () => {
    it('fresco dentro do TTL; vencido fora; legado (sem carimbo) nunca é fresco', async () => {
        const { isUserInfoFresh, USER_INFO_TTL_MS } = await import('./playlistsModel')
        expect(isUserInfoFresh(1_000, 1_000 + USER_INFO_TTL_MS - 1)).toBe(true)
        expect(isUserInfoFresh(1_000, 1_000 + USER_INFO_TTL_MS)).toBe(false)
        // Entrada de antes deste fix não tem carimbo: o retrato dela pode ter
        // QUALQUER idade — é exatamente o caso do bug, então nunca é fresco.
        expect(isUserInfoFresh(undefined, 1_000)).toBe(false)
    })
})
