/**
 * ⏺ Ciclo de vida da gravação: quando o ffmpeg MORRE, a entrada sai do mapa.
 *
 * A entrada de `active` só saía no evento 'close'. No Windows um filho do
 * Chromium nascido na mesma janela de tempo pode herdar o handle do pipe de
 * stderr do ffmpeg: o processo morre, o 'exit' dispara e o 'close' NUNCA vem —
 * e a gravação fica "em andamento" pra sempre. As consequências visíveis são o
 * que este teste amarra (não o mecanismo): o painel "🔴 Gravando agora" mostra
 * uma gravação que não existe, o arquivo fica travado em "Gravação em
 * andamento", o ⏹ responde erro e `activeRecordingCount()` nunca zera, então
 * fechar a janela segura o app na bandeja.
 *
 * O handler roda de verdade: só `electron`, o `spawn` e o caminho do ffmpeg
 * estão mockados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type StartResult = { success: boolean; id?: string; file?: string; error?: string }
type StopResult = { success: boolean; file?: string; error?: string }
type ActiveResult = { success: boolean; recordings: { id: string }[] }
type SimpleResult = { success: boolean; error?: string }

const h = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')

    /** stdin de mentira: registra as escritas e sabe simular um pipe quebrado. */
    class FakeStdin extends EventEmitter {
        destroyed = false
        writableEnded = false
        writes: string[] = []
        /** Quando true, o write emite EPIPE assíncrono (pipe morto). */
        brokenPipe = false
        write(chunk: string) {
            this.writes.push(chunk)
            if (this.brokenPipe) {
                queueMicrotask(() => this.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })))
            }
            return true
        }
    }

    class FakeProc extends EventEmitter {
        pid = 4242
        exitCode: number | null = null
        signalCode: string | null = null
        stdin = new FakeStdin()
        stderr = new EventEmitter()
        killed = false
        kill(signal?: string) {
            this.killed = true
            this.signalCode = signal ?? 'SIGTERM'
            return true
        }
        /** Morre de verdade (exitCode setado) sem que os pipes fechem. */
        exitWithoutClose(code = 1) {
            this.exitCode = code
            this.emit('exit', code, null)
        }
        /** O 'close' atrasado, que chega depois do grace ter finalizado. */
        closeLate(code = 1) {
            this.emit('close', code, null)
        }
        /** Ciclo normal: 'exit' seguido de 'close'. */
        exitAndClose(code = 0) {
            this.exitCode = code
            this.emit('exit', code, null)
            this.emit('close', code, null)
        }
    }

    const state = {
        handlers: new Map<string, IpcHandler>(),
        sends: [] as { channel: string; payload: unknown }[],
        procs: [] as InstanceType<typeof FakeProc>[],
        videosDir: '',
    }

    const spawn = () => {
        const proc = new FakeProc()
        state.procs.push(proc)
        return proc
    }

    return { state, spawn }
})

