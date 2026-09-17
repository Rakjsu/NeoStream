/**
 * A janela PiP fantasma.
 *
 * `pip:open` fecha a janela anterior e cria a nova na sequência. O 'closed' da
 * antiga só chega DEPOIS — e zerava a referência do módulo, que a essa altura
 * já apontava pra janela nova. Resultado: uma janela sem moldura, sempre no
 * topo, tocando, que o app não conseguia mais fechar nem trazer de volta.
 *
 * O `close()` da janela falsa imita essa folga: enfileira o 'closed' em vez de
 * emitir na hora. Sem isso o teste não consegue ver o bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

type Manipulador = (event: unknown, ...args: unknown[]) => unknown

const estado = vi.hoisted(() => {
    const pendentes: (() => void)[] = []
    const criadas: JanelaFalsa[] = []

    class JanelaFalsa {
        fechou = false
        readonly enviados: string[] = []
        readonly webContents = {
            on: () => undefined,
            send: (canal: string) => { this.enviados.push(canal) },
        }
        private destruida = false
        private readonly ouvintes = new Map<string, (() => void)[]>()

        constructor() { criadas.push(this) }

        on(evento: string, fn: () => void) {
            const lista = this.ouvintes.get(evento) ?? []
            lista.push(fn)
            this.ouvintes.set(evento, lista)
            return this
        }

        /** O Electron entrega 'closed' num tick posterior ao close(). */
        close() {
            this.fechou = true
            pendentes.push(() => {
                this.destruida = true
                for (const fn of this.ouvintes.get('closed') ?? []) fn()
            })
        }

        isDestroyed() { return this.destruida }
        getBounds() { return { x: 0, y: 0, width: 400, height: 250 } }
        isAlwaysOnTop() { return true }
        setPosition() { /* noop */ }
        setBounds() { /* noop */ }
        setAlwaysOnTop() { /* noop */ }
        moveTop() { /* noop */ }
        loadURL() { /* noop */ }
        loadFile() { /* noop */ }
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

    return { pendentes, criadas, TELA, JanelaFalsa, handlers: new Map<string, Manipulador>() }
})

vi.mock('electron', () => ({
    BrowserWindow: estado.JanelaFalsa,
    ipcMain: {
        handle: (canal: string, fn: Manipulador) => { estado.handlers.set(canal, fn) },
        on: () => undefined,
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

const CANAL_A = { src: 'http://prov.tv/a.ts', title: 'Canal A', contentId: '1', contentType: 'live' as const }
const CANAL_B = { src: 'http://prov.tv/b.ts', title: 'Canal B', contentId: '2', contentType: 'live' as const }

const invocar = (canal: string, carga?: unknown) =>
    (estado.handlers.get(canal) as Manipulador)(null, carga)

/** Entrega os 'closed' que o Electron entregaria no tick seguinte. */
const entregarFechamentos = () => {
    for (const fn of estado.pendentes.splice(0)) fn()
}

describe('janela PiP', () => {
    let principal: InstanceType<typeof estado.JanelaFalsa>

    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.pendentes.length = 0
        estado.criadas.length = 0
        principal = new estado.JanelaFalsa()
        estado.criadas.length = 0 // a janela principal não é uma janela de PiP
        const mod = await import('./pipHandlers')
        mod.setupPipHandlers(principal as unknown as BrowserWindow)
    })

    it('abrir o PiP de novo não deixa uma janela fantasma na tela', async () => {
        // Acontece de verdade: destacar uma segunda célula do multi-view, ou
        // mandar outro conteúdo pro PiP, chama `pip:open` sem nenhum
        // `pip:close` no meio.
        await invocar('pip:open', CANAL_A)
        await invocar('pip:open', CANAL_B)
        entregarFechamentos()

        expect(estado.criadas).toHaveLength(2)
        expect(estado.criadas[0].fechou).toBe(true)

        // A janela nova continua sendo a do app: o ✕ dela, o "voltar pro app"
        // e o F9 falam com ela.
        const situacao = await invocar('pip:getState') as { isOpen: boolean; content: { title: string } | null }
        expect(situacao.isOpen).toBe(true)
        expect(situacao.content?.title).toBe('Canal B')

        await invocar('pip:close')
        expect(estado.criadas[1].fechou).toBe(true)

        // E o app não pode se achar sem PiP com um tocando na tela.
        expect(principal.enviados.filter(c => c === 'pip:closed')).toHaveLength(0)
    })

    it('fechar pelo ✕ avisa a janela principal e limpa o estado', async () => {
        await invocar('pip:open', CANAL_A)
        await invocar('pip:close')
        entregarFechamentos()

        expect(estado.criadas[0].fechou).toBe(true)
        expect(principal.enviados).toContain('pip:closed')
        expect(await invocar('pip:getState')).toEqual({ isOpen: false, content: null })
    })

    it('janela fechada por fora também avisa e some do estado', async () => {
        await invocar('pip:open', CANAL_A)
        estado.criadas[0].close()
        entregarFechamentos()

        expect(principal.enviados).toContain('pip:closed')
        expect(await invocar('pip:getState')).toEqual({ isOpen: false, content: null })
    })
})
