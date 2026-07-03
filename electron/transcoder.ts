/**
 * Rescue transcoder (main process): ffmpeg re-encodes an incompatible stream
 * into live HLS served over a loopback HTTP server (hls.js can't fetch
 * file:// URLs). See transcodeProtocol.ts for the pure pieces.
 *
 * Lifecycle: renderer asks 'transcode:start' with the failing URL → ffmpeg
 * writes segments into userData/transcode/<id>/ → we wait for a playable
 * manifest (≥2 segments, 25s budget) → renderer swaps its player to the
 * local URL. 'transcode:stop' (or app quit) kills ffmpeg and sweeps the dir.
 */

import { app, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import log from './logger'
import {
    buildTranscodeArgs,
    isPlaylistReady,
    safeJoinTranscodePath,
    contentTypeFor,
    type TranscodeVariant
} from './transcodeProtocol'

interface Session {
    proc: ChildProcess
    dir: string
}

const sessions = new Map<string, Session>()
let server: http.Server | null = null
let serverPort = 0
let sessionCounter = 0

function transcodeRoot(): string {
    return path.join(app.getPath('userData'), 'transcode')
}

function resolveFfmpegPath(): string | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ffmpegPath = require('ffmpeg-static') as string | null
        if (!ffmpegPath) return null
        return ffmpegPath.replace('app.asar', 'app.asar.unpacked')
    } catch {
        return null
    }
}

/** Loopback file server scoped to the transcode root (lazy, one per app). */
function ensureServer(): Promise<number> {
    if (server && serverPort) return Promise.resolve(serverPort)
    return new Promise((resolve, reject) => {
        const root = transcodeRoot()
        server = http.createServer((req, res) => {
            const target = safeJoinTranscodePath(root, (req.url ?? '').split('?')[0])
            if (!target || !fs.existsSync(target)) {
                res.writeHead(404)
                res.end()
                return
            }
            res.writeHead(200, {
                'Content-Type': contentTypeFor(target),
                'Cache-Control': 'no-store',
                'Access-Control-Allow-Origin': '*'
            })
            fs.createReadStream(target).pipe(res)
        })
        server.on('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server?.address()
            serverPort = typeof address === 'object' && address ? address.port : 0
            log.info('[Transcode] loopback server on', serverPort)
            resolve(serverPort)
        })
    })
}

async function waitForPlayable(manifestPath: string, budgetMs: number): Promise<boolean> {
    const deadline = Date.now() + budgetMs
    while (Date.now() < deadline) {
        try {
            const text = await fsp.readFile(manifestPath, 'utf-8')
            if (isPlaylistReady(text)) return true
        } catch { /* not written yet */ }
        await new Promise(r => setTimeout(r, 500))
    }
    return false
}

async function startSession(sourceUrl: string, variant: TranscodeVariant): Promise<{ id: string; playUrl: string } | null> {
    const ffmpeg = resolveFfmpegPath()
    if (!ffmpeg) return null

    const id = `t${Date.now().toString(36)}${(sessionCounter++).toString(36)}`
    const dir = path.join(transcodeRoot(), id)
    await fsp.mkdir(dir, { recursive: true })

    const proc = spawn(ffmpeg, buildTranscodeArgs(sourceUrl, variant), { cwd: dir, windowsHide: true })
    proc.stderr?.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim()
        if (line) log.warn(`[Transcode ${id}]`, line.slice(0, 300))
    })
    proc.on('error', (error) => log.error(`[Transcode ${id}] spawn error:`, error))
    sessions.set(id, { proc, dir })

    const ready = await waitForPlayable(path.join(dir, 'index.m3u8'), 25000)
    if (!ready || proc.exitCode !== null) {
        stopSession(id)
        return null
    }

    const port = await ensureServer()
    return { id, playUrl: `http://127.0.0.1:${port}/${id}/index.m3u8` }
}

function stopSession(id: string): void {
    const session = sessions.get(id)
    if (!session) return
    sessions.delete(id)
    try {
        session.proc.kill('SIGKILL')
    } catch { /* already gone */ }
    // Give the OS a beat to release file handles before sweeping.
    setTimeout(() => {
        void fsp.rm(session.dir, { recursive: true, force: true }).catch(() => undefined)
    }, 2000)
}

export function setupTranscoder() {
    ipcMain.handle('transcode:start', async (_e, payload: { url?: string; variant?: string }) => {
        const url = typeof payload?.url === 'string' ? payload.url : ''
        if (!/^https?:\/\//.test(url)) return { success: false, error: 'invalid url' }
        const variant: TranscodeVariant = payload?.variant === 'audio' ? 'audio' : 'full'
        try {
            const result = await startSession(url, variant)
            if (!result) return { success: false, error: 'transcode failed to start' }
            log.info('[Transcode] rescue ready:', result.id, `(${variant})`)
            return { success: true, ...result }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    ipcMain.handle('transcode:stop', (_e, payload: { id?: string }) => {
        if (typeof payload?.id === 'string') stopSession(payload.id)
        return { success: true }
    })

    app.on('before-quit', () => {
        for (const id of [...sessions.keys()]) stopSession(id)
    })

    // Sweep leftovers from crashed sessions on boot.
    void fsp.rm(transcodeRoot(), { recursive: true, force: true }).catch(() => undefined)

    log.info('[Transcode] rescue transcoder initialized')
}
