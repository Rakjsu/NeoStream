/**
 * EXPERIMENTAL — MPV playback engine PoC.
 *
 * Spawns mpv.exe as its own window and controls it via mpv's JSON IPC over
 * a Windows named pipe (--input-ipc-server). No libmpv embedding — that is
 * a possible hardening phase later (--wid). The pure/testable parts live in
 * mpvProtocol.ts; this module owns the process, the pipe and the ipcMain
 * surface exposed to the renderer.
 *
 * Channels:
 *   mpv:available      -> { path: string | null, configuredPath: string | null }
 *   mpv:play           -> { success, reason? }   ({ url, title?, start? })
 *   mpv:pause / mpv:resume / mpv:stop -> { success }
 *   mpv:seek           -> { success }            ({ seconds })
 *   mpv:set-volume     -> { success }            ({ volume: 0..100 })
 *   mpv:set-fullscreen -> { success }            ({ fullscreen: boolean })
 *   mpv:status         -> MpvStatus snapshot (polled by the renderer)
 *   mpv:set-path       -> { path: string | null } (persists to electron-store)
 *   mpv:download-start -> MpvInstallResult (one-click install, see mpvDownloader.ts)
 *   mpv:download-cancel-> { success: boolean }
 *   mpv:download-progress (main -> renderer) { percent, transferredMB, totalMB }
 *
 * Phase 2 pseudo-embedding: mpv is spawned borderless/ontop with --geometry
 * matching the caller window's client area minus the bottom controls strip
 * (see buildMpvArgs in mpvProtocol.ts for the design discussion). While a
 * session is active the main process listens to the app window's
 * move/resize/minimize/restore/show/hide events and mirrors them onto mpv
 * via the `geometry` and `window-minimized` properties.
 */

import { app, ipcMain, BrowserWindow, net as electronNet } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import store from './store'
import log from './logger'
import { installMpv } from './mpvDownloader'
import {
    applyIpcMessage,
    buildMpvArgs,
    buildObserveCommandLines,
    buildPathCandidates,
    buildPipeName,
    computeMpvGeometry,
    createInitialStatus,
    extractIpcLines,
    formatMpvGeometry,
    parseIpcLine,
    serializeIpcCommand,
    type MpvStatus,
} from './mpvProtocol'

const PIPE_CONNECT_RETRY_MS = 300
const PIPE_CONNECT_MAX_ATTEMPTS = 30 // ~9s — mpv creates the pipe early in startup
const PATH_PROBE_TIMEOUT_MS = 3000

interface MpvSession {
    child: ChildProcess
    socket: net.Socket | null
    status: MpvStatus
    pipeName: string
    readBuffer: string
    stopRequested: boolean
    /** App window the mpv window follows (pseudo-embedding) — null when standalone. */
    followWindow: BrowserWindow | null
    /** Removes the move/resize/minimize/... listeners from followWindow. */
    detachFollow: (() => void) | null
}

let session: MpvSession | null = null
let instanceCounter = 0
let resolvedPathCache: string | null | undefined // undefined = not probed yet

const getConfiguredPath = (): string | null => {
    const value = store.get('settings')?.mpvPath
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Probe `mpv` on PATH by spawning `mpv --version`. */
function probeMpvOnPath(): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false
        const done = (found: boolean) => {
            if (!settled) {
                settled = true
                resolve(found)
            }
        }
        try {
            const child = spawn('mpv', ['--version'], { windowsHide: true, stdio: 'ignore' })
            const timer = setTimeout(() => {
                try { child.kill() } catch { /* already gone */ }
                done(false)
            }, PATH_PROBE_TIMEOUT_MS)
            child.on('error', () => {
                clearTimeout(timer)
                done(false)
            })
            child.on('exit', (code) => {
                clearTimeout(timer)
                done(code === 0)
            })
        } catch {
            done(false)
        }
    })
}

