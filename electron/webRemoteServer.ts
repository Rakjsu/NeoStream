/**
 * Phone remote: a tiny HTTP + WebSocket server on the LAN. The phone opens
 * `http://<lan-ip>:<port>/` (a self-contained control page), which connects
 * back over WebSocket to receive the current media state and send commands
 * (play/pause, stop, volume, seek). Commands are forwarded to the renderer's
 * existing `media:control` channel — the same one the tray menu uses.
 *
 * WebSocket is hand-rolled (webRemoteProtocol.ts) — no `ws` dependency, same
 * from-scratch spirit as DLNA/Cast. Opt-in from Settings; off by default.
 */

import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import os from 'node:os'
import type { Socket } from 'node:net'
import { BrowserWindow, ipcMain } from 'electron'
import Store from 'electron-store'
import log from './logger'
import { generateSelfSignedCert } from './selfSignedCert'
import {
    buildHandshakeResponse,
    encodeTextFrame,
    encodePongFrame,
    decodeFrames,
    parseRemoteCommand,
    isPinLockedOut,
    registerPinFailure,
    pickLanAddress,
    type PinGateEntry,
    type NetAddress,
} from './webRemoteProtocol'
import { REMOTE_PAGE_HTML } from './webRemotePage'
import { REMOTE_ICON_SVG, buildManifest, solidPng } from './webRemoteAssets'
import { isCastSessionActive, castRemoteControl, getCastStatus } from './castHandlers'

interface WebRemoteConfig {
    enabled: boolean
    /** Opt-in: serve over HTTPS/wss with a self-signed cert (phone accepts once). */
    https: boolean
}

const store = new Store<{ webRemote: WebRemoteConfig }>({ name: 'web-remote' })

interface ClientSocket {
    socket: Socket
    buffer: Uint8Array
}

interface GuideChannel {
    id: string
    name: string
    logo: string
}
interface GuideEpg {
    now: string
    nowStart: string
    nowEnd: string
    next: string
}
interface GuideState {
    channels: GuideChannel[]
    playingId: string
    epg: GuideEpg | null
}

// Stable port so the phone's installed PWA / bookmark survives app restarts.
// Unassigned range; falls back to an ephemeral port when already in use.
const PREFERRED_PORT = 8974

let server: http.Server | https.Server | null = null
let serverPort = 0
let serverSecure = false
let sessionPin = ''
// Per-client PIN failure tracking, so a wrong PIN can't be brute-forced over
// the LAN (10k combos). Keyed by remote IP; cleared on the server stopping.
const pinGate = new Map<string, PinGateEntry>()
const clients = new Set<ClientSocket>()
let mediaState = { hasMedia: false, playing: false, title: '' }
// Second-screen guide: the live channel list + now/next EPG of the playing
// channel, pushed by the LiveTV renderer while it's mounted. Null until the
// user opens the TV ao vivo page (the phone shows a hint in the meantime).
let guideState: GuideState | null = null

/** Fresh 4-digit pairing PIN (regenerated each time the server starts). */
function newPin(): string {
    // crypto.randomInt keeps it uniform; padded to 4 digits.
    return String(crypto.randomInt(0, 10000)).padStart(4, '0')
}

function getConfig(): WebRemoteConfig {
    return { enabled: false, https: false, ...(store.get('webRemote') as Partial<WebRemoteConfig> | undefined) }
}

/** The LAN URL of the running server (http/https), or null when stopped. */
function serverUrl(): string | null {
    return serverPort ? `${serverSecure ? 'https' : 'http'}://${getLanAddress()}:${serverPort}/` : null
}

/** Best LAN IPv4 the phone can reach (skips VPN/virtual adapters), or 127.0.0.1. */
export function getLanAddress(): string {
    return pickLanAddress(os.networkInterfaces() as Record<string, NetAddress[] | undefined>)
}

function stateMessage(): string {
    // `casting` lets the phone show it's driving the Chromecast, not the app;
    // castTime/castDuration drive the cast progress bar on the Controle tab.
    const cs = getCastStatus()
    return JSON.stringify({
        type: 'state', ...mediaState, casting: cs.active,
        castTime: cs.currentTime, castDuration: cs.duration,
        castPlaying: cs.playing,
        // What's on the TV (episode/movie title) so the phone shows it.
        castTitle: cs.title,
        // 💬 toggle on the phone (hidden when the media has no track).
        castSubAvailable: cs.subtitleAvailable,
        castSubEnabled: cs.subtitleEnabled,
        // 🔊 absolute volume slider + audio-track picker on the phone.
        castVolume: cs.volume,
        castAudioTracks: cs.audioTracks,
        castAudioActive: cs.activeAudioTrackId,
    })
}

