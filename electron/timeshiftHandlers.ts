/**
 * ⏪ Item 15 — timeshift da TV ao vivo (aposta grande).
 *
 * timeshift:start sobe um ffmpeg copiando o canal pra um HLS local com
 * janela deslizante (~30 min) e um servidor HTTP em 127.0.0.1 servindo a
 * pasta do buffer. O player troca a fonte pro buffer local e o pause vira
 * real (o buffer segue crescendo enquanto o usuário está pausado).
 * Sessão única — trocar de canal reinicia; timeshift:stop derruba tudo.
 */

import { ipcMain, app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import log from './logger'
import {
    buildTimeshiftArgs,
    bufferedSecondsFromPlaylist,
    resolveTimeshiftFile,
    timeshiftContentType,
} from './timeshiftBuffer'

const requireRuntime = createRequire(import.meta.url)

// Mesma resolução do DVR: o ffmpeg-static de verdade do node_modules,
// fora do asar quando empacotado.
function getFfmpegPath(): string | null {
    try {
        const ffmpegPath = requireRuntime('ffmpeg-static') as string | null
        if (!ffmpegPath) return null
        return ffmpegPath.replace('app.asar', 'app.asar.unpacked')
    } catch {
        return null
    }
}

interface TimeshiftSession {
    proc: ChildProcess
    server: http.Server
    dir: string
    port: number
}

let session: TimeshiftSession | null = null

function bufferDir(): string {
    return path.join(app.getPath('userData'), 'timeshift')
}

function stopSession(): void {
    const current = session
    session = null
    if (!current) return
    try { current.proc.kill() } catch { /* já morreu */ }
    try { current.server.close() } catch { /* já fechado */ }
    // Limpeza atrasada: o ffmpeg solta os handles dos segmentos ao morrer.
    setTimeout(() => {
        try { fs.rmSync(current.dir, { recursive: true, force: true }) } catch { /* fica pro próximo start */ }
    }, 1000)
}

/** Espera a playlist ganhar >= 2 segmentos (buffer tocável), com teto. */
async function waitForBuffer(playlistPath: string, timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const text = fs.readFileSync(playlistPath, 'utf-8')
            if ((text.match(/#EXTINF/g) ?? []).length >= 2) return true
        } catch { /* ffmpeg ainda não criou */ }
        if (!session) return false // stop/erro no meio da espera
        await new Promise(resolve => setTimeout(resolve, 500))
    }
    return false
}

export function setupTimeshiftHandlers(): void {
    ipcMain.handle('timeshift:start', async (_, { url }: { url: string }) => {
        try {
            if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
                return { success: false, error: 'URL inválida' }
            }
            const ffmpeg = getFfmpegPath()
            if (!ffmpeg) return { success: false, error: 'ffmpeg indisponível' }

            stopSession()
            const dir = bufferDir()
            try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* primeira vez */ }
            fs.mkdirSync(dir, { recursive: true })

            const proc = spawn(ffmpeg, buildTimeshiftArgs(url, dir), {
                windowsHide: true,
                stdio: ['ignore', 'ignore', 'pipe'],
            })
            let stderrTail = ''
            proc.stderr?.on('data', (chunk: Buffer) => {
                stderrTail = (stderrTail + chunk.toString()).slice(-500)
            })
            proc.on('exit', (code) => {
                if (session?.proc === proc) {
                    log.warn(`[Timeshift] ffmpeg saiu (code ${code}): ${stderrTail}`)
                    stopSession()
                }
            })

            // Servidor do buffer: só loopback, só nomes simples .m3u8/.ts.
            const server = http.createServer((request, response) => {
                const file = resolveTimeshiftFile(dir, request.url ?? '')
                if (!file || !fs.existsSync(file)) {
                    response.writeHead(404)
                    response.end()
                    return
                }
                response.writeHead(200, {
                    'Content-Type': timeshiftContentType(file),
                    'Cache-Control': 'no-store',
                    'Access-Control-Allow-Origin': '*',
                })
                fs.createReadStream(file).pipe(response)
            })
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject)
                server.listen(0, '127.0.0.1', () => resolve())
            })
            const address = server.address()
            const port = typeof address === 'object' && address ? address.port : 0

            session = { proc, server, dir, port }

            const ready = await waitForBuffer(path.join(dir, 'buffer.m3u8'), 15_000)
            if (!ready || session?.proc !== proc) {
                log.warn(`[Timeshift] buffer não encheu a tempo: ${stderrTail}`)
                stopSession()
                return { success: false, error: stderrTail || 'buffer não encheu a tempo' }
            }

            log.info(`[Timeshift] ativo na porta ${port} (janela ~30 min)`)
            return { success: true, url: `http://127.0.0.1:${port}/buffer.m3u8` }
        } catch (error: unknown) {
            stopSession()
            const message = error instanceof Error ? error.message : String(error)
            log.error('[Timeshift] start falhou:', message)
            return { success: false, error: message }
        }
    })

    ipcMain.handle('timeshift:stop', async () => {
        stopSession()
        return { success: true }
    })

    ipcMain.handle('timeshift:status', async () => {
        if (!session) return { success: true, running: false, bufferedSeconds: 0 }
        let bufferedSeconds = 0
        try {
            bufferedSeconds = bufferedSecondsFromPlaylist(
                fs.readFileSync(path.join(session.dir, 'buffer.m3u8'), 'utf-8'),
            )
        } catch { /* playlist ainda nascendo */ }
        return { success: true, running: true, bufferedSeconds }
    })

    log.info('[Timeshift] IPC handlers initialized')
}

/** Derruba a sessão no quit (ffmpeg não pode sobreviver ao app). */
export function teardownTimeshift(): void {
    stopSession()
}
