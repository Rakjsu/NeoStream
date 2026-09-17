import { app, ipcMain, shell, dialog, BrowserWindow } from 'electron'
import { statSync } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import fs from 'fs'
import log from './logger'
import { recordingFilename, buildRecordingArgs, parseFfmpegTime, buildMp4RemuxArgs, buildThumbnailArgs, mp4PathFor, renameTargetName, isSameRecordingFile } from './dvrProtocol'
import { resolveFfmpegPath } from './ffmpegPath'
import { getErrorMessage } from './errorMessage'

interface ActiveRecording {
    id: string
    channelName: string
    file: string
    startedAt: number
    seconds: number
    proc: ChildProcessWithoutNullStreams
    graceTimer?: ReturnType<typeof setTimeout>
}

const active = new Map<string, ActiveRecording>()

// O 'exit' avisa que o processo morreu; o 'close' só chega quando os pipes dele
// fecham. No Windows um filho do Chromium nascido na mesma janela de tempo pode
// herdar o handle do pipe de stderr do ffmpeg — aí o 'close' NUNCA vem e a
// entrada ficaria "gravando" pra sempre. O grace dá esse tempo pro 'close'
// chegar (o caminho normal) e finaliza de qualquer jeito se ele faltar.
const EXIT_CLOSE_GRACE_MS = 8000

/**
 * Pede pro ffmpeg finalizar ('q' no stdin) sem derrubar o main process.
 * Um pipe já fechado pode lançar na hora OU emitir EPIPE depois — e o EPIPE
 * assíncrono vira "Uncaught Exception" se o stream não tiver ouvinte de
 * 'error' (o try/catch não alcança). Daí o ouvinte mudo no spawn + os guards.
 */
function askFfmpegToFinish(rec: ActiveRecording) {
    const stdin = rec.proc.stdin
    if (!stdin || stdin.destroyed || stdin.writableEnded) return
    try { stdin.write('q') } catch { /* pipe já fechado */ }
}

// Gravações que acabaram sozinhas há pouco (provedor caiu, stream terminou). O
// ⏹ do painel/celular chega com o id da última listagem que ele viu; sem esta
// memória curta a resposta seria "Gravação não encontrada" — um erro na cara
// do usuário para algo que já está exatamente como ele pediu.
const finished = new Map<string, { file: string; seconds: number }>()
const FINISHED_MEMORY = 30

function rememberFinished(rec: ActiveRecording) {
    finished.set(rec.id, { file: rec.file, seconds: rec.seconds })
    while (finished.size > FINISHED_MEMORY) {
        const oldest = finished.keys().next().value
        if (oldest === undefined) break
        finished.delete(oldest)
    }
}

/** Tira a gravação do mapa e avisa o renderer — uma vez só (idempotente). */
function finalizeRecording(rec: ActiveRecording, code: number | null, extra?: { error?: string }) {
    if (rec.graceTimer) {
        clearTimeout(rec.graceTimer)
        rec.graceTimer = undefined
    }
    if (!active.delete(rec.id)) return
    rememberFinished(rec)
    broadcast('dvr:stopped', { id: rec.id, file: rec.file, seconds: rec.seconds, code, ...extra })
}

/** How many recordings are running right now (drives the tray hold-on-close). */
export function activeRecordingCount(): number {
    return active.size
}
let nextId = 1

export function recordingsDir(): string {
    return path.join(app.getPath('videos'), 'NeoStream', 'Gravacoes')
}

function broadcast(channel: string, payload: unknown) {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload)
    }
}

