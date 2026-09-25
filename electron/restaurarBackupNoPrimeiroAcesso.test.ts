/**
 * D079 — restaurar o backup no PRIMEIRO ACESSO tem de deixar o usuário DENTRO.
 *
 * O card "Restaurar backup" do Welcome gravava as listas do arquivo
 * (`backup:import-playlists` -> `importPlaylistsFromBackup`), mas o import de
 * propósito não ativava nada — e o boot decide por `auth:check`, que lê o
 * espelho `auth` da playlist ATIVA. Resultado: `reloadIntoDashboard` e o
 * `<Navigate to="/login">` da rota /dashboard, como se o restore não tivesse
 * feito nada (e quem restaurou M3U/Stalker nem tinha como "redigitar").
 *
 * O teste roda o caminho que o usuário percorre: monta o Welcome de verdade,
 * clica em Continuar e em Restaurar backup, e o IPC dublê entrega o payload ao
 * `importPlaylistsFromBackup` REAL do main (store em memória) do mesmo jeito
 * que o handler entrega. O que se afirma é o estado que o boot lê.
 *
 * Os elos que nenhum teste de unidade alcança — o handler repassar a opção, e
 * NENHUMA outra porta do renderer pedir a ativação — são guardados lendo a
 * fonte, no molde do D107 (identidadeDaPlaylistNoBackup.test.ts).
 *
 * Mora em electron/ (e sem JSX) porque importa o manager do main: em src/ o
 * `tsc -b` do app arrastaria o logger (`process`) e o `node:fs` pro typecheck.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'

// Store em memória (mesmo molde de electron/playlistManager.test.ts).
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
import {
    importPlaylistsFromBackup,
    listPublicPlaylists,
    saveAndActivatePlaylist,
    removePlaylist,
    deactivatePlaylists,
    getActivePlaylist,
} from './playlistManager'
import type { PlaylistBackupEntry } from './playlistManager'
import { Welcome } from '../src/pages/Welcome'
import { playlistService } from '../src/services/playlistService'
import { collectBackup, toBackupPlaylist } from '../src/services/backupService'
import { languageService } from '../src/services/languageService'

const RAIZ = path.join(__dirname, '..')

/** Os fontes são CRLF; normalizar antes de procurar. */
function ler(rel: string): string {
    return fs.readFileSync(path.join(RAIZ, rel), 'utf-8').split('\r\n').join('\n')
}

/** O mesmo critério do handler `auth:check` (electron/ipcHandlers.ts). */
function authCheck(): { authenticated: boolean } {
    const auth = (store.get('auth') ?? {}) as { url?: string; username?: string; password?: string }
    return { authenticated: Boolean(auth.url && auth.username && auth.password) }
}

/** Zera a "máquina": store limpo, sem playlists nem ledger de removidas. */
function maquinaNova() {
    store.set('auth', {})
    store.set('playlists', [])
    store.delete('activePlaylistId')
    store.delete('removedPlaylists')
}

const XTREAM: PlaylistBackupEntry = {
    id: 'pl-origem-xtream',
    name: 'Casa',
    url: 'http://provedor-a.example:8080',
    username: 'ana',
    password: 'segredo',
}
const M3U: PlaylistBackupEntry = {
    id: 'pl-origem-m3u',
    name: 'Lista',
    url: 'http://provedor-b.example/lista.m3u',
    username: 'm3u',
    password: 'm3u',
    type: 'm3u',
}

let container: HTMLDivElement
let root: Root
let pedidos: unknown[]
let recarregou: boolean
const ipcOriginal = (window as unknown as { ipcRenderer?: unknown }).ipcRenderer

/**
 * IPC dublê: só a propriedade `ipcRenderer` (nunca o `window` inteiro).
 * `backup:import-playlists` faz o que o handler faz: repassa `playlists` e
 * `activateIfNone` ao manager real (o guarda de fonte abaixo prende o handler
 * a esse mesmo repasse).
 */
function instalarIpc(backupJson: string) {
    const invoke = vi.fn(async (canal: string, args?: unknown) => {
        if (canal === 'backup:load-file') return { success: true, json: backupJson }
        if (canal === 'backup:import-playlists') {
            pedidos.push(args)
            const { playlists, activateIfNone } = args as { playlists: PlaylistBackupEntry[]; activateIfNone?: boolean }
            const { imported, idMap } = importPlaylistsFromBackup(
                Array.isArray(playlists) ? playlists : [],
                { activateIfNone: activateIfNone === true }
            )
            return { success: true, imported, idMap }
        }
        return { success: true }
    })
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = { invoke, on: vi.fn(), off: vi.fn(), send: vi.fn() }
}