function guideMessage(): string {
    return JSON.stringify({ type: 'guide', ...(guideState ?? { channels: [], playingId: '', epg: null }) })
}

function broadcast(text: string): void {
    const frame = encodeTextFrame(text)
    for (const client of clients) {
        try {
            client.socket.write(frame)
        } catch { /* dropped on next read */ }
    }
}

function broadcastState(): void {
    broadcast(stateMessage())
}

/** Sanitize the untrusted guide payload coming from the renderer. */
function sanitizeGuide(raw: unknown): GuideState {
    const obj = (raw ?? {}) as Record<string, unknown>
    const rawChannels = Array.isArray(obj.channels) ? obj.channels : []
    const channels: GuideChannel[] = rawChannels.slice(0, 600).map((c) => {
        const ch = (c ?? {}) as Record<string, unknown>
        return {
            id: String(ch.id ?? ''),
            name: typeof ch.name === 'string' ? ch.name.slice(0, 160) : '',
            logo: typeof ch.logo === 'string' ? ch.logo.slice(0, 500) : '',
        }
    }).filter((c) => c.id && c.name)
    const rawEpg = obj.epg as Record<string, unknown> | null | undefined
    const epg: GuideEpg | null = rawEpg && typeof rawEpg === 'object'
        ? {
            now: typeof rawEpg.now === 'string' ? rawEpg.now.slice(0, 200) : '',
            nowStart: typeof rawEpg.nowStart === 'string' ? rawEpg.nowStart : '',
            nowEnd: typeof rawEpg.nowEnd === 'string' ? rawEpg.nowEnd : '',
            next: typeof rawEpg.next === 'string' ? rawEpg.next.slice(0, 200) : '',
        }
        : null
    return { channels, playingId: String(obj.playingId ?? ''), epg }
}

function handleUpgrade(request: http.IncomingMessage, socket: Socket): void {
    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') {
        socket.destroy()
        return
    }
    // PIN gate: the page connects to ws://host/?pin=NNNN. A wrong/absent PIN
    // is refused before the WebSocket is established; too many wrong PINs from
    // the same client trip a cooldown (anti brute-force).
    const ip = socket.remoteAddress || 'unknown'
    const now = Date.now()
    if (isPinLockedOut(pinGate.get(ip), now)) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n')
        socket.destroy()
        return
    }
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.searchParams.get('pin') !== sessionPin) {
        const entry = registerPinFailure(pinGate.get(ip), now)
        pinGate.set(ip, entry)
        if (entry.lockedUntil > now) log.warn(`[WebRemote] PIN bloqueado por tentativas: ${ip}`)
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
    }
    // Correct PIN: clear any accumulated failures for this client.
    pinGate.delete(ip)
    socket.write(buildHandshakeResponse(key))
    const client: ClientSocket = { socket, buffer: new Uint8Array(0) }
    clients.add(client)
    // Send the current state + guide snapshot immediately.
    socket.write(encodeTextFrame(stateMessage()))
    if (guideState) socket.write(encodeTextFrame(guideMessage()))

    socket.on('data', (chunk: Buffer) => {
        const glued = new Uint8Array(client.buffer.length + chunk.length)
        glued.set(client.buffer, 0)
        glued.set(chunk, client.buffer.length)
        try {
            const { frames, rest } = decodeFrames(glued)
            client.buffer = rest
            for (const frame of frames) {
                if (frame.type === 'close') {
                    socket.end()
                } else if (frame.type === 'ping') {
                    socket.write(encodePongFrame(frame.payload))
                } else if (frame.type === 'text') {
                    const command = parseRemoteCommand(frame.text)
                    if (command) forwardCommand(command)
                }
            }
        } catch (error) {
            log.warn('[WebRemote] frame inválido, encerrando cliente:', error)
            socket.destroy()
        }
    })
    const drop = () => clients.delete(client)
    socket.on('close', drop)
    socket.on('error', drop)
}

// Actions that always go to the renderer (never routed to the cast session).
const RENDERER_ONLY = new Set(['playChannel', 'requestEpg', 'requestCatalog', 'requestContinue', 'requestRecommended', 'requestDevices', 'castMovie', 'castMovieQueue', 'requestSeries', 'requestSeriesInfo', 'castEpisode'])