/**
 * Resolve the mpv executable: configured path > PATH > well-known dirs.
 * Result is cached for the session; mpv:set-path invalidates it.
 */
export async function resolveMpvPath(forceRefresh = false): Promise<string | null> {
    if (!forceRefresh && resolvedPathCache !== undefined) {
        return resolvedPathCache
    }

    const configured = getConfiguredPath()
    if (configured && existsSync(configured)) {
        resolvedPathCache = configured
        return configured
    }

    if (await probeMpvOnPath()) {
        resolvedPathCache = 'mpv'
        return 'mpv'
    }

    for (const candidate of buildPathCandidates(process.env)) {
        if (existsSync(candidate)) {
            resolvedPathCache = candidate
            return candidate
        }
    }

    resolvedPathCache = null
    return null
}

function sendIpcLine(line: string): boolean {
    if (!session?.socket || session.socket.destroyed) return false
    try {
        session.socket.write(line)
        return true
    } catch (error) {
        log.warn(`[MPV] pipe write failed: ${error instanceof Error ? error.message : String(error)}`)
        return false
    }
}

function sendCommand(command: ReadonlyArray<string | number | boolean>): boolean {
    return sendIpcLine(serializeIpcCommand(command))
}

/**
 * Re-position the mpv window over the app window's client area (minus the
 * controls strip). No-op while minimized (geometry would be stale) or while
 * mpv is fullscreen (mpv owns the whole screen; geometry is re-applied when
 * fullscreen is left / the window is restored).
 */
function applyGeometryFromWindow(current: MpvSession) {
    const win = current.followWindow
    if (!win || win.isDestroyed() || win.isMinimized()) return
    if (current.status.fullscreen) return
    const geometry = computeMpvGeometry(win.getContentBounds())
    sendCommand(['set_property', 'geometry', formatMpvGeometry(geometry)])
}

/**
 * Glue the mpv window to the app window for the lifetime of the session:
 * move/resize follow, minimize/hide mirror (window-minimized), close stops
 * playback. Listener removal happens in teardownSession via detachFollow.
 */
function attachWindowFollow(current: MpvSession, win: BrowserWindow) {
    const onMoveResize = () => {
        if (session === current) applyGeometryFromWindow(current)
    }
    const onMinimizeOrHide = () => {
        if (session === current) sendCommand(['set_property', 'window-minimized', true])
    }
    const onRestoreOrShow = () => {
        if (session !== current) return
        sendCommand(['set_property', 'window-minimized', false])
        applyGeometryFromWindow(current)
    }
    const onClosed = () => {
        if (session === current) stopMpv()
    }

    win.on('move', onMoveResize)
    win.on('resize', onMoveResize)
    win.on('minimize', onMinimizeOrHide)
    win.on('hide', onMinimizeOrHide)
    win.on('restore', onRestoreOrShow)
    win.on('show', onRestoreOrShow)
    win.on('closed', onClosed)

    current.followWindow = win
    current.detachFollow = () => {
        current.followWindow = null
        current.detachFollow = null
        if (win.isDestroyed()) return
        win.off('move', onMoveResize)
        win.off('resize', onMoveResize)
        win.off('minimize', onMinimizeOrHide)
        win.off('hide', onMinimizeOrHide)
        win.off('restore', onRestoreOrShow)
        win.off('show', onRestoreOrShow)
        win.off('closed', onClosed)
    }
}