vi.mock('child_process', () => ({ spawn: h.spawn, default: { spawn: h.spawn } }))
vi.mock('./ffmpegPath', () => ({ resolveFfmpegPath: () => 'C:\\fake\\ffmpeg.exe', foraDoAsar: (p: string) => p }))
vi.mock('electron', () => ({
    ipcMain: { handle: (channel: string, fn: IpcHandler) => h.state.handlers.set(channel, fn) },
    app: {
        getPath: () => h.state.videosDir,
        getVersion: () => '0.0.0-test',
        on: () => undefined,
        quit: () => undefined,
    },
    shell: { openPath: () => undefined, showItemInFolder: () => undefined },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    BrowserWindow: {
        getAllWindows: () => [{
            webContents: {
                send: (channel: string, payload: unknown) => h.state.sends.push({ channel, payload }),
            },
        }],
    },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { setupDvrHandlers, activeRecordingCount } from './dvrHandlers'

/** Folga maior que o grace do dvrHandlers, pra drenar timers pendentes. */
const DEPOIS_DO_GRACE = 15_000

const state = h.state
const invoke = (channel: string, args?: unknown) =>
    (state.handlers.get(channel) as IpcHandler)(null, args)

const gravar = () =>
    invoke('dvr:start', { url: 'http://provedor.tv/live/1.m3u8', channelName: 'Globo HD' }) as Promise<StartResult>

const avisosDeFim = () => state.sends.filter(s => s.channel === 'dvr:stopped')

describe('dvrHandlers — ciclo de vida da gravação', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        state.handlers.clear()
        state.sends = []
        state.procs = []
        state.videosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-dvr-'))
        setupDvrHandlers()
        state.sends = []
    })

    afterEach(async () => {
        // O mapa `active` é estado de módulo e sobrevive entre os casos: uma
        // órfã que ficasse aqui derrubaria o teste SEGUINTE, pelo motivo
        // errado. Fecha tudo que sobrou e cobra o mapa limpo.
        for (const proc of state.procs) {
            if (proc.exitCode === null) proc.exitAndClose(0)
            else proc.closeLate(proc.exitCode)
        }
        await vi.advanceTimersByTimeAsync(DEPOIS_DO_GRACE)
        expect(activeRecordingCount()).toBe(0)
        vi.useRealTimers()
        fs.rmSync(state.videosDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 })
    })

    it('ffmpeg que morre sem fechar os pipes sai do mapa (o "close" não vem)', async () => {
        await gravar()
        expect(activeRecordingCount()).toBe(1)

        // 'exit' sem 'close': o pipe de stderr ficou preso num filho do Chromium.
        state.procs[0].exitWithoutClose(1)
        // Dentro do grace a gravação AINDA conta: o 'close' é o caminho normal
        // e precisa de tempo pra chegar. Finalizar assim que o 'exit' aparece é
        // a solução ingênua que já foi revertida (quebrou o e2e remoteRecord).
        await vi.advanceTimersByTimeAsync(1_000)
        expect(activeRecordingCount()).toBe(1)

        await vi.advanceTimersByTimeAsync(10_000)

        expect(activeRecordingCount()).toBe(0)
        expect((await invoke('dvr:active') as ActiveResult).recordings).toHaveLength(0)
        expect(avisosDeFim()).toHaveLength(1)

        // E se o 'close' atrasado ainda aparecer, o aviso não sai duas vezes.
        state.procs[0].closeLate(1)
        expect(avisosDeFim()).toHaveLength(1)
    })

    it('ciclo normal (exit + close) finaliza na hora, e uma vez só', async () => {
        await gravar()

        state.procs[0].exitAndClose(0)
        expect(activeRecordingCount()).toBe(0)

        await vi.advanceTimersByTimeAsync(30_000)

        expect(avisosDeFim()).toHaveLength(1)
        expect(activeRecordingCount()).toBe(0)
    })

    it('o arquivo da gravação fantasma deixa de ser "Gravação em andamento"', async () => {
        const iniciada = await gravar()
        fs.writeFileSync(iniciada.file as string, 'conteudo gravado')

        state.procs[0].exitWithoutClose(1)
        // Enquanto o grace corre, o arquivo continua protegido de verdade.
        expect((await invoke('dvr:delete-file', { path: iniciada.file }) as SimpleResult).error)
            .toBe('Gravação em andamento')

        await vi.advanceTimersByTimeAsync(10_000)

        const apagada = await invoke('dvr:delete-file', { path: iniciada.file }) as SimpleResult
        expect(apagada.error).toBeUndefined()
        expect(apagada.success).toBe(true)
        expect(fs.existsSync(iniciada.file as string)).toBe(false)
    })

    it('⏹ de um ffmpeg já morto responde sucesso, sem escrever num stdin morto', async () => {
        const iniciada = await gravar()
        const proc = state.procs[0]

        proc.exitWithoutClose(1) // provedor devolveu 404: o ffmpeg desistiu

        const parada = await invoke('dvr:stop', { id: iniciada.id }) as StopResult
        expect(parada.success).toBe(true)
        expect(parada.file).toBe(iniciada.file)
        expect(proc.stdin.writes).toHaveLength(0)
        expect(activeRecordingCount()).toBe(0)
        // E o grace não fica armado para disparar (e logar) sozinho depois.
        expect(vi.getTimerCount()).toBe(0)
    })

    it('⏹ de gravação viva continua pedindo a finalização limpa pelo stdin', async () => {
        const iniciada = await gravar()

        const parada = await invoke('dvr:stop', { id: iniciada.id }) as StopResult

        expect(parada.success).toBe(true)
        expect(state.procs[0].stdin.writes).toEqual(['q'])
        expect(activeRecordingCount()).toBe(1) // só sai quando o ffmpeg morrer
    })

    it('⏹ de gravação que já terminou sozinha responde sucesso (memória curta)', async () => {
        const iniciada = await gravar()

        state.procs[0].exitAndClose(1) // o provedor derrubou o stream
        expect(activeRecordingCount()).toBe(0)

        // O ⏹ do celular chega depois, com o id da última listagem que ele viu.
        const parada = await invoke('dvr:stop', { id: iniciada.id }) as StopResult
        expect(parada.success).toBe(true)
        expect(parada.file).toBe(iniciada.file)
    })

    it('⏹ de id que nunca existiu continua sendo erro', async () => {
        const parada = await invoke('dvr:stop', { id: 'rec_inexistente' }) as StopResult
        expect(parada.success).toBe(false)
        expect(parada.error).toBe('Gravação não encontrada')
    })

    it('EPIPE assíncrono no stdin não vira exceção não tratada no main', async () => {
        const iniciada = await gravar()
        const proc = state.procs[0]
        proc.stdin.brokenPipe = true

        // Sem ouvinte de 'error' o EventEmitter RELANÇA o EPIPE — no app isso é
        // o diálogo "Uncaught Exception" do main process.
        expect(proc.stdin.listenerCount('error')).toBeGreaterThan(0)

        await invoke('dvr:stop', { id: iniciada.id })
        await vi.advanceTimersByTimeAsync(10)

        expect(proc.stdin.writes).toEqual(['q'])
    })
})
