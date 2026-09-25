// @vitest-environment node
/**
 * 🧹 D038 — o main não registra handler de EPG que nenhuma tela alcança.
 *
 * O `epg:get-cache-info` (lia o `.meta.json` do cache a partir de um
 * `cacheKey` vindo de fora) e o `epg:provider-available` (só disparava a sonda
 * do XMLTV do provedor) estavam registrados no main e FORA da whitelist
 * `invokeChannels` do preload: nenhuma tela conseguia chamá-los (o preload
 * recusa com `Blocked IPC channel`) e nenhuma chamava.
 *
 * Mesmo guarda do `downloadHandlerInalcancavel.test.ts` (#D067), agora no
 * namespace `epg:`: os handlers sobem de verdade (`setupIpcHandlers()`, que
 * também chama o `setupProviderEpgHandlers()`), e o teste cobra os dois lados
 * da ponte — todo canal registrado tem porta no preload, e toda porta tem
 * handler (a limpeza não pode levar junto um handler vivo).
 *
 * E, como pediu o cético, fica provado que a sonda do XMLTV do provedor
 * (`ensureXmltvIndex`) continua tendo gatilho pelos dois canais que ficam:
 * o que se conta é o pedido ao `xmltv.php` que SAIU para a rede.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const h = vi.hoisted(() => {
    const handlers = new Map<string, IpcHandler>()
    const registrar = (canal: string, fn: IpcHandler) => {
        handlers.set(canal, fn)
    }
    return {
        handlers,
        registrar,
        userData: '',
        /** URLs que SAÍRAM para a rede. */
        fetches: [] as string[],
    }
})

vi.mock('electron', () => ({
    // handleOnce também: um handler de uso único continua sendo porta do main.
    ipcMain: { handle: h.registrar, handleOnce: h.registrar, on: () => undefined, removeHandler: () => undefined },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    dialog: {},
    screen: {},
    shell: {},
    app: { getPath: () => h.userData, getVersion: () => '0.0.0', getName: () => 'neostream' },
}))

// Store em memória, já logado: a sonda do XMLTV só sai com credencial.
vi.mock('./store', () => {
    const dados = new Map<string, unknown>([
        ['auth', { url: 'http://provedor.exemplo:8080', username: 'dono', password: 'segredo' }],
        ['playlists', []],
    ])
    return {
        default: {
            get: (chave: string) => dados.get(chave),
            set: (chave: string, valor: unknown) => { dados.set(chave, valor) },
            delete: (chave: string) => { dados.delete(chave) },
        },
    }
})
vi.mock('./logger', () => ({
    default: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
}))
vi.mock('./mpvPlayer', () => ({ esconderMpvParaDialogo: () => undefined }))

// 404 de propósito: é falha definitiva (sem nova tentativa com espera), o
// provedor fica "sem XMLTV" e o teste só precisa saber que a rede foi tocada.
vi.mock('node-fetch', () => ({
    default: async (url: string) => {
        h.fetches.push(url)
        return {
            ok: false,
            status: 404,
            url,
            headers: { get: () => null },
            body: (async function* () { yield Buffer.from('', 'utf-8') })(),
        }
    },
}))

import { setupIpcHandlers } from './ipcHandlers'
import { resetProviderEpgState } from './providerEpg'

/** Nomes literais da `const invokeChannels = new Set([...])` do preload. */
function invokeChannels(): Set<string> {
    const preload = fs.readFileSync(path.join(__dirname, 'preload.ts'), 'utf-8')
    const match = /const invokeChannels = new Set\(\[([\s\S]*?)\]\)/.exec(preload)
    if (!match) throw new Error('lista invokeChannels não encontrada no preload')
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

/** Espera a CONDIÇÃO (a sonda passa por import dinâmico e rede, não por microtask). */
async function esperar(condicao: () => boolean, limiteMs = 2000): Promise<void> {
    const fim = Date.now() + limiteMs
    while (!condicao()) {
        if (Date.now() > fim) throw new Error('a condição não aconteceu a tempo')
        await new Promise(resolve => { setTimeout(resolve, 5) })
    }
}

function invocar(canal: string, payload: unknown): Promise<unknown> {
    const handler = h.handlers.get(canal)
    if (!handler) throw new Error(`o canal ${canal} não foi registrado`)
    return handler(null, payload)
}

const pediuXmltv = () => h.fetches.some(url => url.includes('/xmltv.php'))

describe('handlers de EPG registrados no main', () => {
    beforeAll(() => {
        h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-epg-inalcancavel-'))
        h.handlers.clear()
        setupIpcHandlers()
    })

    beforeEach(() => {
        resetProviderEpgState()
        h.fetches = []
    })

    afterAll(() => {
        fs.rmSync(h.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('registra os handlers (sanidade do ipcMain de mentira)', () => {
        expect(h.handlers.size).toBeGreaterThan(0)
        // Os canais de EPG que as telas usam de verdade continuam.
        expect(h.handlers.has('epg:get-cached')).toBe(true)
        expect(h.handlers.has('epg:provider-channel')).toBe(true)
        expect(h.handlers.has('epg:provider-search')).toBe(true)
    })

    it('não registra o epg:get-cache-info nem o epg:provider-available, que nenhuma tela alcança', () => {
        expect(h.handlers.has('epg:get-cache-info')).toBe(false)
        expect(h.handlers.has('epg:provider-available')).toBe(false)
    })

    it('todo canal epg:* registrado tem porta no invokeChannels do preload', () => {
        const permitidos = invokeChannels()
        const inalcancaveis = [...h.handlers.keys()]
            .filter(canal => canal.startsWith('epg:') && !permitidos.has(canal))
        expect(inalcancaveis).toEqual([])
    })

    it('toda porta epg:* do preload tem handler registrado', () => {
        const portas = [...invokeChannels()].filter(canal => canal.startsWith('epg:'))
        expect(portas.length).toBeGreaterThan(0)
        const semHandler = portas.filter(canal => !h.handlers.has(canal))
        expect(semHandler).toEqual([])
    })

    it('nenhum outro arquivo do main registra canal epg:* sem porta no preload', () => {
        const permitidos = invokeChannels()
        const padrao = /ipcMain\.(?:handle|handleOnce)\(\s*['"`](epg:[^'"`]+)['"`]/g
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

    it('a busca de programas continua disparando a sonda do XMLTV do provedor', async () => {
        await invocar('epg:provider-search', { query: 'jornal' })
        await esperar(pediuXmltv)
        expect(pediuXmltv()).toBe(true)
    })

    it('o guia por canal continua disparando a sonda do XMLTV do provedor', async () => {
        await invocar('epg:provider-channel', { channelId: 'canal.exemplo' })
        await esperar(pediuXmltv)
        expect(pediuXmltv()).toBe(true)
    })
})