function connectPipe(current: MpvSession) {
    let attempts = 0

    const tryConnect = () => {
        if (session !== current || current.stopRequested) return
        attempts += 1

        const socket = net.connect(current.pipeName)

        socket.on('connect', () => {
            if (session !== current) {
                socket.destroy()
                return
            }
            current.socket = socket
            log.info('[MPV] IPC pipe connected')
            for (const line of buildObserveCommandLines()) {
                sendIpcLine(line)
            }
            // The app window may have moved/resized while mpv was starting.
            applyGeometryFromWindow(current)
        })

        socket.on('data', (data) => {
            if (session !== current) return
            const { lines, rest } = extractIpcLines(current.readBuffer, data.toString('utf8'))
            current.readBuffer = rest
            for (const line of lines) {
                const message = parseIpcLine(line)
                if (message) {
                    current.status = applyIpcMessage(current.status, message)
                }
            }
        })

        socket.on('error', () => {
            socket.destroy()
            if (session !== current || current.stopRequested) return
            if (current.socket === socket) {
                // Established connection dropped — mark not running.
                current.socket = null
                current.status = { ...current.status, running: false }
                return
            }
            if (attempts < PIPE_CONNECT_MAX_ATTEMPTS) {
                setTimeout(tryConnect, PIPE_CONNECT_RETRY_MS)
            } else {
                log.warn('[MPV] could not connect IPC pipe — playback continues without status/control')
            }
        })

        socket.on('close', () => {
            if (session === current && current.socket === socket) {
                current.socket = null
            }
        })
    }

    tryConnect()
}

function teardownSession(killProcess: boolean) {
    const current = session
    if (!current) return
    session = null

    current.stopRequested = true
    current.detachFollow?.()
    if (current.socket) {
        try { current.socket.destroy() } catch { /* noop */ }
        current.socket = null
    }
    if (killProcess && current.child.exitCode === null && !current.child.killed) {
        try { current.child.kill() } catch { /* noop */ }
    }
}

export async function launchMpv(
    options: { url: string; title?: string; start?: number },
    followWindow?: BrowserWindow | null,
): Promise<{ success: boolean; reason?: string }> {
    const mpvPath = await resolveMpvPath()
    if (!mpvPath) {
        return { success: false, reason: 'not-found' }
    }

    // One mpv at a time: politely quit any previous instance.
    stopMpv()

    instanceCounter += 1
    const pipeName = buildPipeName(process.pid, instanceCounter)
    const embedTarget = followWindow && !followWindow.isDestroyed() ? followWindow : null
    const args = buildMpvArgs(pipeName, {
        url: options.url,
        title: options.title,
        startSeconds: options.start,
        geometry: embedTarget ? computeMpvGeometry(embedTarget.getContentBounds()) : undefined,
    })

    try {
        const child = spawn(mpvPath, args, { windowsHide: false, stdio: 'ignore' })

        const current: MpvSession = {
            child,
            socket: null,
            status: createInitialStatus(true),
            pipeName,
            readBuffer: '',
            stopRequested: false,
            followWindow: null,
            detachFollow: null,
        }
        session = current
        if (embedTarget) {
            attachWindowFollow(current, embedTarget)
        }

        child.on('error', (error) => {
            log.error(`[MPV] spawn error: ${error.message}`)
            if (session === current) {
                current.status = { ...current.status, running: false }
                teardownSession(false)
            }
        })

        child.on('exit', (code) => {
            log.info(`[MPV] process exited (code ${code})`)
            if (session === current) {
                current.status = { ...current.status, running: false }
                teardownSession(false)
            }
        })

        connectPipe(current)
        log.info(`[MPV] launched ${mpvPath} (pipe ${pipeName})`)
        return { success: true }
    } catch (error) {
        log.error(`[MPV] launch failed: ${error instanceof Error ? error.message : String(error)}`)
        session = null
        return { success: false, reason: 'spawn-failed' }
    }
}

export function stopMpv(): void {
    const current = session
    if (!current) return
    // Ask mpv to quit cleanly first; fall back to kill shortly after.
    const quitSent = sendCommand(['quit'])
    const child = current.child
    teardownSession(!quitSent)
    if (quitSent) {
        setTimeout(() => {
            if (child.exitCode === null && !child.killed) {
                try { child.kill() } catch { /* noop */ }
            }
        }, 1500)
    }
}