function forwardCommand(command: ReturnType<typeof parseRemoteCommand>): void {
    if (!command) return
    // While a Chromecast is casting, transport commands drive the cast instead
    // of the local player. Channel/catalog actions always go to the renderer.
    if (!RENDERER_ONLY.has(command.action)) {
        const value = command.action === 'seek' ? command.seconds
            : command.action === 'setVolume' ? command.level
            : command.action === 'setAudioTrack' ? command.trackId
            : undefined
        if (castRemoteControl(command.action, value)) {
            broadcastState() // refresh the phone's casting/playing indicator
            return
        }
    }
    // These two only make sense while a cast session is live; with none active
    // there is nothing for the renderer to do with them.
    if (command.action === 'setVolume' || command.action === 'setAudioTrack') return
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
    if (!win) return
    // The renderer's media:control handler maps these to player actions.
    if (command.action === 'seek') {
        win.webContents.send('media:control', 'seek', command.seconds)
    } else if (command.action === 'playChannel') {
        win.webContents.send('media:control', 'playChannel', command.channelId)
    } else if (command.action === 'requestEpg') {
        win.webContents.send('media:control', 'requestEpg', command.channelId)
    } else if (command.action === 'castMovie') {
        win.webContents.send('media:control', 'castMovie', command.movieId, command.target)
    } else if (command.action === 'castMovieQueue') {
        win.webContents.send('media:control', 'castMovieQueue', command.movieIds, command.target)
    } else if (command.action === 'castEpisode') {
        win.webContents.send('media:control', 'castEpisode', command.episodeId, command.target)
    } else if (command.action === 'requestSeriesInfo') {
        win.webContents.send('media:control', 'requestSeriesInfo', command.seriesId)
    } else if (command.action === 'requestCatalog') {
        win.webContents.send('media:control', 'requestCatalog', command.query)
    } else if (command.action === 'requestSeries') {
        win.webContents.send('media:control', 'requestSeries', command.query)
    } else if (command.action === 'requestContinue') {
        win.webContents.send('media:control', 'requestContinue')
    } else if (command.action === 'requestRecommended') {
        win.webContents.send('media:control', 'requestRecommended')
    } else if (command.action === 'requestDevices') {
        win.webContents.send('media:control', 'requestDevices')
    } else {
        win.webContents.send('media:control', command.action)
    }
}

