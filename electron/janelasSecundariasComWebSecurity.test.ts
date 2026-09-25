/**
 * #D140 — PiP e multi-view com a same-origin policy desligada.
 *
 * A janela principal é criada com `webSecurity: true` (main.ts) desde o modo
 * de compatibilidade de certificado. As duas janelas secundárias carregam o
 * MESMO `index.html` e o MESMO `preload.mjs` — o App sobe inteiro ali dentro:
 * hls.js, TMDB, pontes — e mesmo assim eram criadas com `webSecurity: false`,
 * o que derruba a same-origin policy e liga `allowRunningInsecureContent` só
 * nelas. Nada que rode nelas deixa de rodar na principal com a política
 * ligada (a LiveTV monta o mesmo MultiView dentro da principal), então o
 * afrouxamento era só superfície a mais.
 *
 * O teste abre as duas janelas pelos handlers de verdade (`pip:open` e
 * `multiview:open`) e lê as opções que chegaram no construtor da
 * BrowserWindow — nos DOIS jeitos de carregar a página: empacotado
 * (`loadFile` do index.html) e dev (`loadURL` do servidor do Vite). A
 * política não pode depender do modo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'

type Manipulador = (event: unknown, ...args: unknown[]) => unknown

interface OpcoesDaJanela {
    webPreferences?: Record<string, unknown>
}

const estado = vi.hoisted(() => {
    const criadas: { opcoes: OpcoesDaJanela; carregou: string[] }[] = []

    class JanelaFalsa {
        readonly webContents = { on: () => undefined, send: () => undefined }
        readonly carregou: string[] = []
        private readonly ouvintes = new Map<string, (() => void)[]>()

        constructor(readonly opcoes: OpcoesDaJanela = {}) { criadas.push(this) }

        on(evento: string, fn: () => void) {
            const lista = this.ouvintes.get(evento) ?? []
            lista.push(fn)
            this.ouvintes.set(evento, lista)
            return this
        }

        close() { /* noop */ }
        isDestroyed() { return false }
        getBounds() { return { x: 0, y: 0, width: 400, height: 250 } }
        isAlwaysOnTop() { return true }
        setPosition() { /* noop */ }
        setBounds() { /* noop */ }
        setAlwaysOnTop() { /* noop */ }
        moveTop() { /* noop */ }
        loadURL() { this.carregou.push('url'); return Promise.resolve() }
        loadFile() { this.carregou.push('arquivo'); return Promise.resolve() }
        show() { /* noop */ }
        focus() { /* noop */ }
        setMenuBarVisibility() { /* noop */ }
        setIgnoreMouseEvents() { /* noop */ }
    }

    const TELA = {
        id: 1,
        label: 'Monitor 1',
        size: { width: 1920, height: 1080 },
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    }

    return { criadas, TELA, JanelaFalsa, handlers: new Map<string, Manipulador>() }
})

vi.mock('electron', () => ({
    BrowserWindow: estado.JanelaFalsa,
    ipcMain: {
        handle: (canal: string, fn: Manipulador) => { estado.handlers.set(canal, fn) },
        on: () => undefined,
        once: () => undefined,
        removeListener: () => undefined,
    },
    screen: {
        getPrimaryDisplay: () => estado.TELA,
        getAllDisplays: () => [estado.TELA],
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

const invocar = async (canal: string, carga?: unknown) => {
    const fn = estado.handlers.get(canal)
    if (!fn) throw new Error(`handler ${canal} não foi registrado`)
    return await fn(null, carga)
}

/** A ÚLTIMA janela criada — a que o handler acabou de abrir. */
const ultimaJanela = () => {
    const ultima = estado.criadas[estado.criadas.length - 1]
    if (!ultima) throw new Error('nenhuma BrowserWindow foi criada')
    const prefs = ultima.opcoes.webPreferences
    if (!prefs) throw new Error('a janela foi criada sem webPreferences')
    return { prefs, carregou: ultima.carregou }
}

const MODOS = [
    { nome: 'empacotado', devServer: undefined, carrega: 'arquivo' },
    { nome: 'dev', devServer: 'http://localhost:5173', carrega: 'url' },
] as const

describe.each(MODOS)('janelas secundárias (PiP e multi-view) — #D140 ($nome)', ({ devServer, carrega }) => {
    beforeEach(async () => {
        vi.stubEnv('VITE_DEV_SERVER_URL', devServer)
        vi.resetModules()
        estado.handlers.clear()
        estado.criadas.length = 0
        const principal = new estado.JanelaFalsa()
        estado.criadas.length = 0 // a janela principal não entra na conta
        const mod = await import('./pipHandlers')
        mod.setupPipHandlers(principal as unknown as BrowserWindow)
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('a janela do PiP sobe com a same-origin policy ligada, como a principal', async () => {
        await invocar('pip:open', { src: 'http://prov.tv/a.ts', title: 'Canal A', contentType: 'live' })

        expect(estado.criadas).toHaveLength(1)
        const { prefs, carregou } = ultimaJanela()
        // O modo pedido é o que rodou de verdade (senão o outro ramo passa batido).
        expect(carregou).toEqual([carrega])
        expect(prefs.webSecurity).toBe(true)
        expect(prefs.allowRunningInsecureContent).not.toBe(true)
        // O resto do isolamento continua como estava.
        expect(prefs.contextIsolation).toBe(true)
        expect(prefs.nodeIntegration).toBe(false)
        expect(String(prefs.preload).endsWith('preload.mjs')).toBe(true)
    })

    it('a janela do multi-view sobe com a same-origin policy ligada, como a principal', async () => {
        await invocar('multiview:open', { initialChannelId: 42 })

        expect(estado.criadas).toHaveLength(1)
        const { prefs, carregou } = ultimaJanela()
        expect(carregou).toEqual([carrega])
        expect(prefs.webSecurity).toBe(true)
        expect(prefs.allowRunningInsecureContent).not.toBe(true)
        expect(prefs.contextIsolation).toBe(true)
        expect(prefs.nodeIntegration).toBe(false)
        expect(String(prefs.preload).endsWith('preload.mjs')).toBe(true)
    })
})
