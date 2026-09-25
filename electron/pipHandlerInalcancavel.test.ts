// @vitest-environment node
/**
 * 🧹 D122 — o main não registra handler de PiP que nenhuma janela alcança.
 *
 * O `pip:getState` e o `pip:getClickThrough` estavam registrados no main e
 * FORA da whitelist `invokeChannels` do preload. A janela principal, a do PiP
 * e a do multi-view carregam o MESMO `preload.mjs` (main.ts e pipHandlers.ts),
 * então nenhuma delas conseguia chamá-los — o preload recusa com
 * `Blocked IPC channel` — e nenhuma chamava. O `pip:getState` ainda dava a
 * impressão de que existe uma leitura do estado do PiP sem efeito colateral;
 * o caminho de verdade é o `pip:close-and-get` (VideoPlayer), que fecha a
 * janela e devolve o conteúdo com a posição. E o `closePipWindow` era
 * exportado sem um único importador.
 *
 * O guarda do preload (preloadChannels.test.ts) cruza a whitelist com o
 * renderer/e2e nos dois sentidos, mas não olha os `ipcMain.handle` do main:
 * handler registrado sem porta no preload passava por ele. Mesmo guarda do
 * `downloadHandlerInalcancavel.test.ts` (#D067) e do
 * `epgHandlerInalcancavel.test.ts` (#D038), agora nos namespaces `pip:` e
 * `multiview:` (ambos registrados pelo pipHandlers.ts): os handlers sobem de
 * verdade, com um ipcMain de mentira, e o teste cobra os dois lados da ponte
 * — todo canal registrado tem porta no preload, e toda porta tem handler (a
 * limpeza não pode levar junto um handler vivo).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const h = vi.hoisted(() => ({
    /** ipcMain.handle / handleOnce: portas de invoke. */
    handles: new Map<string, IpcHandler>(),
    /** ipcMain.on / once: portas de send. */
    ons: new Map<string, IpcHandler>(),
}))

