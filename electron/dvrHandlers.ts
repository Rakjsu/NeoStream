import { app, ipcMain, shell, dialog, BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import log from './logger'
import { recordingFilename, buildRecordingArgs, parseFfmpegTime, buildMp4RemuxArgs, buildThumbnailArgs, mp4PathFor } from './dvrProtocol'

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

/** How many recordings are running right now (drives the tray hold-on-close). */
export function activeRecordingCount(): number {
    return active.size
}
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
    // ✂️ Exporta um clipe A–B de um VOD por cópia de stream (sem re-encode).
    ipcMain.handle('clip:export', async (_e, data: { url: string; start: number; end: number; title?: string }) => {
        try {
            const ffmpeg = resolveFfmpegPath()
            if (!ffmpeg) return { success: false, error: 'ffmpeg indisponível' }
            if (!data?.url || typeof data.start !== 'number' || typeof data.end !== 'number' || data.end <= data.start) {
                return { success: false, error: 'intervalo inválido' }
            }
            const dir = recordingsDir()
            fs.mkdirSync(dir, { recursive: true })
            const base = (data.title || 'clipe').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || 'clipe'
            const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
            const file = path.join(dir, `${base}-clip-${stamp}.mp4`)
            const args = ['-ss', String(data.start), '-to', String(data.end), '-i', data.url, '-c', 'copy', '-movflags', '+faststart', '-y', file]
            await new Promise<void>((resolve, reject) => {
                const proc = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
                let errTail = ''
                proc.stderr.on('data', (chunk: Buffer) => { errTail = (errTail + chunk.toString()).slice(-400) })
                const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout no corte do clipe')) }, 5 * 60_000)
                proc.on('close', code => {
                    clearTimeout(timer)
                    if (code === 0) resolve()
                    else reject(new Error(errTail.slice(-200) || `ffmpeg exit ${code}`))
                })
                proc.on('error', reject)
            })
            log.info(`[DVR] Clip exported: ${file}`)
            return { success: true, file }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

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

    // Renomeia uma gravação pronta (sempre dentro da pasta de gravações).
    ipcMain.handle('dvr:rename-file', async (_e, data: { path?: string; name?: string }) => {
        try {
            const dir = path.resolve(recordingsDir())
            const current = path.resolve(String(data?.path || ''))
            if (!current.startsWith(dir)) return { success: false, error: 'arquivo fora da pasta de gravações' }
            const safe = String(data?.name || '').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
            if (!safe) return { success: false, error: 'nome vazio' }
            const ext = current.toLowerCase().endsWith('.mp4') ? '.mp4' : '.ts'
            const target = path.join(dir, safe.toLowerCase().endsWith(ext) ? safe : `${safe}${ext}`)
            if (fs.existsSync(target)) return { success: false, error: 'já existe uma gravação com esse nome' }
            await fs.promises.rename(current, target)
            return { success: true, path: target }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    // Revela a gravação no Explorer (ficha: caminho está no tooltip do nome).
    ipcMain.handle('dvr:show-in-folder', (_e, data: { path?: string }) => {
        const file = path.resolve(String(data?.path || ''))
        if (!file.startsWith(path.resolve(recordingsDir()))) return { success: false }
        shell.showItemInFolder(file)
        return { success: true }
    })

    // 🎞️ Converte uma gravação .ts pronta em .mp4 (remux com codec copy —
    // rápido e sem perda; o .ts original fica até o usuário apagar).
    ipcMain.handle('dvr:convert-mp4', async (_e, data: { path?: string }) => {
        try {
            const ffmpeg = resolveFfmpegPath()
            if (!ffmpeg) return { success: false, error: 'ffmpeg indisponível' }
            const dir = path.resolve(recordingsDir())
            const source = path.resolve(String(data?.path || ''))
            if (!source.startsWith(dir) || !source.toLowerCase().endsWith('.ts')) {
                return { success: false, error: 'gravação inválida' }
            }
            if (Array.from(active.values()).some(r => r.file === source)) {
                return { success: false, error: 'Gravação em andamento' }
            }
            const target = mp4PathFor(source)
            if (fs.existsSync(target)) return { success: false, error: 'já existe um .mp4 desta gravação' }
            await new Promise<void>((resolve, reject) => {
                const proc = spawn(ffmpeg, buildMp4RemuxArgs(source, target), { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
                let stderr = ''
                proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
                proc.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.slice(0, 300) || `ffmpeg saiu com código ${code}`)))
                proc.on('error', reject)
            })
            log.info(`[DVR] Remux concluído: ${target}`)
            return { success: true, path: target }
        } catch (err) {
            return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
    })

    // 🖼️ Thumbnail da gravação (frame ~30s), cacheada em .thumbs/ ao lado.
    ipcMain.handle('dvr:thumbnail', async (_e, data: { path?: string }) => {
        try {
            const ffmpeg = resolveFfmpegPath()
            if (!ffmpeg) return { success: false }
            const dir = path.resolve(recordingsDir())
            const source = path.resolve(String(data?.path || ''))
            if (!source.startsWith(dir)) return { success: false }
            const thumbsDir = path.join(dir, '.thumbs')
            fs.mkdirSync(thumbsDir, { recursive: true })
            const thumb = path.join(thumbsDir, path.basename(source).replace(/\.(ts|mp4)$/i, '') + '.jpg')
            if (!fs.existsSync(thumb)) {
                await new Promise<void>((resolve) => {
                    const proc = spawn(ffmpeg, buildThumbnailArgs(source, thumb), { windowsHide: true, stdio: 'ignore' })
                    proc.on('close', () => resolve())
                    proc.on('error', () => resolve())
                })
            }
            return fs.existsSync(thumb) ? { success: true, path: thumb } : { success: false }
        } catch {
            return { success: false }
        }
    })

    // 📤 Exporta (copia) a gravação pra um destino escolhido pelo usuário.
    ipcMain.handle('dvr:export-file', async (_e, data: { path?: string }) => {
        try {
            const dir = path.resolve(recordingsDir())
            const source = path.resolve(String(data?.path || ''))
            if (!source.startsWith(dir)) return { success: false, error: 'fora da pasta de gravações' }
            const ext = path.extname(source).replace('.', '') || 'ts'
            const result = await dialog.showSaveDialog({
                title: 'Exportar gravação',
                defaultPath: path.basename(source),
                filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
            })
            if (result.canceled || !result.filePath) return { success: false, canceled: true }
            await fs.promises.copyFile(source, result.filePath)
            return { success: true, path: result.filePath }
        } catch (err) {
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
                .filter(name => /\.(ts|mp4)$/i.test(name))
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
            const thumb = path.join(dir, '.thumbs', path.basename(target).replace(/\.(ts|mp4)$/i, '') + '.jpg')
            try { if (fs.existsSync(thumb)) fs.unlinkSync(thumb) } catch { /* best-effort */ }
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
