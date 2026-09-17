import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔒 Regressão: o backup não levava o TIPO da lista.
 *
 * `exportPlaylistsForBackup` copiava name/url/username/password (+ carimbo) e
 * `importPlaylistsFromBackup` remontava a entrada com esses mesmos 4 campos.
 * O `type` ficava pelo caminho, e como `toPublicPlaylist` devolve
 * `entry.type ?? 'xtream'`, a lista renascia na outra máquina como Xtream.
 * Todo o roteamento do main (catálogo, `playlists:switch`, ficha de série,
 * URL do episódio, play, download, EPG) desvia por `type`, então a M3U e o
 * portal Stalker voltavam do backup e nunca mais abriam — o switch tentava
 * `new XtreamClient(portal, 'AA:BB:CC:DD:EE:FF', '__stalker__').authenticate()`.
 *
 * O campo atravessa CINCO cópias manuais do payload no renderer (App.tsx no
 * auto-backup e no sync, BackupSection.tsx na exportação e na restauração,
 * Welcome.tsx na instalação nova). Elas erraram juntas porque o compilador não
 * liga o main ao renderer: `tsc -b` só enxerga `src/` (tsconfig.app) e o
 * `electron/` nem entra no build de tipos. Por isso o teste percorre a
 * travessia INTEIRA de verdade — main → mapeador do renderer → JSON → main —
 * e só o último bloco (contrato entre projetos) lê fonte.
 */

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
    listPublicPlaylists,
    saveAndActivatePlaylist,
    exportPlaylistsForBackup,
    importPlaylistsFromBackup,
} from './playlistManager'
import {
    collectBackup,
    applyBackup,
    encodePlaylistPassword,
    toBackupPlaylist,
    toPlaylistImport,
    BACKUP_APP,
    BACKUP_VERSION,
} from '../src/services/backupService'

const RAIZ = path.join(__dirname, '..')

/** Os fontes são CRLF; normalizar antes de procurar. */
function ler(rel: string): string {
    return fs.readFileSync(path.join(RAIZ, rel), 'utf-8').split('\r\n').join('\n')
}

/** Zera o store: é a MÁQUINA DE DESTINO, onde nenhuma dessas listas existe. */
function maquinaLimpa(): void {
    store.set('auth', {})
    store.set('playlists', [])
    store.set('removedPlaylists', {})
    store.delete('activePlaylistId')
}

/** A travessia inteira: main → renderer → arquivo → renderer → main. */
function restauraNaOutraMaquina(): number {
    const arquivo = JSON.stringify(collectBackup(exportPlaylistsForBackup().map(toBackupPlaylist)))
    maquinaLimpa()
    const report = applyBackup(JSON.parse(arquivo))
    return importPlaylistsFromBackup(report.playlists.map(toPlaylistImport))
}

/** O que o APP enxerga depois do restore (não o objeto intermediário). */
function tipos(): Record<string, string> {
    return Object.fromEntries(listPublicPlaylists().map(p => [p.name, p.type]))
}

beforeEach(() => {
    localStorage.clear()
    maquinaLimpa()
})

