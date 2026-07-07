import { app, ipcMain, shell, BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import log from './logger'
import { recordingFilename, buildRecordingArgs, parseFfmpegTime } from './dvrProtocol'

// Runtime require: resolves the REAL ffmpeg-static from node_modules. A bare
// top-level require would get inlined by the bundler, whose __dirname shim
// points at dist-electron and yields a path that doesn't exist (dead DVR).
const requireRuntime = createRequire(import.meta.url)

interface ActiveRecording {
    id: string
    channelName: string
    file: string
    startedAt: number
    seconds: number
    proc: ChildProcessWithoutNullStreams
}

const active = new Map<string, ActiveRecording>()
let nextId = 1

function resolveFfmpegPath(): string | null {
    try {
        const ffmpegPath = requireRuntime('ffmpeg-static') as string | null
        if (!ffmpegPath) return null
        // Packaged builds keep ffmpeg outside the asar (asarUnpack).
        return ffmpegPath.replace('app.asar', 'app.asar.unpacked')
    } catch {
        return null
    }
}

export function recordingsDir(): string {
    return path.join(app.getPath('videos'), 'NeoStream', 'Gravacoes')
}

function broadcast(channel: string, payload: unknown) {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload)
    }
}

export function setupDvrHandlers() {
    ipcMain.handle('dvr:start', async (_e, data: { url: string; channelName: string }) => {
        try {
            const ffmpeg = resolveFfmpegPath()
            if (!ffmpeg) return { success: false, error: 'ffmpeg indisponível' }
            if (!data?.url) return { success: false, error: 'URL do stream ausente' }

            const dir = recordingsDir()
            fs.mkdirSync(dir, { recursive: true })
            const file = path.join(dir, recordingFilename(data.channelName, new Date()))

            const proc = spawn(ffmpeg, buildRecordingArgs(data.url, file), {
                windowsHide: true,
                stdio: ['pipe', 'ignore', 'pipe'],
            }) as ChildProcessWithoutNullStreams

            const id = `rec_${nextId++}`
            const rec: ActiveRecording = { id, channelName: data.channelName, file, startedAt: Date.now(), seconds: 0, proc }
            active.set(id, rec)
            log.info(`[DVR] Recording started (${id}): ${data.channelName} -> ${file}`)

            proc.stderr.on('data', (chunk: Buffer) => {
                const secs = parseFfmpegTime(chunk.toString())
                if (secs !== null && active.has(id)) {
                    rec.seconds = secs
                    broadcast('dvr:progress', { id, seconds: secs })
                }
            })

            proc.on('close', (code) => {
                const wasActive = active.delete(id)
                log.info(`[DVR] Recording ${id} closed (code ${code})`)
                if (wasActive) {
                    broadcast('dvr:stopped', { id, file: rec.file, seconds: rec.seconds, code })
                }
            })

            proc.on('error', (err) => {
                log.error(`[DVR] ffmpeg error for ${id}:`, err)
                active.delete(id)
                broadcast('dvr:stopped', { id, file: rec.file, seconds: rec.seconds, error: String(err) })
            })

            return { success: true, id, file }
        } catch (err) {
            log.error('[DVR] start failed:', err)
            return { success: false, error: String(err) }
        }
    })

    ipcMain.handle('dvr:stop', async (_e, data: { id: string }) => {
        const rec = active.get(data?.id)
        if (!rec) return { success: false, error: 'Gravação não encontrada' }
        try {
            // Ask ffmpeg to finalize cleanly; force-kill if it lingers.
            rec.proc.stdin.write('q')
        } catch { /* stdin may already be closed */ }
        setTimeout(() => {
            if (active.has(rec.id)) {
                try { rec.proc.kill('SIGKILL') } catch { /* already gone */ }
            }
        }, 4000)
        return { success: true, file: rec.file }
    })

    ipcMain.handle('dvr:active', async () => ({
        success: true,
        recordings: Array.from(active.values()).map(r => ({
            id: r.id,
            channelName: r.channelName,
            file: r.file,
            seconds: r.seconds,
            startedAt: r.startedAt,
        })),
    }))

    ipcMain.handle('dvr:open-folder', async () => {
        const dir = recordingsDir()
        fs.mkdirSync(dir, { recursive: true })
        await shell.openPath(dir)
        return { success: true }
    })

    // Recordings on disk (the in-app "Gravações" list).
    ipcMain.handle('dvr:list-files', async () => {
        try {
            const dir = recordingsDir()
            fs.mkdirSync(dir, { recursive: true })
            const activeFiles = new Set(Array.from(active.values()).map(r => r.file))
            const files = fs.readdirSync(dir)
                .filter(name => name.toLowerCase().endsWith('.ts'))
                .map(name => {
                    const full = path.join(dir, name)
                    const stat = fs.statSync(full)
                    return {
                        name,
                        path: full,
                        sizeBytes: stat.size,
                        mtimeMs: stat.mtimeMs,
                        recording: activeFiles.has(full),
                    }
                })
                .sort((a, b) => b.mtimeMs - a.mtimeMs)
            return { success: true, files }
        } catch (err) {
            return { success: false, error: String(err) }
        }
    })

    ipcMain.handle('dvr:delete-file', async (_e, data: { path?: string }) => {
        try {
            const dir = recordingsDir()
            const target = path.resolve(String(data?.path || ''))
            // Only files inside the recordings folder can be deleted.
            if (!target.startsWith(path.resolve(dir) + path.sep)) {
                return { success: false, error: 'Caminho fora da pasta de gravações' }
            }
            // Never delete a file that is still being written.
            if (Array.from(active.values()).some(r => r.file === target)) {
                return { success: false, error: 'Gravação em andamento' }
            }
            fs.unlinkSync(target)
            return { success: true }
        } catch (err) {
            return { success: false, error: String(err) }
        }
    })

    // Stop everything on quit so files finalize.
    app.on('before-quit', () => {
        for (const rec of active.values()) {
            try { rec.proc.stdin.write('q') } catch { /* ignore */ }
        }
    })

    log.info('[DVR] Handlers initialized')
}
