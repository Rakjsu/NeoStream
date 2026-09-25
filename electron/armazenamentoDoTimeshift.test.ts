/**
 * ⏪ O buffer do timeshift na tela de Armazenamento.
 *
 * A pasta `userData/timeshift` guarda uma janela de ~30 min de MPEG-TS do
 * canal ao vivo — facilmente alguns GB, a maior coisa que o app escreve em
 * disco depois dos downloads e do DVR. Ela não existia para `storage:usage`:
 * o usuário somava as quatro áreas e o total não batia com o que a pasta do
 * app ocupava de verdade, e não havia botão nenhum pra devolver esse disco
 * (downloads e DVR têm tela própria; o buffer, não).
 *
 * Os testes cobram COMPORTAMENTO: rodam os handlers de verdade sobre um
 * `userData` temporário e olham o disco depois. Os dois últimos são as duas
 * cercas da limpeza — com o ⏪ ligado o ffmpeg ainda está escrevendo no buffer
 * (apagar embaixo dele derrubaria a reprodução, e no Windows nem apagaria), e
 * downloads/DVR seguem intocáveis por este canal, que é o que impede um
 * clique no diagnóstico de virar perda do que o usuário baixou.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const state = vi.hoisted(() => ({
    userData: '',
    handlers: new Map<string, IpcHandler>(),
}))

vi.mock('electron', () => ({
    ipcMain: { handle: (canal: string, fn: IpcHandler) => state.handlers.set(canal, fn) },
    app: { getPath: () => state.userData },
    shell: { openPath: vi.fn(async () => '') },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
// O DVR inteiro não precisa subir só pra dizer onde ficam as gravações.
vi.mock('./dvrHandlers', () => ({ recordingsDir: () => path.join(state.userData, 'gravacoes') }))
vi.mock('./ffmpegPath', () => ({ resolveFfmpegPath: () => 'ffmpeg-de-mentira' }))

const PLAYLIST = '#EXTM3U\n#EXTINF:4,\nseg00000.ts\n#EXTINF:4,\nseg00001.ts\n'

// ffmpeg de mentira: escreve a playlist com 2 segmentos JÁ na chamada, pro
// waitForBuffer voltar na primeira leitura (sem depender de timer nenhum).
// O `default` não é enfeite: sem ele o módulo nem carrega ("No default export
// is defined on the child_process mock").
vi.mock('child_process', () => {
    const spawn = (_bin: string, args: string[]) => {
        const playlist = args[args.length - 1] as string
        const dir = path.dirname(playlist)
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'seg00000.ts'), 'x'.repeat(4096))
        fs.writeFileSync(path.join(dir, 'seg00001.ts'), 'x'.repeat(4096))
        fs.writeFileSync(playlist, PLAYLIST)
        const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void }
        proc.stderr = new EventEmitter()
        proc.kill = () => undefined
        return proc
    }
    return { spawn, default: { spawn } }
})

// Servidor de mentira: nenhum socket de verdade, e o listen responde na hora.
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

import { setupStorageManager } from './storageManager'
import { setupTimeshiftHandlers, teardownTimeshift } from './timeshiftHandlers'

interface RespostaUso { success: boolean; areas?: { area: string; bytes: number }[] }
interface RespostaSimples { success: boolean; error?: string }

const bufferDir = () => path.join(state.userData, 'timeshift')
const invoke = <T>(canal: string, arg?: unknown) =>
    (state.handlers.get(canal) as IpcHandler)(null, arg) as Promise<T>

/** Resíduo de buffer no disco, como o ffmpeg deixaria. */
function semearBuffer(bytes: number): void {
    fs.mkdirSync(bufferDir(), { recursive: true })
    fs.writeFileSync(path.join(bufferDir(), 'buffer.m3u8'), PLAYLIST)
    fs.writeFileSync(path.join(bufferDir(), 'seg00000.ts'), 'x'.repeat(bytes))
}

describe('o buffer do timeshift na tela de Armazenamento', () => {
    beforeEach(() => {
        state.handlers.clear()
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-armz-'))
        setupTimeshiftHandlers()
        setupStorageManager()
    })

    afterEach(() => {
        teardownTimeshift()
        fs.rmSync(state.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('storage:usage conta a pasta do buffer', async () => {
        semearBuffer(8192)

        const resultado = await invoke<RespostaUso>('storage:usage')

        expect(resultado.success).toBe(true)
        const linha = resultado.areas?.find(a => a.area === 'timeshift')
        expect(linha, 'a tela de Armazenamento nao lista o buffer do timeshift').toBeDefined()
        expect(linha?.bytes, 'o buffer aparece com 0 bytes').toBeGreaterThanOrEqual(8192)
    })

    it('storage:clear-cache devolve o disco do buffer parado', async () => {
        semearBuffer(8192)

        const resultado = await invoke<RespostaSimples>('storage:clear-cache', { area: 'timeshift' })

        expect(resultado.success, `limpeza recusada: ${resultado.error}`).toBe(true)
        expect(fs.existsSync(bufferDir()), 'o buffer continuou no disco').toBe(false)
    })

    it('com o timeshift ligado, a limpeza e recusada e o buffer sobrevive', async () => {
        const inicio = await invoke<RespostaSimples>('timeshift:start', { url: 'http://provedor.tv/live/42.ts' })
        expect(inicio.success).toBe(true)

        const resultado = await invoke<RespostaSimples>('storage:clear-cache', { area: 'timeshift' })

        expect(resultado.success, 'apagou o buffer embaixo do ffmpeg que grava nele').toBe(false)
        expect(fs.existsSync(path.join(bufferDir(), 'buffer.m3u8')), 'a sessao viva perdeu a playlist').toBe(true)
    })

    it('a TELA mostra a linha nova e a marca como limpavel', () => {
        // A outra ponta do invariante: o main pode expor a area e medir o
        // tamanho, mas se `DiagnosticsSection` nao conhecer a chave a linha
        // nao aparece, ou aparece sem o botao de limpar -- e o defeito
        // continua inteiro pra quem olha a tela de Armazenamento.
        const fonte = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'pages', 'settings', 'DiagnosticsSection.tsx'), 'utf-8'
        ).split('\r\n').join('\n')

        const linha = fonte.split('\n').find(l => l.trimStart().startsWith('timeshift:'))
        expect(linha, 'DiagnosticsSection nao tem linha para a area timeshift').toBeTruthy()
        expect(String(linha).includes('clearable: true'), String(linha)).toBe(true)
    })

    it('o que o usuario baixou continua fora do alcance deste canal', async () => {
        const downloads = path.join(state.userData, 'downloads')
        fs.mkdirSync(downloads, { recursive: true })
        fs.writeFileSync(path.join(downloads, 'filme.mp4'), 'x'.repeat(4096))

        const resultado = await invoke<RespostaSimples>('storage:clear-cache', { area: 'downloads' })

        expect(resultado.success, 'storage:clear-cache aceitou apagar os downloads').toBe(false)
        expect(fs.existsSync(path.join(downloads, 'filme.mp4')), 'o download do usuario foi apagado').toBe(true)
    })
})