export function setupDvrHandlers() {
    // 💾 Espaço livre no volume das gravações (estimativa pré-REC).
    ipcMain.handle('dvr:disk-free', async () => {
        try {
            const dir = recordingsDir()
            fs.mkdirSync(dir, { recursive: true })
            const stats = await fs.promises.statfs(dir)
            return { success: true, freeBytes: stats.bavail * stats.bsize }
        } catch (error) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

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
            return { success: false, error: getErrorMessage(error) }
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

            // E2E: registra o PID pra suite conseguir matar um ffmpeg perdido
            // se o teardown estourar (e2e/helpers.ts lê dvr-pids.txt no close).
            const e2eDir = process.env.NEOSTREAM_E2E_USER_DATA
            if (e2eDir && proc.pid) {
                try { fs.appendFileSync(path.join(e2eDir, 'dvr-pids.txt'), `${proc.pid}\n`) } catch { /* best-effort */ }
            }

            // Sem este ouvinte, um EPIPE assíncrono no stdin (o ffmpeg morreu
            // entre o guard e o write) sobe como exceção não tratada e o
            // Electron abre o diálogo de erro do main process.
            proc.stdin.on('error', (err) => {
                log.warn(`[DVR] stdin de ${id} indisponível:`, err)
            })

            proc.stderr.on('data', (chunk: Buffer) => {
                const secs = parseFfmpegTime(chunk.toString())
                if (secs !== null && active.has(id)) {
                    rec.seconds = secs
                    broadcast('dvr:progress', { id, seconds: secs })
                }
            })

            proc.on('close', (code) => {
                log.info(`[DVR] Recording ${id} closed (code ${code})`)
                finalizeRecording(rec, code)
            })

            // Rede de segurança do 'close' que pode não vir: o 'exit' sempre
            // dispara quando o processo morre (ver EXIT_CLOSE_GRACE_MS).
            proc.on('exit', (code) => {
                if (!active.has(id) || rec.graceTimer) return
                rec.graceTimer = setTimeout(() => {
                    log.warn(`[DVR] Recording ${id} exited (code ${code}) but 'close' never fired — finalizing after grace`)
                    finalizeRecording(rec, code)
                }, EXIT_CLOSE_GRACE_MS)
            })

            proc.on('error', (err) => {
                log.error(`[DVR] ffmpeg error for ${id}:`, err)
                finalizeRecording(rec, null, { error: String(err) })
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
            const safe = renameTargetName(String(data?.name || ''), current)
            if (!safe) return { success: false, error: 'nome vazio' }
            const target = path.join(dir, safe)
            // Renomear para o MESMO nome não é erro — e é o caminho mais
            // comum: o campo ✏️ confirma no `onBlur`, então abrir e clicar
            // fora já manda o nome de volta igual. Sem isto, o `existsSync`
            // abaixo acha o PRÓPRIO arquivo e recusa com "já existe uma
            // gravação com esse nome" — no desktop e no celular, que chama o
            // mesmo canal.
            if (isSameRecordingFile(target, current)) {
                // Só a caixa mudou (Windows): ainda é um rename de verdade.
                if (target !== current) await fs.promises.rename(current, target)
                return { success: true, path: target }
            }
            if (fs.existsSync(target)) return { success: false, error: 'já existe uma gravação com esse nome' }
            await fs.promises.rename(current, target)
            return { success: true, path: target }
        } catch (error) {
            return { success: false, error: getErrorMessage(error) }
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
            return { success: false, error: getErrorMessage(err) }
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
        if (!rec) {
            // Terminou sozinha entre a listagem e o toque no ⏹: o pedido já
            // está atendido, então é sucesso — não erro na cara do usuário.
            const done = finished.get(data?.id)
            if (done) return { success: true, file: done.file, alreadyStopped: true }
            return { success: false, error: 'Gravação não encontrada' }
        }
        // Processo já morreu (esperando o 'close' ou o grace): parar o que já
        // parou é trivialmente verdade. Finaliza agora, em vez de escrever num
        // stdin morto e deixar o celular ver um erro.
        if (rec.proc.exitCode !== null || rec.proc.signalCode !== null) {
            finalizeRecording(rec, rec.proc.exitCode)
            return { success: true, file: rec.file }
        }
        // Ask ffmpeg to finalize cleanly; force-kill if it lingers.
        askFfmpegToFinish(rec)
        setTimeout(() => {
            if (active.has(rec.id)) {
                try { rec.proc.kill('SIGKILL') } catch { /* already gone */ }
            }
        }, 4000)
        return { success: true, file: rec.file }
    })

    ipcMain.handle('dvr:active', async () => ({
        success: true,
        recordings: Array.from(active.values()).map(r => {
            // ⏺ Item 16: o painel ao vivo mostra o arquivo crescendo.
            let sizeBytes = 0
            try { sizeBytes = statSync(r.file).size } catch { /* ffmpeg ainda não criou o arquivo */ }
            return {
                id: r.id,
                channelName: r.channelName,
                file: r.file,
                seconds: r.seconds,
                startedAt: r.startedAt,
                sizeBytes,
            }
        }),
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

    // Stop everything on quit so files finalize. Só escrever 'q' não basta:
    // ffmpeg preso abrindo o input nunca processa o stdin e vira órfão — e no
    // Windows o órfão herda os pipes do app, segurando o teardown de quem
    // espera o processo morrer (e2e). Segura o quit por um grace curto e
    // força SIGKILL em quem ficar antes de deixar o app sair.
    let quitCleanupStarted = false
    const stillRunning = (rec: ActiveRecording) =>
        rec.proc.exitCode === null && rec.proc.signalCode === null
    app.on('before-quit', (e) => {
        if (quitCleanupStarted) return
        const pending = Array.from(active.values()).filter(stillRunning)
        if (pending.length === 0) return
        quitCleanupStarted = true
        e.preventDefault()
        // Fora do mapa: sem broadcast de dvr:stopped (janelas já fechando) e
        // o segundo before-quit (do app.quit() abaixo) passa direto.
        active.clear()
        for (const rec of pending) {
            askFfmpegToFinish(rec)
        }
        let remaining = pending.length
        let resumed = false
        const resumeQuit = () => {
            if (resumed) return
            resumed = true
            clearTimeout(hardKill)
            app.quit()
        }
        const hardKill = setTimeout(() => {
            for (const rec of pending) {
                if (stillRunning(rec)) {
                    try { rec.proc.kill('SIGKILL') } catch { /* já morreu */ }
                }
            }
            // SIGKILL é imediato; um último fôlego pro 'close' propagar.
            setTimeout(resumeQuit, 1000)
        }, 1500)
        for (const rec of pending) {
            rec.proc.once('close', () => { remaining -= 1; if (remaining === 0) resumeQuit() })
        }
    })

    log.info('[DVR] Handlers initialized')
}
