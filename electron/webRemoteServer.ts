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
import crypto from 'node:crypto'
import os from 'node:os'
import type { Socket } from 'node:net'
import { BrowserWindow, ipcMain } from 'electron'
import Store from 'electron-store'
import log from './logger'
import {
    buildHandshakeResponse,
    encodeTextFrame,
    encodePongFrame,
    decodeFrames,
    parseRemoteCommand,
} from './webRemoteProtocol'
import { REMOTE_PAGE_HTML } from './webRemotePage'

interface WebRemoteConfig {
    enabled: boolean
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

let server: http.Server | null = null
let serverPort = 0
let sessionPin = ''
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
    return { enabled: false, ...(store.get('webRemote') as Partial<WebRemoteConfig> | undefined) }
}

/** Best LAN IPv4 (first non-internal), or 127.0.0.1. */
export function getLanAddress(): string {
    for (const addresses of Object.values(os.networkInterfaces())) {
        for (const addr of addresses ?? []) {
            if (addr.family === 'IPv4' && !addr.internal) return addr.address
        }
    }
    return '127.0.0.1'
}

function stateMessage(): string {
    return JSON.stringify({ type: 'state', ...mediaState })
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
    // is refused before the WebSocket is established.
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.searchParams.get('pin') !== sessionPin) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
    }
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

function forwardCommand(command: ReturnType<typeof parseRemoteCommand>): void {
    if (!command) return
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
    if (!win) return
    // The renderer's media:control handler maps these to player actions.
    if (command.action === 'seek') {
        win.webContents.send('media:control', 'seek', command.seconds)
    } else if (command.action === 'playChannel') {
        win.webContents.send('media:control', 'playChannel', command.channelId)
    } else {
        win.webContents.send('media:control', command.action)
    }
}

export function setupWebRemote(): void {
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

    ipcMain.handle('web-remote:get-config', () => ({
        success: true,
        enabled: getConfig().enabled,
        url: serverPort ? `http://${getLanAddress()}:${serverPort}/` : null,
        pin: serverPort ? sessionPin : null,
    }))

    ipcMain.handle('web-remote:set-enabled', async (_e, { enabled }: { enabled?: boolean }) => {
        store.set('webRemote', { enabled: enabled === true })
        if (enabled === true) await start()
        else stop()
        return {
            success: true,
            enabled: enabled === true,
            url: serverPort ? `http://${getLanAddress()}:${serverPort}/` : null,
            pin: serverPort ? sessionPin : null,
        }
    })

    if (getConfig().enabled) void start()
    log.info('[WebRemote] initialized')
}

function start(): Promise<void> {
    if (server) return Promise.resolve()
    sessionPin = newPin()
    return new Promise<void>((resolve) => {
        server = http.createServer((req, res) => {
            if (req.url === '/' || req.url === '/index.html') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
                // PIN is NOT injected — the phone must enter the code shown on
                // the desktop settings screen (the page prompts + stores it).
                res.end(REMOTE_PAGE_HTML)
                return
            }
            res.writeHead(404)
            res.end()
        })
        server.on('upgrade', (req, socket) => handleUpgrade(req, socket as Socket))
        server.on('error', (error) => log.error('[WebRemote] server error:', error))
        // Bind to all interfaces so the phone on the LAN can reach it.
        server.listen(0, '0.0.0.0', () => {
            const address = server?.address()
            serverPort = typeof address === 'object' && address ? address.port : 0
            log.info('[WebRemote] listening on', `${getLanAddress()}:${serverPort}`)
            resolve()
        })
    })
}

function stop(): void {
    for (const client of clients) client.socket.destroy()
    clients.clear()
    server?.close()
    server = null
    serverPort = 0
    sessionPin = ''
}

export function teardownWebRemote(): void {
    stop()
}