export function setupWebRemote(): void {
    // While casting, push fresh cast position to the phone every 2s so the
    // Controle tab's progress bar advances (cheap: only when clients + casting).
    setInterval(() => {
        if (clients.size > 0 && isCastSessionActive()) broadcastState()
    }, 2000)

    // Mirror the renderer's player state (the tray listens too; multiple
    // listeners are fine) so new WS clients get the latest snapshot.
    ipcMain.on('media:state', (_e, state: { hasMedia?: boolean; playing?: boolean; title?: string }) => {
        mediaState = {
            hasMedia: state?.hasMedia === true,
            playing: state?.playing === true,
            title: typeof state?.title === 'string' ? state.title : '',
        }
        broadcastState()
    })

    // The LiveTV page pushes its channel list + now/next EPG here while it's
    // mounted, so the phone can show a second-screen guide and tap to switch.
    ipcMain.on('web-remote:guide', (_e, raw: unknown) => {
        guideState = sanitizeGuide(raw)
        broadcast(guideMessage())
    })

    // On-demand EPG for a single channel: the renderer answers a requestEpg by
    // fetching that channel's now/next and pushing it here, relayed to phones.
    ipcMain.on('web-remote:channel-epg', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const channelId = String(obj.channelId ?? '')
        if (!channelId) return
        const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
        broadcast(JSON.stringify({
            type: 'channelEpg',
            channelId,
            now: str(obj.now, 200),
            nowStart: str(obj.nowStart, 20),
            nowEnd: str(obj.nowEnd, 20),
            next: str(obj.next, 200),
        }))
    })

    // The renderer bridge answers requestCatalog with a page of movies here.
    ipcMain.on('web-remote:catalog', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const rawItems = Array.isArray(obj.items) ? obj.items : []
        const items = rawItems.slice(0, 400).map((c) => {
            const it = (c ?? {}) as Record<string, unknown>
            return {
                id: String(it.id ?? ''),
                name: typeof it.name === 'string' ? it.name.slice(0, 200) : '',
                cover: typeof it.cover === 'string' ? it.cover.slice(0, 500) : '',
            }
        }).filter((c) => c.id && c.name)
        broadcast(JSON.stringify({ type: 'catalog', items }))
    })

    // Series list (browse) pushed by the renderer bridge.
    ipcMain.on('web-remote:series', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const rawItems = Array.isArray(obj.items) ? obj.items : []
        const items = rawItems.slice(0, 400).map((c) => {
            const it = (c ?? {}) as Record<string, unknown>
            return {
                id: String(it.id ?? ''),
                name: typeof it.name === 'string' ? it.name.slice(0, 200) : '',
                cover: typeof it.cover === 'string' ? it.cover.slice(0, 500) : '',
            }
        }).filter((c) => c.id && c.name)
        broadcast(JSON.stringify({ type: 'series', items }))
    })

    // Episodes of one series (flattened SxxEyy) pushed by the bridge.
    ipcMain.on('web-remote:series-info', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const seriesId = String(obj.seriesId ?? '')
        if (!seriesId) return
        const rawEps = Array.isArray(obj.episodes) ? obj.episodes : []
        const episodes = rawEps.slice(0, 1000).map((e) => {
            const ep = (e ?? {}) as Record<string, unknown>
            return {
                id: String(ep.id ?? ''),
                label: typeof ep.label === 'string' ? ep.label.slice(0, 200) : '',
            }
        }).filter((e) => e.id && e.label)
        broadcast(JSON.stringify({ type: 'seriesInfo', seriesId, episodes }))
    })

    // "Continue watching" list (movies + resume episodes) built by the bridge.
    ipcMain.on('web-remote:continue', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const rawItems = Array.isArray(obj.items) ? obj.items : []
        const items = rawItems.slice(0, 40).map((c) => {
            const it = (c ?? {}) as Record<string, unknown>
            const kind = it.kind === 'series' ? 'series' : 'movie'
            const pct = typeof it.pct === 'number' && Number.isFinite(it.pct) ? Math.max(0, Math.min(100, Math.round(it.pct))) : 0
            return {
                kind,
                castId: String(it.castId ?? ''),
                name: typeof it.name === 'string' ? it.name.slice(0, 200) : '',
                cover: typeof it.cover === 'string' ? it.cover.slice(0, 500) : '',
                pct,
            }
        }).filter((c) => c.castId && c.name)
        broadcast(JSON.stringify({ type: 'continue', items }))
    })

    // Habit-based "porque você assistiu" rows built by the renderer bridge
    // (same engine as the Home page), relayed to the phone's Continuar tab.
    ipcMain.on('web-remote:recommended', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const rawGroups = Array.isArray(obj.groups) ? obj.groups : []
        const groups = rawGroups.slice(0, 5).map((g) => {
            const grp = (g ?? {}) as Record<string, unknown>
            const rawItems = Array.isArray(grp.items) ? grp.items : []
            const items = rawItems.slice(0, 12).map((c) => {
                const it = (c ?? {}) as Record<string, unknown>
                return {
                    kind: it.kind === 'series' ? 'series' : 'movie',
                    id: String(it.id ?? ''),
                    name: typeof it.name === 'string' ? it.name.slice(0, 200) : '',
                    cover: typeof it.cover === 'string' ? it.cover.slice(0, 500) : '',
                }
            }).filter((c) => c.id && c.name)
            return {
                seed: typeof grp.seed === 'string' ? grp.seed.slice(0, 120) : '',
                items,
            }
        }).filter((g) => g.seed && g.items.length > 0)
        broadcast(JSON.stringify({ type: 'recommended', groups }))
    })

    // Cast targets (Chromecast + DLNA + AirPlay) discovered by the bridge.
    ipcMain.on('web-remote:devices', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const rawItems = Array.isArray(obj.items) ? obj.items : []
        const items = rawItems.slice(0, 50).map((c) => {
            const it = (c ?? {}) as Record<string, unknown>
            const type = it.type === 'dlna' || it.type === 'airplay' ? it.type : 'chromecast'
            return {
                id: String(it.id ?? ''),
                name: typeof it.name === 'string' ? it.name.slice(0, 120) : '',
                type,
            }
        }).filter((c) => c.id && c.name)
        broadcast(JSON.stringify({ type: 'devices', items }))
    })

    // Result of a cast started from the phone (ok / no-device / error).
    ipcMain.on('web-remote:cast-result', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const status = obj.status === 'ok' || obj.status === 'no-device' ? obj.status : 'error'
        const deviceName = typeof obj.deviceName === 'string' ? obj.deviceName.slice(0, 120) : ''
        broadcast(JSON.stringify({ type: 'castResult', status, deviceName }))
    })

    ipcMain.handle('web-remote:get-config', () => ({
        success: true,
        enabled: getConfig().enabled,
        https: getConfig().https,
        url: serverUrl(),
        pin: serverPort ? sessionPin : null,
    }))

    ipcMain.handle('web-remote:set-enabled', async (_e, opts: { enabled?: boolean; https?: boolean }) => {
        const current = getConfig()
        const enabled = opts?.enabled ?? current.enabled
        const useHttps = opts?.https ?? current.https
        store.set('webRemote', { enabled, https: useHttps })
        // Restart so an https toggle (or on/off) takes effect immediately.
        stop()
        if (enabled) await start()
        return {
            success: true,
            enabled,
            https: useHttps,
            url: serverUrl(),
            pin: serverPort ? sessionPin : null,
        }
    })

    // Rotate the pairing PIN on demand: a new code + drop current clients so
    // old pairings are revoked (the phone re-prompts, its saved PIN now fails).
    ipcMain.handle('web-remote:regen-pin', () => {
        if (!serverPort) return { success: false, error: 'Controle desativado' }
        sessionPin = newPin()
        pinGate.clear()
        for (const client of clients) client.socket.destroy()
        clients.clear()
        log.info('[WebRemote] PIN regenerado')
        return { success: true, pin: sessionPin }
    })

    if (getConfig().enabled) void start()
    log.info('[WebRemote] initialized')
}