describe('backup leva o tipo da lista até a outra máquina', () => {
    it('M3U por URL e portal Stalker voltam com o próprio tipo, não como xtream', () => {
        saveAndActivatePlaylist({ name: 'Minha M3U', url: 'http://listas.tv/x.m3u', username: 'm3u', password: 'm3u', type: 'm3u' })
        saveAndActivatePlaylist({ name: 'Portal', url: 'http://portal.tv/c/', username: 'AA:BB:CC:DD:EE:FF', password: '__stalker__', type: 'stalker' })
        saveAndActivatePlaylist({ name: 'Conta', url: 'http://prov.tv', username: 'u', password: 'p' })

        expect(restauraNaOutraMaquina()).toBe(3)
        expect(tipos()).toEqual({ 'Minha M3U': 'm3u', 'Portal': 'stalker', 'Conta': 'xtream' })
        // A credencial continua chegando inteira (o tipo não atropelou nada).
        expect((store.get('playlists') as PlaylistEntry[]).find(p => p.name === 'Portal')?.password).toBe('__stalker__')
    })

    it('backup escrito por build antiga (sem o campo) continua restaurando como xtream', () => {
        const antigo = {
            version: BACKUP_VERSION, exportedAt: 'x', app: BACKUP_APP, data: {},
            playlists: [{ name: 'Legada', url: 'http://old.tv', username: 'u', passwordB64: encodePlaylistPassword('p') }],
        }
        const report = applyBackup(JSON.parse(JSON.stringify(antigo)))
        expect(importPlaylistsFromBackup(report.playlists.map(toPlaylistImport))).toBe(1)
        expect(tipos()).toEqual({ 'Legada': 'xtream' })
    })

    it('backup legado NÃO rebaixa para xtream um tipo que já existe aqui', () => {
        // Normalizar o ausente para 'xtream' (como o import do celular faz)
        // quebraria um portal que funcionava; passar `undefined` deixa o
        // `upsertPlaylist` preservar o type local (`input.type ?? existing.type`).
        store.set('playlists', [{
            id: 'pl_x', name: 'Portal', url: 'http://portal.tv/c/', username: 'AA:BB:CC:DD:EE:FF',
            password: 'antiga', addedAt: 1, credentialsUpdatedAt: 1_000, type: 'stalker',
        } satisfies PlaylistEntry])

        importPlaylistsFromBackup([
            { name: 'Portal', url: 'http://portal.tv/c/', username: 'AA:BB:CC:DD:EE:FF', password: 'nova', credentialsUpdatedAt: 9_000 },
        ])
        expect(tipos()).toEqual({ 'Portal': 'stalker' })
        expect((store.get('playlists') as PlaylistEntry[])[0].password).toBe('nova')
    })

    it('M3U aberta de ARQUIVO do PC é RECUSADA no import (mesmo portão do celular)', () => {
        // Cadastrar um caminho de disco como 'm3u' faz o `listaDeDiscoCadastrada`
        // (ipcHandlers.ts) liberar a LEITURA daquele caminho no processo
        // principal — e o sync importa qualquer arquivo da pasta compartilhada.
        saveAndActivatePlaylist({ name: 'Do disco', url: 'C:\\Listas\\minha.m3u', username: 'm3u', password: 'm3u', type: 'm3u' })
        saveAndActivatePlaylist({ name: 'Conta', url: 'http://prov.tv', username: 'u', password: 'p' })

        expect(restauraNaOutraMaquina()).toBe(1)
        expect(tipos()).toEqual({ 'Conta': 'xtream' })
    })

    it('tipo desconhecido morre nos DOIS lados (nenhum confia no outro)', () => {
        // Ponta renderer: o sanitizer não repassa o valor cru pro main.
        const forjado = {
            version: BACKUP_VERSION, exportedAt: 'x', app: BACKUP_APP, data: {},
            playlists: [{ name: 'Kodi', url: 'http://k.tv', username: 'u', passwordB64: encodePlaylistPassword('p'), type: 'kodi' }],
        }
        expect(applyBackup(JSON.parse(JSON.stringify(forjado))).playlists[0].type).toBeUndefined()

        // Ponta main: chamado direto (renderer comprometido), normaliza também.
        importPlaylistsFromBackup([
            { name: 'Kodi', url: 'http://k.tv', username: 'u', password: 'p', type: 'kodi' as never },
        ])
        expect(tipos()).toEqual({ 'Kodi': 'xtream' })
    })
})

describe('contrato entre main e renderer (o compilador não liga os dois)', () => {
    it('todo chamador dos dois canais de backup passa pelos mapeadores', () => {
        const fontes = (function varrer(dir: string): string[] {
            return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
                const p = path.join(dir, e.name)
                if (e.isDirectory()) return varrer(p)
                return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
            })
        })(path.join(RAIZ, 'src'))

        const veredito: string[] = []
        let importadores = 0
        let exportadores = 0
        for (const arquivo of fontes) {
            const fonte = fs.readFileSync(arquivo, 'utf-8').split('\r\n').join('\n')
            const rel = path.relative(RAIZ, arquivo)
            if (fonte.includes(`'backup:import-playlists'`)) {
                importadores++
                // Usa o mapeador E não remonta o payload à mão logo abaixo.
                veredito.push(`${rel} import: ${String(fonte.includes('toPlaylistImport') && !fonte.includes('decodePlaylistPassword(p.passwordB64)'))}`)
            }
            if (fonte.includes(`'backup:export-playlists'`)) {
                exportadores++
                veredito.push(`${rel} export: ${String(fonte.includes('toBackupPlaylist') && !fonte.includes('encodePlaylistPassword(p.password)'))}`)
            }
        }

        // Sem estes dois, o guarda passaria por não ter achado ninguém.
        expect(importadores).toBeGreaterThanOrEqual(3)
        expect(exportadores).toBeGreaterThanOrEqual(2)
        expect(veredito.filter(v => v.endsWith('false'))).toEqual([])
    })

    it('os três lugares que listam os tipos de lista concordam', () => {
        // Um tipo novo no main que o sanitizer do renderer não conheça seria
        // descartado em silêncio no restore — a mesma falha do D080, de novo.
        // Da âncora até o fim da linha SEGUINTE: cobre tanto a declaração de
        // uma linha só quanto o `return` do validador, sem vazar pro vizinho.
        const uniao = (fonte: string, ancora: RegExp): string[] => {
            const i = fonte.search(ancora)
            expect(i).toBeGreaterThan(-1)
            const trecho = fonte.slice(i).split('\n').slice(0, 2).join('\n')
            return [...trecho.matchAll(/'([a-z0-9]+)'/g)].map(m => m[1]).sort()
        }
        const modelo = uniao(ler('electron/playlistsModel.ts'), /type\?: 'xtream'/)
        const main = uniao(ler('electron/playlistManager.ts'), /type\?: 'xtream'/)
        const renderer = uniao(ler('src/services/backupService.ts'), /export type PlaylistKind =/)
        const validador = uniao(ler('src/services/backupService.ts'), /export function isPlaylistKind/)

        expect(modelo).toEqual(['m3u', 'stalker', 'xtream'])
        expect(main).toEqual(modelo)
        expect(renderer).toEqual(modelo)
        expect(validador).toEqual(modelo)
    })
})
