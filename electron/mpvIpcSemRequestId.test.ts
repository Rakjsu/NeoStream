/**
 * D018 — o protocolo IPC do mpv tinha `request_id` (parametro do
 * serializeIpcCommand e campo do MpvIpcMessage) e `error` preparados para
 * casar pedido e resposta, mas o app nunca numerou um comando nem leu uma
 * resposta: sendCommand sempre mandava a linha sem id e applyIpcMessage so
 * olha `event`. Era peso morto que dava a impressao de que o retorno do mpv
 * era conferido.
 *
 * O teste trava o contrato real, das pontas para dentro:
 *  - PIPE (comportamental): sobe o mpv pelo handler `mpv:play` de verdade,
 *    com spawn e socket falsos, e grava TUDO o que o main escreve no pipe —
 *    os observe_property da conexao, cada botao do player e o `quit` do
 *    mpv:stop. Nenhuma linha leva request_id;
 *  - PIPE (comportamental): a resposta que o mpv manda a cada comando
 *    ({"request_id":0,"error":"..."}), inclusive a de erro, entra pelo laco
 *    do socket e nao mexe no status que o `mpv:status` devolve;
 *  - UNIDADE: serializeIpcCommand ignora um segundo argumento (o parametro
 *    requestId nao volta escondido) e MpvIpcMessage nao declara request_id
 *    nem error (checado pelo `tsc -b`).
 *
 * Se um dia o app quiser mesmo casar pedido e resposta (fazer o `{ success }`
 * dos handlers refletir o erro real do mpv), este teste e o primeiro a mudar:
 * aí o id tem de ser usado de verdade, com mapa de pendentes e prazo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { serializeIpcCommand, type MpvIpcMessage } from './mpvProtocol'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const estado = vi.hoisted(() => ({
    raiz: '',
    sep: '',
    mpv: '',
    handlers: new Map<string, IpcHandler>(),
    sockets: [] as import('node:events').EventEmitter[],
    escritas: [] as string[],
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
        const socket = new EventEmitter() as EventEmitter & { destroy: () => void; write: (linha: string) => boolean; destroyed: boolean }
        socket.destroyed = false
        socket.destroy = () => { socket.destroyed = true }
        socket.write = (linha: string) => {
            estado.escritas.push(linha)
            return true
        }
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

/** Abre o mpv pelo canal de verdade e conecta o pipe falso. */
const abrirMpvConectado = async () => {
    const resultado = await chamar('mpv:play', { url: 'https://exemplo.invalid/canal.m3u8', title: 'Canal' }) as { success: boolean; reason?: string }
    expect(resultado.success, `o mpv nao abriu (${resultado.reason})`).toBe(true)
    const socket = estado.sockets.at(-1)
    expect(socket, 'o main nao tentou conectar o pipe').toBeDefined()
    socket!.emit('connect')
    return socket!
}

describe('pipe do mpv sem request_id (D018)', () => {
    let mpvPlayer: typeof import('./mpvPlayer') | null = null

    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.sockets.length = 0
        estado.escritas.length = 0
        estado.raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-mpvreqid-'))
        estado.sep = path.sep
        fs.mkdirSync(path.join(estado.raiz, 'temp'), { recursive: true })
        // mpv "instalado": o caminho configurado que existe e o primeiro que
        // o resolveMpvPath aceita, entao nada sonda o PATH da maquina.
        estado.mpv = path.join(estado.raiz, 'mpv.exe')
        fs.writeFileSync(estado.mpv, '')

        mpvPlayer = await import('./mpvPlayer')
        mpvPlayer.setupMpvHandlers()
        // O mpv:stop arma o "mata se nao sair em 1,5 s"; relogio falso pra ele
        // nao sobreviver ao teste.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })

    afterEach(() => {
        mpvPlayer?.stopMpv()
        mpvPlayer = null
        vi.clearAllTimers()
        vi.useRealTimers()
        fs.rmSync(estado.raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('nada do que o main escreve no pipe leva request_id: observe_property, cada botao e o quit', async () => {
        await abrirMpvConectado()
        const observes = estado.escritas.length
        expect(observes, 'a conexao nao mandou os observe_property').toBeGreaterThan(0)

        const botoes: [string, unknown][] = [
            ['mpv:pause', undefined],
            ['mpv:resume', undefined],
            ['mpv:set-volume', { volume: 50 }],
            ['mpv:set-fullscreen', { fullscreen: true }],
            ['mpv:seek', { seconds: 42 }],
            ['mpv:set-audio-track', { id: 2 }],
            ['mpv:set-subtitle-track', { id: null }],
            ['mpv:set-aspect', { aspect: '16:9' }],
            ['mpv:sub-delay', { delta: 0.1 }],
        ]
        for (const [canal, payload] of botoes) {
            expect(await chamar(canal, payload), canal).toEqual({ success: true })
        }
        expect(await chamar('mpv:stop')).toEqual({ success: true })

        // Um observe por conexao + uma linha por botao + o quit do stop.
        expect(estado.escritas.length).toBe(observes + botoes.length + 1)
        expect(estado.escritas).toContain('{"command":["set_property","pause",true]}\n')
        expect(estado.escritas.at(-1)).toBe('{"command":["quit"]}\n')
        for (const linha of estado.escritas) {
            expect(linha.endsWith('\n'), linha).toBe(true)
            expect(Object.keys(JSON.parse(linha)), linha).toEqual(['command'])
        }
    })

    it('a resposta do mpv a cada comando passa pelo laco do socket e nao mexe no status', async () => {
        const socket = await abrirMpvConectado()

        // Prova de que o laco esta lendo: um evento de verdade muda o status.
        socket.emit('data', Buffer.from('{"event":"property-change","id":3,"name":"pause","data":true}\n'))
        const antes = await chamar('mpv:status') as { paused: boolean; running: boolean }
        expect(antes.paused).toBe(true)
        expect(antes.running).toBe(true)

        // As respostas que o mpv manda de qualquer jeito — sucesso e erro.
        socket.emit('data', Buffer.from(
            '{"request_id":0,"error":"success"}\n'
            + '{"request_id":0,"error":"property unavailable"}\n'
            + '{"request_id":0,"error":"invalid parameter","data":null}\n',
        ))
        expect(await chamar('mpv:status')).toEqual(antes)
    })
})

// Se alguem reintroduzir os campos sem uso, o `tsc -b` reprova aqui.
type SemCampoDeResposta = 'request_id' extends keyof MpvIpcMessage
    ? false
    : 'error' extends keyof MpvIpcMessage
        ? false
        : true
const semCampoDeResposta: SemCampoDeResposta = true

describe('protocolo IPC do mpv sem request_id (D018)', () => {
    it('MpvIpcMessage nao declara request_id nem error', () => {
        expect(semCampoDeResposta).toBe(true)
    })

    it('serializeIpcCommand nunca escreve request_id, mesmo recebendo um segundo argumento', () => {
        const serializar = serializeIpcCommand as (...args: unknown[]) => string
        const linha = serializar(['get_property', 'duration'], 7)
        expect(linha).toBe('{"command":["get_property","duration"]}\n')
    })
})
