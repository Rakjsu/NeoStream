/**
 * Testes do `download:start` com `electron` e o módulo http mockados.
 *
 * O que se prova aqui é o vazamento: o `clearInterval` do timer de progresso
 * ficava DEPOIS do `await Promise.all(...)`, então todo caminho que não era o
 * feliz (provedor cortando a conexão, pause, cancelamento) deixava um
 * `setInterval` de 500 ms batendo IPC e na barra de tarefas até o app fechar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type StartResult = { success: boolean; filePath?: string; size?: number; error?: string }

interface FakeOptions {
    method?: string
    headers?: Record<string, string>
}

const h = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')
    const { Readable } = await import('node:stream')

    const state = {
        /**
         * ok = 206 com os bytes; chunk-error = provedor devolve 500;
         * hang = nunca responde; parcial = manda metade e fica aberto (é o
         * estado em que um download real passa a maior parte do tempo).
         */
        mode: 'ok' as 'ok' | 'chunk-error' | 'hang' | 'parcial',
        totalBytes: 400,
        requests: [] as { options: FakeOptions; destroyed: boolean }[],
        handlers: new Map<string, IpcHandler>(),
        sends: [] as { channel: string; payload: unknown }[],
        taskbar: [] as (number | null)[],
        userData: '',
    }

    class FakeRequest extends EventEmitter {
        destroyed = false
        constructor(readonly options: FakeOptions, readonly cb: (res: unknown) => void) { super() }
        setTimeout() { return this }
        end() { respond(this) }
        destroy() {
            if (this.destroyed) return
            this.destroyed = true
            this.emit('error', new Error('conexão destruída'))
        }
    }

    function respond(req: FakeRequest) {
        if (req.options.method === 'HEAD') {
            req.cb({
                statusCode: 200,
                headers: { 'content-length': String(state.totalBytes), 'accept-ranges': 'bytes' },
            })
            return
        }
        if (state.mode === 'chunk-error') {
            req.cb({ statusCode: 500, headers: {} })
            return
        }
        // 'hang': fica pendurado até alguém chamar destroy() (pause/cancel).
        if (state.mode === 'hang') return

        const range = /bytes=(\d+)-(\d+)/.exec(String(req.options.headers?.Range ?? ''))
        const start = Number(range?.[1] ?? 0)
        const end = Number(range?.[2] ?? 0)

        // 'parcial': entrega metade do pedaço e NÃO fecha o stream — é assim
        // que um download de verdade passa quase todo o tempo, e é o estado em
        // que a barra ficava parada em 0%.
        if (state.mode === 'parcial') {
            const aberto = new Readable({ read() { /* empurrado abaixo */ } }) as unknown as {
                statusCode: number
                headers: Record<string, string>
                push: (chunk: Buffer | null) => void
            }
            aberto.statusCode = 206
            aberto.headers = {}
            req.cb(aberto)
            aberto.push(Buffer.alloc(Math.floor((end - start + 1) / 2), 0x41))
            return
        }
        const response = Readable.from([Buffer.alloc(end - start + 1, 0x41)]) as unknown as {
            statusCode: number
            headers: Record<string, string>
        }
        response.statusCode = 206
        response.headers = {}
        req.cb(response)
    }

    const request = (options: FakeOptions, cb: (res: unknown) => void) => {
        const req = new FakeRequest(options, cb)
        state.requests.push(req)
        return req
    }

    return { state, request }
})

