/**
 * D019 — o pipe do mpv que nunca conecta.
 *
 * O `connectPipe` tenta o --input-ipc-server 30 vezes (300 ms entre elas) e,
 * se nenhuma pega, so escrevia "playback continues without status/control" no
 * log. O `mpv:status` seguia devolvendo `running: true` e mais nada: a tela
 * ficava em "tocando" com o tempo em --:--, e pausa, busca, volume, tela cheia
 * e faixas iam pro vazio (o `sendCommand` devolve false e o mpvService engole).
 *
 * O contrato travado aqui e o do main, pelos canais de verdade (spawn e socket
 * falsos): enquanto ainda ha tentativa, `ipcFailed` e false; esgotadas, o
 * snapshot do `mpv:status` diz `ipcFailed: true` (com o processo ainda vivo) e
 * nenhum timer de nova tentativa sobra armado. Um pipe que conecta nunca vira
 * `ipcFailed`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
type SocketFalso = EventEmitter & { destroy: () => void; write: (linha: string) => boolean; destroyed: boolean }

const estado = vi.hoisted(() => ({
    raiz: '',
    sep: '',
    mpv: '',
    handlers: new Map<string, IpcHandler>(),
    sockets: [] as import('node:events').EventEmitter[],
}))

vi.mock('electron', () => ({
    app: {
        getPath: (nome: string) => `${estado.raiz}${estado.sep}${nome}`,
        on: () => undefined,
        isReady: () => true,
        whenReady: () => Promise.resolve(),
    },
    ipcMain: { handle: (canal: string, fn: IpcHandler) => estado.handlers.set(canal, fn) },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    net: { request: () => new EventEmitter() },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
    shell: { openPath: async () => '', showItemInFolder: () => undefined },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
}))

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./store', () => ({
    default: {
        get: (chave: string) => (chave === 'settings' ? { mpvPath: estado.mpv } : undefined),
        set: () => undefined,
    },
}))

vi.mock('node:child_process', () => {
    const spawn = () => {
        const filho = new EventEmitter() as EventEmitter & { exitCode: number | null; killed: boolean; kill: () => void }
        filho.exitCode = null
        filho.killed = false
        filho.kill = () => { filho.killed = true }
        return filho
    }
    return { default: { spawn }, spawn }
})

vi.mock('node:net', () => {
    const connect = () => {
        const socket = new EventEmitter() as SocketFalso
        socket.destroyed = false
        socket.destroy = () => { socket.destroyed = true }
        socket.write = () => true
        estado.sockets.push(socket)
        return socket
    }
    return { default: { connect }, connect }
})

const chamar = async (canal: string, payload?: unknown) => {
    const handler = estado.handlers.get(canal)
    expect(handler, `o canal ${canal} sumiu`).toBeDefined()
    return await (handler as IpcHandler)({ sender: {} }, payload)
}

interface Snapshot { running: boolean; ipcFailed?: boolean }

/** O mpv nao abriu o pipe: a tentativa atual falha como falharia de verdade. */
const falharTentativaAtual = () => {
    const socket = estado.sockets.at(-1)
    expect(socket, 'o main nao tentou conectar o pipe').toBeDefined()
    socket!.emit('error', Object.assign(new Error('connect ENOENT'), { code: 'ENOENT' }))
}

describe('pipe do mpv que nunca conecta (D019)', () => {
    let mpvPlayer: typeof import('./mpvPlayer') | null = null

    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.sockets.length = 0
        estado.raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-mpvsempipe-'))
        estado.sep = path.sep
        fs.mkdirSync(path.join(estado.raiz, 'temp'), { recursive: true })
        // mpv "instalado": o caminho configurado que existe e o primeiro que o
        // resolveMpvPath aceita, entao nada sonda o PATH da maquina.
        estado.mpv = path.join(estado.raiz, 'mpv.exe')
        fs.writeFileSync(estado.mpv, '')

        mpvPlayer = await import('./mpvPlayer')
        mpvPlayer.setupMpvHandlers()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })

    afterEach(() => {
        mpvPlayer?.stopMpv()
        mpvPlayer = null
        vi.clearAllTimers()
        vi.useRealTimers()
        fs.rmSync(estado.raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('esgotadas as tentativas, o mpv:status avisa que o pipe falhou — com o mpv ainda tocando', async () => {
        const aberto = await chamar('mpv:play', { url: 'https://exemplo.invalid/filme.mkv', title: 'Filme' }) as { success: boolean }
        expect(aberto.success).toBe(true)

        // Enquanto ainda ha tentativa, nao e falha: o mpv pode so estar lento.
        for (let i = 0; i < 5; i++) {
            falharTentativaAtual()
            vi.advanceTimersByTime(300)
        }
        const noMeio = await chamar('mpv:status') as Snapshot
        expect(noMeio.running).toBe(true)
        expect(noMeio.ipcFailed).toBe(false)

        // Falha ate a ultima tentativa; a espera e pela CONDICAO (o main
        // parar de abrir socket), nao por um numero fixo de voltas.
        let ultimoTotal = -1
        while (estado.sockets.length !== ultimoTotal) {
            ultimoTotal = estado.sockets.length
            falharTentativaAtual()
            vi.advanceTimersByTime(300)
            expect(estado.sockets.length, 'o main tenta o pipe para sempre').toBeLessThan(200)
        }

        const depois = await chamar('mpv:status') as Snapshot
        expect(depois.running, 'o processo segue vivo — o video continua').toBe(true)
        expect(depois.ipcFailed, 'a tela nao tem como saber que os controles morreram').toBe(true)
        // Desistiu de verdade: nenhum timer de nova tentativa ficou armado.
        expect(vi.getTimerCount()).toBe(0)
    })

    it('um pipe que conecta (mesmo depois de algumas falhas) nunca vira ipcFailed', async () => {
        await chamar('mpv:play', { url: 'https://exemplo.invalid/filme.mkv', title: 'Filme' })

        falharTentativaAtual()
        vi.advanceTimersByTime(300)
        falharTentativaAtual()
        vi.advanceTimersByTime(300)
        estado.sockets.at(-1)!.emit('connect')

        const status = await chamar('mpv:status') as Snapshot
        expect(status.running).toBe(true)
        expect(status.ipcFailed).toBe(false)
        expect(await chamar('mpv:pause')).toEqual({ success: true })
    })

    it('sem mpv nenhum o snapshot tambem nao acusa falha de pipe', async () => {
        const status = await chamar('mpv:status') as Snapshot
        expect(status.running).toBe(false)
        expect(status.ipcFailed).toBe(false)
    })
})