vi.mock('electron', () => ({
    BrowserWindow: class { /* nenhuma janela é criada aqui */ },
    ipcMain: {
        // handleOnce também: um handler de uso único continua sendo porta do main.
        handle: (canal: string, fn: IpcHandler) => { h.handles.set(canal, fn) },
        handleOnce: (canal: string, fn: IpcHandler) => { h.handles.set(canal, fn) },
        on: (canal: string, fn: IpcHandler) => { h.ons.set(canal, fn) },
        once: (canal: string, fn: IpcHandler) => { h.ons.set(canal, fn) },
        removeListener: () => undefined,
    },
    screen: {
        getPrimaryDisplay: () => ({ id: 1, label: '', size: { width: 1920, height: 1080 } }),
        getAllDisplays: () => [],
    },
    globalShortcut: { register: () => true },
}))
vi.mock('electron-store', () => ({
    default: class {
        get() { return undefined }
        set() { /* noop */ }
        delete() { /* noop */ }
    },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import * as pip from './pipHandlers'

const NAMESPACES = ['pip:', 'multiview:']
const doPip = (canal: string) => NAMESPACES.some(ns => canal.startsWith(ns))

/** Nomes literais de uma `const <nome> = new Set([...])` do preload. */
function whitelist(listName: string): Set<string> {
    const preload = fs.readFileSync(path.join(__dirname, 'preload.ts'), 'utf-8')
    const match = new RegExp(`const ${listName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(preload)
    if (!match) throw new Error(`lista ${listName} não encontrada no preload`)
    return new Set([...match[1].matchAll(/'([^']+)'/g)].map(entry => entry[1]))
}

/** Todos os .ts do main (electron/), menos os testes. */
function arquivosDoMain(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) arquivosDoMain(full, out)
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full)
    }
    return out
}

describe('handlers de PiP registrados no main', () => {
    beforeAll(() => {
        h.handles.clear()
        h.ons.clear()
        pip.setupPipHandlers({ isDestroyed: () => false } as unknown as BrowserWindow)
    })

    it('registra os handlers (sanidade do ipcMain de mentira)', () => {
        expect(h.handles.size).toBeGreaterThan(0)
        // Os canais que as telas usam de verdade continuam.
        expect(h.handles.has('pip:open')).toBe(true)
        expect(h.handles.has('pip:close')).toBe(true)
        expect(h.handles.has('pip:close-and-get')).toBe(true)
        expect(h.handles.has('pip:clickThrough')).toBe(true)
        expect(h.handles.has('multiview:open')).toBe(true)
        expect(h.ons.has('pip:state')).toBe(true)
    })

    it('não registra o pip:getState nem o pip:getClickThrough, que nenhuma janela alcança', () => {
        expect(h.handles.has('pip:getState')).toBe(false)
        expect(h.handles.has('pip:getClickThrough')).toBe(false)
    })

    it('todo canal pip:/multiview: de invoke registrado tem porta no invokeChannels do preload', () => {
        const permitidos = whitelist('invokeChannels')
        const inalcancaveis = [...h.handles.keys()]
            .filter(canal => doPip(canal) && !permitidos.has(canal))
        expect(inalcancaveis).toEqual([])
    })

    it('todo canal pip:/multiview: de send ouvido no main tem porta no sendChannels do preload', () => {
        const permitidos = whitelist('sendChannels')
        const inalcancaveis = [...h.ons.keys()]
            .filter(canal => doPip(canal) && !permitidos.has(canal))
        expect(inalcancaveis).toEqual([])
    })

    it('toda porta pip:/multiview: de invoke do preload tem handler registrado', () => {
        const portas = [...whitelist('invokeChannels')].filter(doPip)
        expect(portas.length).toBeGreaterThan(0)
        const semHandler = portas.filter(canal => !h.handles.has(canal))
        expect(semHandler).toEqual([])
    })

    it('toda porta pip:/multiview: de send do preload tem ouvinte no main', () => {
        const portas = [...whitelist('sendChannels')].filter(doPip)
        expect(portas.length).toBeGreaterThan(0)
        const semOuvinte = portas.filter(canal => !h.ons.has(canal))
        expect(semOuvinte).toEqual([])
    })

    it('nenhum outro arquivo do main registra canal pip:/multiview: sem porta no preload', () => {
        const permitidos = whitelist('invokeChannels')
        const padrao = /ipcMain\??\.(?:handle|handleOnce)\(\s*['"`]((?:pip|multiview):[^'"`]+)['"`]/g
        const inalcancaveis: string[] = []
        for (const arquivo of arquivosDoMain(__dirname)) {
            const fonte = fs.readFileSync(arquivo, 'utf-8')
            for (const achado of fonte.matchAll(padrao)) {
                if (!permitidos.has(achado[1])) {
                    inalcancaveis.push(`${path.basename(arquivo)}: ${achado[1]}`)
                }
            }
        }
        expect(inalcancaveis).toEqual([])
    })

    it('todo export do pipHandlers tem importador no main (o closePipWindow não tinha)', () => {
        const fontes = arquivosDoMain(__dirname)
            .filter(arquivo => path.basename(arquivo) !== 'pipHandlers.ts')
            .map(arquivo => fs.readFileSync(arquivo, 'utf-8'))
        const importa = (nome: string) => fontes.some(fonte =>
            new RegExp(`import\\s*\\{[^}]*\\b${nome}\\b[^}]*\\}\\s*from\\s*['"]\\./pipHandlers(?:\\.js)?['"]`).test(fonte))
        const semImportador = Object.keys(pip).filter(nome => !importa(nome))
        expect(Object.keys(pip).length).toBeGreaterThan(0)
        expect(semImportador).toEqual([])
        expect('closePipWindow' in pip).toBe(false)
    })
})