vi.mock('http', () => ({ default: { request: h.request } }))
vi.mock('https', () => ({ default: { request: h.request } }))
vi.mock('electron', () => ({
    ipcMain: { handle: (channel: string, fn: IpcHandler) => h.state.handlers.set(channel, fn) },
    app: { getPath: () => h.state.userData },
    BrowserWindow: {
        getAllWindows: () => [{
            webContents: {
                send: (channel: string, payload: unknown) => h.state.sends.push({ channel, payload }),
            },
        }],
    },
    shell: { openPath: () => undefined },
    Notification: Object.assign(function FakeNotification() { /* nunca instanciado */ },
        { isSupported: () => false }),
}))
vi.mock('./winIntegration', () => ({
    setTaskbarProgress: (value: number | null) => h.state.taskbar.push(value),
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { setupDownloadHandlers } from './downloadHandlers'

const state = h.state
const invoke = (channel: string, args: unknown) =>
    (state.handlers.get(channel) as IpcHandler)(null, args)

const start = (id = 'dl-1') => invoke('download:start', {
    id, url: 'http://provedor.tv/filme.mp4', name: 'Filme', type: 'movie',
}) as Promise<StartResult>

/** Drena microtasks até as 4 conexões dos chunks existirem (sem timers). */
async function waitForChunkRequests(count = 4) {
    for (let i = 0; i < 50; i++) {
        if (state.requests.filter(r => r.options.method === 'GET').length >= count) return
        await Promise.resolve()
    }
    throw new Error('as conexões dos chunks nunca foram criadas')
}

/**
 * Prova de que nada ficou vivo: nenhum timer pendente e, mesmo avançando 5 s
 * (10 disparos do intervalo de 500 ms), zero IPC e zero toque na taskbar.
 */
function expectNoZombieTimer() {
    expect(vi.getTimerCount()).toBe(0)
    const sends = state.sends.length
    const taskbar = state.taskbar.length
    vi.advanceTimersByTime(5000)
    expect(state.sends.length).toBe(sends)
    expect(state.taskbar.length).toBe(taskbar)
}

describe('download:start — limpeza do intervalo de progresso', () => {
    beforeEach(() => {
        // setImmediate/process.nextTick precisam continuar REAIS: o merge dos
        // chunks usa streams de arquivo de verdade.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        state.mode = 'ok'
        state.totalBytes = 400
        state.requests = []
        state.sends = []
        state.taskbar = []
        state.handlers.clear()
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-dl-'))
        setupDownloadHandlers()
    })

    afterEach(() => {
        vi.useRealTimers()
        fs.rmSync(state.userData, { recursive: true, force: true })
    })

    it('caminho feliz continua baixando, mesclando e sem deixar timer', async () => {
        const result = await start()

        expect(result.success).toBe(true)
        expect(result.size).toBe(400)
        expect(fs.statSync(result.filePath!).size).toBe(400)
        expect(state.sends.some(s => (s.payload as { progress: number }).progress === 100)).toBe(true)
        expectNoZombieTimer()
    })

    it('a barra anda com os bytes que CHEGAM, não só quando um pedaço termina', async () => {
        // O contador só somava no `.then` de um chunk concluído. Como as quatro
        // conexões dividem a mesma banda e terminam quase juntas, a tela ficava
        // sem barra (ela só aparece com progress > 0) e sem MB/s durante quase
        // todo o download, e depois saltava em degraus de ~25%.
        state.mode = 'parcial'

        const running = start('dl-progresso')
        await waitForChunkRequests()
        // setImmediate é REAL aqui (não está na lista do useFakeTimers): é o
        // que deixa o stream entregar o 'data' antes de o intervalo disparar.
        for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r))
        vi.advanceTimersByTime(500)

        const andando = state.sends.filter(s => {
            const p = s.payload as { progress: number; downloadedBytes: number }
            return s.channel === 'download:progress' && p.downloadedBytes > 0 && p.progress < 100
        })
        expect(andando.length).toBeGreaterThan(0)

        await invoke('download:cancel', { id: 'dl-progresso' })
        await running
        expectNoZombieTimer()
    })

    it('chunk falha (provedor corta) → o intervalo de 500 ms morre junto', async () => {
        state.mode = 'chunk-error'

        const result = await start()

        expect(result.success).toBe(false)
        expectNoZombieTimer()
    })

    it('cancelamento no meio → o intervalo de 500 ms morre junto', async () => {
        state.mode = 'hang'

        const running = start('dl-cancel')
        await waitForChunkRequests()
        await invoke('download:cancel', { id: 'dl-cancel' })
        const result = await running

        expect(result.success).toBe(false)
        expectNoZombieTimer()
    })

    it('pause no meio → o intervalo de 500 ms morre junto', async () => {
        state.mode = 'hang'

        const running = start('dl-pause')
        await waitForChunkRequests()
        await invoke('download:pause', { id: 'dl-pause' })
        const result = await running

        expect(result.success).toBe(false)
        expectNoZombieTimer()
    })

    it('duas falhas seguidas não acumulam dois timers zumbis', async () => {
        state.mode = 'chunk-error'

        await start('dl-a')
        await start('dl-b')

        expectNoZombieTimer()
    })
})

/**
 * 💽 `download:get-storage-info` varre a pasta inteira de downloads, síncrono,
 * no event loop do main — o mesmo que está lendo os sockets. A página pedia
 * isso a cada evento de progresso (um por chunk de socket no caminho de
 * conexão única). A tela já deixou de pedir; aqui fica a rede de segurança
 * para o próximo chamador que não souber disso.
 */
describe('download:get-storage-info — uma varredura por rajada', () => {
    beforeEach(() => {
        // Date precisa ser falso: o TTL do cache é medido com Date.now().
        vi.useFakeTimers({ toFake: ['Date'] })
        state.handlers.clear()
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-esp-'))
        const raiz = path.join(state.userData, 'downloads')
        fs.mkdirSync(path.join(raiz, 'series', 'S', 'Temporada 1'), { recursive: true })
        fs.mkdirSync(path.join(raiz, 'movies'), { recursive: true })
        fs.writeFileSync(path.join(raiz, 'movies', 'a.mp4'), Buffer.alloc(100))
        fs.writeFileSync(path.join(raiz, 'series', 'S', 'Temporada 1', 'Ep1.mp4'), Buffer.alloc(200))
        setupDownloadHandlers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        fs.rmSync(state.userData, { recursive: true, force: true })
    })

    const espaco = async () => (await invoke('download:get-storage-info', {})) as { used: number }

    it('vinte pedidos na mesma janela custam UMA varredura', async () => {
        const espiao = vi.spyOn(fs, 'readdirSync')
        expect((await espaco()).used).toBe(300)
        const umaVarredura = espiao.mock.calls.length
        expect(umaVarredura).toBeGreaterThan(1) // desceu nas subpastas mesmo

        for (let i = 0; i < 20; i++) await espaco()

        expect(espiao.mock.calls.length).toBe(umaVarredura)
    })

    it('passado o TTL, o número anda — o cache não mente pra sempre', async () => {
        expect((await espaco()).used).toBe(300)

        fs.rmSync(path.join(state.userData, 'downloads', 'series', 'S', 'Temporada 1', 'Ep1.mp4'))
        expect((await espaco()).used).toBe(300) // ainda na janela

        vi.advanceTimersByTime(1500)
        expect((await espaco()).used).toBe(100)
    })
})