function getStatusSnapshot(): MpvStatus {
    if (!session) return createInitialStatus(false)
    const exited = session.child.exitCode !== null || session.child.killed
    return { ...session.status, running: session.status.running && !exited }
}

export function setupMpvHandlers() {
    ipcMain.handle('mpv:available', async () => {
        const path = await resolveMpvPath(true)
        return { path, configuredPath: getConfiguredPath() }
    })

    ipcMain.handle('mpv:play', async (event, payload: { url?: string; title?: string; start?: number }) => {
        const url = typeof payload?.url === 'string' ? payload.url : ''
        if (!/^https?:\/\//i.test(url)) {
            return { success: false, reason: 'invalid-url' }
        }
        log.info(`[MPV] mpv:play requested (${payload?.title ?? 'sem título'})`)
        return launchMpv({
            url,
            title: typeof payload?.title === 'string' ? payload.title : undefined,
            start: typeof payload?.start === 'number' ? payload.start : undefined,
        }, BrowserWindow.fromWebContents(event.sender))
    })

    ipcMain.handle('mpv:pause', () => ({ success: sendCommand(['set_property', 'pause', true]) }))
    ipcMain.handle('mpv:resume', () => ({ success: sendCommand(['set_property', 'pause', false]) }))

    ipcMain.handle('mpv:set-volume', (_event, payload: { volume?: number }) => {
        const volume = typeof payload?.volume === 'number' && isFinite(payload.volume) ? payload.volume : null
        if (volume === null) return { success: false }
        const clamped = Math.round(Math.min(100, Math.max(0, volume)))
        return { success: sendCommand(['set_property', 'volume', clamped]) }
    })

    ipcMain.handle('mpv:set-fullscreen', (_event, payload: { fullscreen?: boolean }) => {
        const fullscreen = payload?.fullscreen === true
        const success = sendCommand(['set_property', 'fullscreen', fullscreen])
        if (success && !fullscreen && session) {
            // Leaving fullscreen: glue the window back over the app right away
            // (the observed `fullscreen` property may lag one poll behind).
            const current = session
            current.status = { ...current.status, fullscreen: false }
            applyGeometryFromWindow(current)
        }
        return { success }
    })

    ipcMain.handle('mpv:seek', (_event, payload: { seconds?: number }) => {
        const seconds = typeof payload?.seconds === 'number' ? payload.seconds : null
        if (seconds === null) return { success: false }
        return { success: sendCommand(['seek', seconds, 'absolute']) }
    })

    ipcMain.handle('mpv:stop', () => {
        log.info('[MPV] mpv:stop requested by renderer')
        stopMpv()
        return { success: true }
    })

    ipcMain.handle('mpv:status', () => getStatusSnapshot())

    // Track switching — the reason MPV beats the web player for MP4s
    // (Chromium can't switch embedded MP4 audio tracks).
    ipcMain.handle('mpv:set-audio-track', (_event, payload: { id?: number }) => {
        if (typeof payload?.id !== 'number') return { success: false }
        return { success: sendCommand(['set_property', 'aid', payload.id]) }
    })

    ipcMain.handle('mpv:set-subtitle-track', (_event, payload: { id?: number | null }) => {
        // null turns subtitles off.
        const value = typeof payload?.id === 'number' ? payload.id : 'no'
        return { success: sendCommand(['set_property', 'sid', value]) }
    })

    // Aspect override: -1 = source aspect; "16:9" / "4:3" stretch to ratio.
    ipcMain.handle('mpv:set-aspect', (_event, payload: { aspect?: string | number }) => {
        const aspect = payload?.aspect
        if (aspect !== -1 && aspect !== '16:9' && aspect !== '4:3') return { success: false }
        return { success: sendCommand(['set_property', 'video-aspect-override', aspect]) }
    })

    // Subtitle sync: nudge mpv's sub-delay (seconds; positive = later).
    ipcMain.handle('mpv:sub-delay', (_event, payload: { delta?: number }) => {
        const delta = typeof payload?.delta === 'number' && isFinite(payload.delta) ? payload.delta : null
        if (delta === null) return { success: false }
        return { success: sendCommand(['add', 'sub-delay', delta]) }
    })

    // External subtitle (searched/downloaded by the renderer as VTT text):
    // write to a temp file and sub-add it selected. mpv reads VTT natively.
    ipcMain.handle('mpv:add-subtitle', async (_event, payload: { content?: string; title?: string; lang?: string }) => {
        try {
            if (typeof payload?.content !== 'string' || payload.content.length === 0) {
                return { success: false, error: 'empty subtitle content' }
            }
            const fs = await import('node:fs/promises')
            const filePath = path.join(app.getPath('temp'), `neostream-sub-${Date.now()}.vtt`)
            await fs.writeFile(filePath, payload.content, 'utf-8')
            const title = typeof payload.title === 'string' && payload.title ? payload.title : 'NeoStream'
            const lang = typeof payload.lang === 'string' && payload.lang ? payload.lang : 'und'
            const success = sendCommand(['sub-add', filePath, 'select', title, lang])
            log.info('[MPV] sub-add', filePath, '->', success)
            return { success }
        } catch (error) {
            log.error('[MPV] sub-add failed:', error)
            return { success: false, error: String(error) }
        }
    })

    // EXPERIMENTAL — one-click MPV install. Single in-flight download; the
    // controller doubles as the guard (null = idle).
    let downloadController: AbortController | null = null

    ipcMain.handle('mpv:download-start', async (event) => {
        if (downloadController) {
            return { success: false, reason: 'in-progress' }
        }
        const controller = new AbortController()
        downloadController = controller
        const sender = event.sender
        try {
            const runInstall = () => installMpv({
                installDir: path.join(app.getPath('userData'), 'mpv'),
                // Chromium's network stack (system proxy/TLS) — Node's undici
                // fetch proved flaky on multi-adapter/VPN machines.
                fetchImpl: electronNet.fetch as typeof fetch,
                signal: controller.signal,
                onProgress: (progress) => {
                    if (!sender.isDestroyed()) {
                        sender.send('mpv:download-progress', progress)
                    }
                },
            })
            let result = await runInstall()
            // One automatic retry for transient mid-stream interruptions —
            // a 30MB GitHub asset stream occasionally drops on flaky links.
            if (!result.success && result.reason === 'network' && !controller.signal.aborted) {
                log.warn(`[MPV] auto-download network failure, retrying once: ${result.message ?? ''}`)
                await new Promise(resolve => setTimeout(resolve, 1500))
                result = await runInstall()
            }
            if (result.success && result.path) {
                // Same flow as mpv:set-path: persist + invalidate the resolver cache.
                store.set('settings', { ...store.get('settings'), mpvPath: result.path })
                await resolveMpvPath(true)
                log.info(`[MPV] auto-download installed ${result.path} (${result.version ?? 'unknown version'})`)
            } else if (!result.success) {
                log.warn(`[MPV] auto-download failed: ${result.reason} — ${result.message ?? 'no detail'}`)
            }
            return result
        } finally {
            if (downloadController === controller) {
                downloadController = null
            }
        }
    })

    ipcMain.handle('mpv:download-cancel', () => {
        if (!downloadController) return { success: false }
        downloadController.abort()
        return { success: true }
    })

    ipcMain.handle('mpv:set-path', async (_event, payload: { path?: string }) => {
        const path = typeof payload?.path === 'string' ? payload.path.trim() : ''
        const settings = { ...store.get('settings') }
        if (path) {
            settings.mpvPath = path
        } else {
            delete settings.mpvPath
        }
        store.set('settings', settings)
        const resolved = await resolveMpvPath(true)
        return { path: resolved }
    })

    app.on('will-quit', () => {
        stopMpv()
    })
}