function start(): Promise<void> {
    if (server) return Promise.resolve()
    sessionPin = newPin()
    serverSecure = getConfig().https
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
        if (req.url === '/' || req.url === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
            // PIN is NOT injected — the phone must enter the code shown on
            // the desktop settings screen (the page prompts + stores it).
            res.end(REMOTE_PAGE_HTML)
            return
        }
        // PWA assets: "Add to home screen" installs the remote as a real app.
        if (req.url === '/manifest.webmanifest') {
            res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'max-age=3600' })
            res.end(buildManifest())
            return
        }
        if (req.url === '/icon.svg') {
            res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'max-age=86400' })
            res.end(REMOTE_ICON_SVG)
            return
        }
        if (req.url === '/icon.png') {
            // iOS apple-touch-icon (can't take the SVG) — solid indigo square.
            res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' })
            res.end(solidPng(180, 0x4f, 0x46, 0xe5))
            return
        }
        res.writeHead(404)
        res.end()
    }
    return new Promise<void>((resolve) => {
        if (serverSecure) {
            // Fresh self-signed cert per start (hand-rolled X.509). The phone
            // accepts it once; the page connects over wss on the same port. The
            // LAN IP goes in the SAN so mobile browsers validate the host.
            const { key, cert } = generateSelfSignedCert(Date.now(), {
                commonName: getLanAddress(),
                altNames: [getLanAddress(), '127.0.0.1', 'localhost'],
            })
            server = https.createServer({ key, cert }, handler)
        } else {
            server = http.createServer(handler)
        }
        server.on('upgrade', (req, socket) => handleUpgrade(req, socket as Socket))
        // Fixed port first: the phone's installed PWA keeps its URL across app
        // restarts (an ephemeral port would break it every session). If the
        // preferred port is taken, fall back to an ephemeral one — the QR code
        // in Settings always shows the live URL.
        const onListening = () => {
            const address = server?.address()
            serverPort = typeof address === 'object' && address ? address.port : 0
            log.info('[WebRemote] listening on', `${serverUrl()}`)
            resolve()
        }
        server.once('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE' && server) {
                log.warn(`[WebRemote] porta ${PREFERRED_PORT} ocupada — usando porta efêmera`)
                server.on('error', (err) => log.error('[WebRemote] server error:', err))
                server.listen(0, '0.0.0.0', onListening)
                return
            }
            log.error('[WebRemote] server error:', error)
            resolve() // don't hang the caller; enable() reports the URL as null
        })
        // Bind to all interfaces so the phone on the LAN can reach it.
        server.listen(PREFERRED_PORT, '0.0.0.0', onListening)
    })
}

function stop(): void {
    for (const client of clients) client.socket.destroy()
    clients.clear()
    server?.close()
    server = null
    serverPort = 0
    serverSecure = false
    sessionPin = ''
    pinGate.clear()
}

export function teardownWebRemote(): void {
    stop()
}