/** Espera uma CONDIÇÃO, não um número de microtasks. */
async function esperarAte(cond: () => boolean, oQue: string) {
    const limite = Date.now() + 5000
    while (!cond()) {
        if (Date.now() > limite) throw new Error(`esperei demais: ${oQue}`)
        await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    }
}

async function clicar(el: Element) {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

function botaoComTexto(texto: string): HTMLButtonElement {
    const botoes = Array.from(container.querySelectorAll('button'))
    const achado = botoes.find(b => (b.textContent ?? '').includes(texto))
    if (!achado) throw new Error(`não achei o botão "${texto}" no Welcome`)
    return achado
}

/** Percorre o Welcome como o usuário: Continuar -> Restaurar backup. */
async function restaurarPeloWelcome(backupJson: string) {
    instalarIpc(backupJson)
    await act(async () => {
        root.render(createElement(MemoryRouter, null, createElement(Welcome)))
    })
    await clicar(botaoComTexto(languageService.t('welcome', 'continue')))
    await clicar(botaoComTexto(languageService.t('welcome', 'restoreBackup')))
    await esperarAte(() => recarregou, 'o Welcome não chegou a recarregar o app')
}

/** O arquivo, montado pelo mesmo caminho do "Exportar backup". */
function arquivoDeBackup(entradas: PlaylistBackupEntry[]): string {
    const json = JSON.stringify(collectBackup(entradas.map(toBackupPlaylist)))
    localStorage.clear() // o arquivo foi "feito em outra máquina"
    return json
}

beforeEach(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // Constante que o Vite injeta no build; o `collectBackup` carimba o arquivo com ela.
    vi.stubGlobal('__APP_VERSION__', '0.0.0-teste')
    localStorage.clear()
    maquinaNova()
    pedidos = []
    recarregou = false
    vi.spyOn(playlistService, 'reloadIntoDashboard').mockImplementation(() => { recarregou = true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    ;(window as unknown as { ipcRenderer?: unknown }).ipcRenderer = ipcOriginal
    localStorage.clear()
})

describe('D079 — restaurar backup no primeiro acesso', () => {
    it('o Welcome restaura e o boot seguinte já encontra uma sessão (não cai no /login)', async () => {
        await restaurarPeloWelcome(arquivoDeBackup([XTREAM, M3U]))

        expect(pedidos).toHaveLength(1)
        expect(listPublicPlaylists().map(p => p.name).sort()).toEqual(['Casa', 'Lista'])
        // O que o boot lê: sem isto a rota /dashboard faz <Navigate to="/login">.
        expect(authCheck().authenticated).toBe(true)
        expect(getActivePlaylist()?.url).toBe(XTREAM.url)
        expect(listPublicPlaylists().filter(p => p.active).map(p => p.name)).toEqual(['Casa'])
    })

    it('backup só com lista M3U também entra (quem restaurou M3U não tinha como redigitar no /login)', async () => {
        await restaurarPeloWelcome(arquivoDeBackup([M3U]))

        expect(authCheck().authenticated).toBe(true)
        expect(getActivePlaylist()?.type).toBe('m3u')
    })

    it('depois de um logout, restaurar pelo Welcome entra de novo (sem trocar nada que esteja ativo)', async () => {
        saveAndActivatePlaylist({ name: 'Casa', url: XTREAM.url, username: XTREAM.username, password: XTREAM.password })
        deactivatePlaylists()
        expect(authCheck().authenticated).toBe(false)

        await restaurarPeloWelcome(arquivoDeBackup([XTREAM]))

        expect(listPublicPlaylists()).toHaveLength(1)
        expect(authCheck().authenticated).toBe(true)
    })
})

describe('D079 — a ativação é só do primeiro acesso', () => {
    it('sem a opção (sync, restore das Configurações) nada é ativado', () => {
        const r = importPlaylistsFromBackup([XTREAM, M3U])
        expect(r.imported).toBe(2)
        expect(getActivePlaylist()).toBeNull()
        expect(authCheck().authenticated).toBe(false)
    })

    it('o sync não desfaz um logout, mesmo com as listas já aqui', () => {
        saveAndActivatePlaylist({ name: 'Casa', url: XTREAM.url, username: XTREAM.username, password: XTREAM.password })
        deactivatePlaylists()
        importPlaylistsFromBackup([XTREAM, M3U], { activateIfNone: false })
        expect(getActivePlaylist()).toBeNull()
        expect(authCheck().authenticated).toBe(false)
    })

    it('com playlist já ativa, o arquivo NÃO troca a lista de ninguém', () => {
        const minha = saveAndActivatePlaylist({ name: 'Minha', url: 'http://meu.example', username: 'eu', password: 'x' })
        const r = importPlaylistsFromBackup([XTREAM], { activateIfNone: true })
        expect(r.imported).toBe(1)
        expect(getActivePlaylist()?.id).toBe(minha.id)
        expect((store.get('auth') as { url?: string }).url).toBe('http://meu.example')
    })

    it('a ativada é a primeira do ARQUIVO (id local dela)', () => {
        const r = importPlaylistsFromBackup([M3U, XTREAM], { activateIfNone: true })
        expect(getActivePlaylist()?.id).toBe(r.idMap[M3U.id as string])
        expect(getActivePlaylist()?.url).toBe(M3U.url)
    })

    it('backup antigo (sem id) também ativa', () => {
        const semId: PlaylistBackupEntry = { name: XTREAM.name, url: XTREAM.url, username: XTREAM.username, password: XTREAM.password }
        importPlaylistsFromBackup([semId], { activateIfNone: true })
        expect(getActivePlaylist()?.url).toBe(XTREAM.url)
        expect(authCheck().authenticated).toBe(true)
    })

    it('playlist que já mora aqui (sem ativa) é reaproveitada, sem duplicar', () => {
        const local = saveAndActivatePlaylist({ name: 'Casa', url: XTREAM.url, username: XTREAM.username, password: XTREAM.password })
        deactivatePlaylists()
        const r = importPlaylistsFromBackup([XTREAM], { activateIfNone: true })
        expect(r.imported).toBe(0)
        expect(getActivePlaylist()?.id).toBe(local.id)
        expect(listPublicPlaylists()).toHaveLength(1)
        expect(authCheck().authenticated).toBe(true)
    })

    it('apagada de propósito (tombstone) não ressuscita como ativa', () => {
        const local = saveAndActivatePlaylist({ name: 'Casa', url: XTREAM.url, username: XTREAM.username, password: XTREAM.password })
        removePlaylist(local.id)
        const r = importPlaylistsFromBackup([XTREAM], { activateIfNone: true })
        expect(r.imported).toBe(0)
        expect(getActivePlaylist()).toBeNull()
        expect(listPublicPlaylists()).toHaveLength(0)
        expect(authCheck().authenticated).toBe(false)
    })

    it('o handler do IPC repassa a opção ao manager (elo que o compilador não vê)', () => {
        const fonte = ler('electron/ipcHandlers.ts')
        const ini = fonte.indexOf("ipcMain.handle('backup:import-playlists'")
        expect(ini).toBeGreaterThan(-1)
        const trecho = fonte.slice(ini, fonte.indexOf('ipcMain.handle(', ini + 10))
        // Estrito: `activateIfNone: true` fixo faria o SYNC ativar playlist
        // (e desfazer logout); sumir com a opção devolve o D079.
        expect(/importPlaylistsFromBackup\([^;]*\{\s*activateIfNone:\s*activateIfNone\s*===\s*true\s*\}\s*\)/.test(trecho)).toBe(true)
        expect(/\{\s*playlists,\s*activateIfNone\s*\}/.test(trecho)).toBe(true)
    })

    it('só o Welcome pede a ativação: nenhuma outra porta do renderer', () => {
        const pedem = (function varrer(dir: string): string[] {
            return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
                const p = path.join(dir, e.name)
                if (e.isDirectory()) return varrer(p)
                if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) return []
                return fs.readFileSync(p, 'utf-8').includes('activateIfNone') ? [path.relative(RAIZ, p).split('\\').join('/')] : []
            })
        })(path.join(RAIZ, 'src'))
        expect(pedem).toEqual(['src/pages/Welcome.tsx'])
    })
})
