/**
 * ⏪ A faxina do buffer do timeshift, nos dois momentos em que ninguém está
 * olhando: o fechamento do app e a abertura seguinte.
 *
 * O buffer é uma janela de ~30 min de MPEG-TS do canal ao vivo (450 segmentos
 * de 4 s) em `userData/timeshift`. A limpeza morava inteira dentro de um
 * `setTimeout(…, 1000)` — no quit o processo principal morre MUITO antes de um
 * segundo e leva o timer junto, então a pasta inteira sobrevivia até a próxima
 * vez que o usuário ligasse o ⏪.
 *
 * Os dois testes cobram COMPORTAMENTO, não o fonte: depois que
 * `teardownTimeshift()` RETORNA a pasta não existe mais, e o boot devolve o
 * disco que uma queda anterior deixou para trás. `vi.useFakeTimers()` é o
 * ponto do teste, não um detalhe: nenhum callback agendado roda depois do
 * quit — é exatamente o que acontece quando o processo morre.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const state = vi.hoisted(() => ({
    userData: '',
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    /** ffmpeg de mentira: guarda os processos para o teste inspecionar. */
    processos: [] as { matou: boolean }[],
}))

vi.mock('electron', () => ({
    ipcMain: { handle: (canal: string, fn: IpcHandler) => state.handlers.set(canal, fn) },
    app: { getPath: () => state.userData },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./ffmpegPath', () => ({ resolveFfmpegPath: () => 'ffmpeg-de-mentira' }))

// ffmpeg de mentira: escreve a playlist com 2 segmentos JÁ na chamada, para o
// waitForBuffer voltar na primeira leitura (sem depender de timer nenhum).
// O `default` não é enfeite: sem ele o módulo nem carrega ("No default export
// is defined on the child_process mock").
vi.mock('child_process', () => {
    const spawn = (_bin: string, args: string[]) => {
        const playlist = args[args.length - 1] as string
        const dir = path.dirname(playlist)
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'seg00000.ts'), 'x'.repeat(1024))
        fs.writeFileSync(path.join(dir, 'seg00001.ts'), 'x'.repeat(1024))
        fs.writeFileSync(playlist, '#EXTM3U\n#EXTINF:4,\nseg00000.ts\n#EXTINF:4,\nseg00001.ts\n')
        const proc = new EventEmitter() as EventEmitter & {
            stderr: EventEmitter
            kill: () => void
        }
        proc.stderr = new EventEmitter()
        const registro = { matou: false }
        proc.kill = () => { registro.matou = true }
        state.processos.push(registro)
        return proc
    }
    return { spawn, default: { spawn } }
})

// Servidor de mentira: nenhum socket de verdade, e o listen responde na hora
// (o handler dá await nele).
vi.mock('node:http', () => ({
    default: {
        createServer: () => {
            const server = new EventEmitter() as EventEmitter & {
                listen: (porta: number, host: string, cb: () => void) => void
                address: () => { port: number }
                close: () => void
            }
            server.listen = (_porta, _host, cb) => cb()
            server.address = () => ({ port: 45678 })
            server.close = () => undefined
            return server
        },
    },
}))

import { setupTimeshiftHandlers, teardownTimeshift } from './timeshiftHandlers'

const bufferDir = () => path.join(state.userData, 'timeshift')
const invoke = (canal: string, arg?: unknown) =>
    (state.handlers.get(canal) as IpcHandler)(null, arg) as Promise<{ success: boolean }>

describe('faxina do buffer do timeshift', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        state.handlers.clear()
        state.processos.length = 0
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-ts-'))
    })

    afterEach(() => {
        teardownTimeshift()
        vi.useRealTimers()
        fs.rmSync(state.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('o quit não deixa o buffer no disco', async () => {
        setupTimeshiftHandlers()
        const resultado = await invoke('timeshift:start', { url: 'http://provedor.tv/live/42.ts' })
        expect(resultado.success).toBe(true)
        expect(fs.existsSync(bufferDir())).toBe(true)

        // O quit: depois que o teardown RETORNA o processo morre, e nada mais
        // agendado chega a rodar (por isso os timers são falsos aqui).
        teardownTimeshift()

        expect(state.processos[0]?.matou, 'o ffmpeg do buffer não foi morto').toBe(true)
        expect(fs.existsSync(bufferDir()), 'userData/timeshift sobreviveu ao quit').toBe(false)
    })

    it('o boot apaga o que uma queda anterior deixou para trás', () => {
        // Resíduo de um fechamento que não deu tempo de limpar (queda, kill).
        fs.mkdirSync(bufferDir(), { recursive: true })
        fs.writeFileSync(path.join(bufferDir(), 'seg00000.ts'), 'x'.repeat(2048))

        setupTimeshiftHandlers() // boot: não existe sessão viva neste momento

        expect(
            fs.existsSync(bufferDir()),
            'resíduo da sessão anterior continuou no disco',
        ).toBe(false)
    })
})
