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
import path from 'node:path'
import fs from 'node:fs'
import { app, BrowserWindow, ipcMain } from 'electron'
import Store from 'electron-store'
import log from './logger'
import { generateSelfSignedCert } from './selfSignedCert'
import { recordingsDir } from './dvrHandlers'
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
    parseProgressReport,
} from './webRemoteProtocol'
import { renderRemotePage, type RemoteAccent } from './webRemotePage'
import { buildSetupDeepLink, renderSetupHandoffPage } from './setupPayload'
import { parseTransferQuery } from './transferReceiver'
import { exportPlaylistsForSetup, getActivePlaylistIdPublic } from './playlistManager'
import { REMOTE_ICON_SVG, buildManifest, solidPng } from './webRemoteAssets'
import { isCastSessionActive, castRemoteControl, getCastStatus } from './castHandlers'
import { dlnaRemoteControl, isDlnaSessionActive, getDlnaStatusSnapshot } from './dlnaHandlers'
import { dlnaStateFields } from './dlnaRemoteRouting'
import { airplayRemoteControl, isAirplaySessionActive, getAirplayStatusSnapshot } from './airplayHandlers'
import { airplayStateFields } from './airplayRemoteRouting'

interface WebRemoteConfig {
    enabled: boolean
    /** Opt-in: serve over HTTPS/wss with a self-signed cert (phone accepts once). */
    https: boolean
}

interface ConnectionEvent {
    name: string | null
    ip: string
    role: string
    at: number
    event: 'connect' | 'disconnect'
}

const store = new Store<{ webRemote: WebRemoteConfig; connectionHistory: ConnectionEvent[] }>({ name: 'web-remote' })

// 🕓 Item 14: histórico de conexões do controle (persistido, teto 50).
function pushHistory(event: ConnectionEvent): void {
    const list = (store.get('connectionHistory') as ConnectionEvent[] | undefined) ?? []
    list.push(event)
    store.set('connectionHistory', list.slice(-50))
}

interface ClientSocket {
    socket: Socket
    buffer: Uint8Array
    /** 📟 Item 14: id estável da sessão — alvo do "desconectar" do painel. */
    id: string
    /** 📟 Identificação pro painel de aparelhos conectados. */
    ip?: string
    connectedAt?: number
    /** 'mobile' quando o cliente é o app NeoStream Mobile (não a página do navegador). */
    role?: 'mobile'
    name?: string
}

interface GuideChannel {
    id: string
    name: string
    logo: string
    /** Número do canal (zap por número na página). */
    num?: number
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

// Latest DLNA session snapshot, refreshed by the 2s poll below (SOAP is too
// slow to fetch inline in stateMessage). Null when no DLNA session.
let dlnaState: ReturnType<typeof dlnaStateFields> | null = null
// Same idea for AirPlay (GET /scrub round-trip). Null when no session.
let airplayState: ReturnType<typeof airplayStateFields> | null = null

function stateMessage(): string {
    // `casting` lets the phone show it's driving the Chromecast, not the app;
    // castTime/castDuration drive the cast progress bar on the Controle tab.
    const cs = getCastStatus()
    if (!cs.active && (dlnaState || airplayState)) {
        // DLNA/AirPlay session: same field shape as Chromecast so the page
        // just works. No subtitle toggle / audio picker — not exposed there.
        return JSON.stringify({
            type: 'state', ...mediaState, ...(dlnaState ?? airplayState),
            castSubAvailable: false, castSubEnabled: true,
            castAudioTracks: [], castAudioActive: null,
        })
    }
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
        // Which TV is receiving the cast ("Transmitindo em <nome>").
        castDevice: cs.deviceName,
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

/** Envia um comando só pros clientes que são o APP mobile (não a página). */
function sendToMobileClients(text: string): number {
    const frame = encodeTextFrame(text)
    let delivered = 0
    for (const client of clients) {
        if (client.role !== 'mobile') continue
        try {
            client.socket.write(frame)
            delivered++
        } catch { /* dropped on next read */ }
    }
    return delivered
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
            num: Number(ch.num) > 0 ? Number(ch.num) : undefined,
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
    const client: ClientSocket = { socket, buffer: new Uint8Array(0), id: crypto.randomUUID(), ip, connectedAt: Date.now() }
    clients.add(client)
    pushHistory({ name: null, ip: ip ?? '?', role: 'browser', at: Date.now(), event: 'connect' })
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
                    // Hello do app mobile: marca o cliente como app — vira o
                    // alvo do "enviar pro celular" (a página do navegador não).
                    if (frame.text.includes('helloMobile')) {
                        try {
                            const hello = JSON.parse(frame.text) as { action?: unknown; name?: unknown } | null
                            if (hello?.action === 'helloMobile') {
                                client.role = 'mobile'
                                client.name = typeof hello.name === 'string' ? hello.name.slice(0, 40) : 'celular'
                                log.info('[WebRemote] app mobile conectado:', client.name)
                                continue
                            }
                        } catch { /* não era o hello — segue o parse normal */ }
                    }
                    const command = parseRemoteCommand(frame.text)
                    if (command) forwardCommand(command)
                }
            }
        } catch (error) {
            log.warn('[WebRemote] frame inválido, encerrando cliente:', error)
            socket.destroy()
        }
    })
    const drop = () => {
        if (clients.delete(client)) {
            pushHistory({ name: client.name ?? null, ip: client.ip ?? '?', role: client.role ?? 'browser', at: Date.now(), event: 'disconnect' })
        }
    }
    socket.on('close', drop)
    socket.on('error', drop)
}

// Actions that always go to the renderer (never routed to the cast session).
const RENDERER_ONLY = new Set(['playChannel', 'requestEpg', 'recordChannel', 'stopRecord', 'deleteRecording', 'scheduleNext', 'cancelSchedule', 'requestRecordings', 'renameRecording', 'toggleProtectRecording', 'navKey', 'requestFavorites', 'reportProgress', 'requestCatalog', 'requestLiveSearch', 'requestContinue', 'requestRecommended', 'requestDevices', 'castMovie', 'castMovieQueue', 'requestSeries', 'requestSeriesInfo', 'castEpisode', 'sleep', 'requestStats', 'requestReminders', 'cancelReminder', 'partyAdd'])

function forwardCommand(command: ReturnType<typeof parseRemoteCommand>): void {
    if (!command) return
    // 🖥️ Trazer o app pra frente — não depende do renderer nem do cast.
    if (command.action === 'focusApp') {
        const appWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
        if (appWin) {
            if (appWin.isMinimized()) appWin.restore()
            appWin.show()
            appWin.focus()
        }
        return
    }
    if (command.action === 'openMultiview') {
        // 🎛️ Traz o app, navega pra TV ao vivo (canal da bandeja) e pede o
        // multi-view com um pequeno atraso pra página já estar montada.
        const appWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
        if (appWin) {
            if (appWin.isMinimized()) appWin.restore()
            appWin.show()
            appWin.focus()
            appWin.webContents.send('tray:navigate', '/dashboard/live')
            setTimeout(() => {
                if (!appWin.isDestroyed()) appWin.webContents.send('media:control', 'openMultiview')
            }, 700)
        }
        return
    }
    if (command.action === 'screenshot') {
        // 📷 Captura a janela do app e devolve pra página (reduzida pra LAN).
        const appWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
        if (!appWin) {
            broadcast(JSON.stringify({ type: 'screenshot', dataUrl: null }))
            return
        }
        appWin.webContents.capturePage()
            .then(image => {
                const size = image.getSize()
                const resized = size.width > 900 ? image.resize({ width: 900 }) : image
                broadcast(JSON.stringify({ type: 'screenshot', dataUrl: resized.toDataURL() }))
            })
            .catch(() => broadcast(JSON.stringify({ type: 'screenshot', dataUrl: null })))
        return
    }
    // While a cast session is live, transport commands drive the TV instead of
    // the local player: Chromecast first, then an active DLNA session. Channel
    // and catalog actions always go to the renderer.
    if (!RENDERER_ONLY.has(command.action)) {
        const value = command.action === 'seek' ? command.seconds
            : command.action === 'setVolume' ? command.level
            : command.action === 'setAudioTrack' ? command.trackId
            : undefined
        if (castRemoteControl(command.action, value)) {
            broadcastState() // refresh the phone's casting/playing indicator
            return
        }
        if (dlnaRemoteControl(command.action, value)) return
        if (airplayRemoteControl(command.action, value)) return
    }
    // These two only make sense while a cast session is live; with none active
    // there is nothing for the renderer to do with them.
    if (command.action === 'setVolume' || command.action === 'setAudioTrack') return
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
    if (!win) return
    // The renderer's media:control handler maps these to player actions.
    if (command.action === 'seek') {
        win.webContents.send('media:control', 'seek', command.seconds)
    } else if (command.action === 'sleep') {
        win.webContents.send('media:control', 'sleep', command.minutes)
    } else if (command.action === 'requestStats') {
        win.webContents.send('media:control', 'requestStats')
    } else if (command.action === 'reportProgress') {
        // 🔄 Item 11: posição vinda do celular → renderer grava no histórico.
        win.webContents.send('media:control', 'reportProgress', command.report)
    } else if (command.action === 'playChannel') {
        win.webContents.send('media:control', 'playChannel', command.channelId)
    } else if (command.action === 'requestEpg') {
        win.webContents.send('media:control', 'requestEpg', command.channelId)
    } else if (command.action === 'recordChannel') {
        win.webContents.send('media:control', 'recordChannel', command.channelId, command.channelName)
    } else if (command.action === 'stopRecord') {
        win.webContents.send('media:control', 'stopRecord', command.id)
    } else if (command.action === 'deleteRecording') {
        win.webContents.send('media:control', 'deleteRecording', command.name)
    } else if (command.action === 'renameRecording') {
        win.webContents.send('media:control', 'renameRecording', command.name, command.newName)
    } else if (command.action === 'toggleProtectRecording') {
        win.webContents.send('media:control', 'toggleProtectRecording', command.name)
    } else if (command.action === 'navKey') {
        win.webContents.send('media:control', 'navKey', command.key)
    } else if (command.action === 'requestFavorites') {
        win.webContents.send('media:control', 'requestFavorites')
    } else if (command.action === 'cancelReminder') {
        win.webContents.send('media:control', 'cancelReminder', command.id)
    } else if (command.action === 'scheduleNext') {
        win.webContents.send('media:control', 'scheduleNext', command.channelId)
    } else if (command.action === 'cancelSchedule') {
        win.webContents.send('media:control', 'cancelSchedule', command.id)
    } else if (command.action === 'castMovie') {
        win.webContents.send('media:control', 'castMovie', command.movieId, command.target)
    } else if (command.action === 'partyAdd') {
        win.webContents.send('media:control', 'partyAdd', command.movieId)
    } else if (command.action === 'castMovieQueue') {
        win.webContents.send('media:control', 'castMovieQueue', command.movieIds, command.target)
    } else if (command.action === 'castEpisode') {
        win.webContents.send('media:control', 'castEpisode', command.episodeId, command.target)
    } else if (command.action === 'requestSeriesInfo') {
        win.webContents.send('media:control', 'requestSeriesInfo', command.seriesId)
    } else if (command.action === 'requestCatalog') {
        win.webContents.send('media:control', 'requestCatalog', command.query)
    } else if (command.action === 'requestLiveSearch') {
        win.webContents.send('media:control', 'requestLiveSearch', command.query)
    } else if (command.action === 'requestSeries') {
        win.webContents.send('media:control', 'requestSeries', command.query)
    } else if (command.action === 'requestContinue') {
        win.webContents.send('media:control', 'requestContinue')
    } else if (command.action === 'requestRecordings') {
        win.webContents.send('media:control', 'requestRecordings')
    } else if (command.action === 'requestRecommended') {
        win.webContents.send('media:control', 'requestRecommended')
    } else if (command.action === 'requestDevices') {
        win.webContents.send('media:control', 'requestDevices')
    } else {
        win.webContents.send('media:control', command.action)
    }
}

// Language of the served phone page — mirrors the app's i18next language
// (the renderer pushes it on boot and on change); persisted so the very first
// page load after a restart already comes localized.
let remoteLang = (store.get('webRemoteLang') as string | undefined) || 'pt'

// Accent colors of the served page — mirrors the desktop theme (same flow as
// the language above); persisted so the first load after a restart matches.
let remoteAccent = (store.get('webRemoteAccent') as RemoteAccent | undefined) || null

export function setupWebRemote(): void {
    ipcMain.on('app:language', (_e, raw: unknown) => {
        const code = String(raw ?? '').slice(0, 2)
        if (code === 'pt' || code === 'en' || code === 'es') {
            remoteLang = code
            store.set('webRemoteLang', code)
        }
    })

    ipcMain.on('app:accent', (_e, raw: unknown) => {
        const a = raw as Partial<RemoteAccent> | null
        const isCssColorish = (s: unknown): s is string =>
            typeof s === 'string' && s.length <= 40 && /^[#a-zA-Z0-9(),.% -]+$/.test(s)
        if (a && isCssColorish(a.main) && isCssColorish(a.dark) && isCssColorish(a.rgb)) {
            remoteAccent = { main: a.main, dark: a.dark, rgb: a.rgb }
            store.set('webRemoteAccent', remoteAccent)
        }
    })

    // While casting, push fresh cast position to the phone every 2s so the
    // Controle tab's progress bar advances (cheap: only when clients + casting).
    // Chromecast state is in-memory; DLNA needs SOAP round-trips, so its
    // snapshot is fetched async and cached for stateMessage.
    setInterval(() => {
        if (clients.size === 0) return
        if (isCastSessionActive()) {
            dlnaState = null
            broadcastState()
            return
        }
        if (isDlnaSessionActive()) {
            void getDlnaStatusSnapshot().then((status) => {
                dlnaState = status ? dlnaStateFields(status) : null
                airplayState = null
                broadcastState()
            })
            return
        }
        if (isAirplaySessionActive()) {
            void getAirplayStatusSnapshot().then((status) => {
                airplayState = status ? airplayStateFields(status) : null
                dlnaState = null
                broadcastState()
            })
            return
        }
        if (dlnaState || airplayState) {
            dlnaState = null // session ended: clear the phone's cast UI
            airplayState = null
            broadcastState()
        }
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
    // 📱 "Enviar pro celular": empurra um canal pro app NeoStream Mobile
    // conectado neste servidor (o app dá play com a conta dele).
    // 📱 Manda um VOD/episódio pro app do celular pareado tocar.
    ipcMain.handle('web-remote:play-vod-on-mobile', (_e, data: { kind?: string; sid?: string; container?: string; name?: string }) => {
        const kind = data?.kind === 'series' ? 'series' : 'movie'
        const sid = String(data?.sid ?? '').trim()
        if (!sid) return { success: false, error: 'sid ausente' }
        const count = sendToMobileClients(JSON.stringify({
            type: 'playVodOnMobile',
            kind,
            sid,
            container: String(data?.container ?? 'mp4'),
            name: String(data?.name ?? ''),
        }))
        return { success: count > 0, count }
    })

    // 🔄 Item 11: amostra de progresso local do renderer → celulares pareados.
    ipcMain.on('web-remote:progress', (_e, raw: unknown) => {
        const report = parseProgressReport(raw)
        if (!report) return
        sendToMobileClients(JSON.stringify({ type: 'progressSync', ...report }))
    })

    // 🔔 Notificação cruzada: espelha um aviso do desktop nos celulares.
    ipcMain.handle('web-remote:notify-mobile', (_e, data: { title?: string; body?: string }) => {
        const title = String(data?.title ?? '').slice(0, 80)
        const body = String(data?.body ?? '').slice(0, 200)
        if (!title) return { success: false }
        const count = sendToMobileClients(JSON.stringify({ type: 'notifyMobile', title, body }))
        return { success: count > 0, count }
    })

    ipcMain.handle('web-remote:play-on-mobile', (_e, raw: unknown) => {
        const data = raw as { streamId?: unknown; name?: unknown } | null
        if (!data || data.streamId === undefined) return { success: false, delivered: 0 }
        const delivered = sendToMobileClients(JSON.stringify({
            type: 'playOnMobile',
            streamId: String(data.streamId),
            name: typeof data.name === 'string' ? data.name.slice(0, 120) : '',
        }))
        return { success: true, delivered }
    })

    ipcMain.on('web-remote:guide', (_e, raw: unknown) => {
        guideState = sanitizeGuide(raw)
        broadcast(guideMessage())
    })

    // On-demand EPG for a single channel: the renderer answers a requestEpg by
    // fetching that channel's now/next and pushing it here, relayed to phones.
    // 📊 Stats rápidas do renderer → página (hoje / 7 dias / streak).
    // ⏰ Lembretes do renderer pro celular (lista com cancelar remoto).
    // ⭐ Favoritos do renderer pro app do celular (sync por id do provedor).
    ipcMain.on('web-remote:favorites', (_e, raw: unknown) => {
        const payload = (raw ?? {}) as { items?: unknown }
        const items = Array.isArray(payload.items) ? payload.items.slice(0, 200) : []
        broadcast(JSON.stringify({ type: 'favorites', items }))
    })

    // 📟 Item 126: aparelhos conectados no controle web (painel nas Configurações).
    ipcMain.handle('web-remote:clients-list', () => ({
        success: true,
        clients: [...clients].map(c => ({
            id: c.id,
            ip: c.ip ?? '?',
            name: c.name ?? null,
            role: c.role ?? 'browser',
            connectedAt: c.connectedAt ?? 0,
        })),
    }))

    // 📟 Item 14 fase 2: desconectar um cliente pelo painel + histórico.
    ipcMain.handle('web-remote:disconnect-client', (_e, raw: unknown) => {
        const { id } = (raw ?? {}) as { id?: unknown }
        const target = [...clients].find(c => c.id === id)
        if (!target) return { success: false }
        target.socket.destroy()
        clients.delete(target)
        pushHistory({ name: target.name ?? null, ip: target.ip ?? '?', role: target.role ?? 'browser', at: Date.now(), event: 'disconnect' })
        log.info('[WebRemote] cliente desconectado pelo painel:', target.name ?? target.ip)
        return { success: true }
    })

    ipcMain.handle('web-remote:connection-history', () => ({
        success: true,
        history: (((store.get('connectionHistory') as ConnectionEvent[] | undefined) ?? []).slice().reverse().slice(0, 20)),
    }))

    ipcMain.on('web-remote:reminders', (_e, raw: unknown) => {
        const payload = (raw ?? {}) as { items?: unknown }
        const items = Array.isArray(payload.items) ? payload.items.slice(0, 40) : []
        broadcast(JSON.stringify({ type: 'reminders', items }))
    })

    ipcMain.on('web-remote:stats', (_e, raw: unknown) => {
        const payload = (raw ?? {}) as { todaySeconds?: unknown; weekSeconds?: unknown; streak?: unknown }
        broadcast(JSON.stringify({
            type: 'stats',
            todaySeconds: Number(payload.todaySeconds) || 0,
            weekSeconds: Number(payload.weekSeconds) || 0,
            streak: Number(payload.streak) || 0,
        }))
    })

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

    // Live channels matching the phone's global search (bridge-side filter).
    ipcMain.on('web-remote:live-results', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const rawItems = Array.isArray(obj.items) ? obj.items : []
        const items = rawItems.slice(0, 100).map((c) => {
            const it = (c ?? {}) as Record<string, unknown>
            return {
                id: String(it.id ?? ''),
                name: typeof it.name === 'string' ? it.name.slice(0, 160) : '',
                logo: typeof it.logo === 'string' ? it.logo.slice(0, 500) : '',
            }
        }).filter((c) => c.id && c.name)
        broadcast(JSON.stringify({ type: 'liveResults', items }))
    })

    // Result of a recording started from the phone's guide (REC button).
    ipcMain.on('web-remote:record-result', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const status = obj.status === 'ok' || obj.status === 'stopped' || obj.status === 'deleted' || obj.status === 'cancelled' ? obj.status : 'error'
        const name = typeof obj.name === 'string' ? obj.name.slice(0, 160) : ''
        const id = typeof obj.id === 'string' ? obj.id.slice(0, 60) : ''
        broadcast(JSON.stringify({ type: 'recordResult', status, name, id }))
    })

    // DVR snapshot for the phone: active recordings (guide 🔴 + Controle card,
    // with elapsed seconds) and the latest finished files.
    ipcMain.on('web-remote:recordings', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const rawItems = Array.isArray(obj.items) ? obj.items : []
        const items = rawItems.slice(0, 20).map((c) => {
            const it = (c ?? {}) as Record<string, unknown>
            return {
                id: String(it.id ?? '').slice(0, 60),
                channelName: typeof it.channelName === 'string' ? it.channelName.slice(0, 160) : '',
                seconds: typeof it.seconds === 'number' && Number.isFinite(it.seconds) ? Math.max(0, Math.floor(it.seconds)) : 0,
            }
        }).filter((c) => c.id && c.channelName)
        const rawFiles = Array.isArray(obj.files) ? obj.files : []
        const files = rawFiles.slice(0, 10).map((c) => {
            const it = (c ?? {}) as Record<string, unknown>
            return {
                name: typeof it.name === 'string' ? it.name.slice(0, 200) : '',
                sizeMb: typeof it.sizeMb === 'number' && Number.isFinite(it.sizeMb) ? Math.max(0, Math.round(it.sizeMb)) : 0,
            }
        }).filter((c) => c.name)
        // Future recordings scheduled from the EPG (this app or the phone's ⏺).
        const rawScheduled = Array.isArray(obj.scheduled) ? obj.scheduled : []
        const scheduled = rawScheduled.slice(0, 20).map((c) => {
            const it = (c ?? {}) as Record<string, unknown>
            return {
                id: String(it.id ?? '').slice(0, 80),
                title: typeof it.title === 'string' ? it.title.slice(0, 160) : '',
                channelName: typeof it.channelName === 'string' ? it.channelName.slice(0, 160) : '',
                startIso: typeof it.startIso === 'string' ? it.startIso.slice(0, 40) : '',
            }
        }).filter((c) => c.id && c.title)
        broadcast(JSON.stringify({ type: 'recordings', items, files, scheduled }))
    })

    // Result of scheduling the channel's NEXT program from the phone.
    ipcMain.on('web-remote:schedule-result', (_e, raw: unknown) => {
        const obj = (raw ?? {}) as Record<string, unknown>
        const status = obj.status === 'ok' ? 'ok' : 'error'
        const title = typeof obj.title === 'string' ? obj.title.slice(0, 200) : ''
        broadcast(JSON.stringify({ type: 'scheduleResult', status, title }))
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
        if (req.method === 'POST' && req.url && req.url.startsWith('/transfer?')) {
            // 📥 Item 12: recebe um download do celular pela LAN (inverso do
            // /recording abaixo). Mesmo anti brute-force por IP do /setup.
            const ip = req.socket.remoteAddress || 'unknown'
            const now = Date.now()
            if (isPinLockedOut(pinGate.get(ip), now)) {
                res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('Aguarde e tente de novo')
                return
            }
            const parsed = parseTransferQuery(req.url)
            if (!parsed) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('bad request')
                return
            }
            if (!sessionPin || parsed.pin !== sessionPin) {
                const entry = registerPinFailure(pinGate.get(ip), now)
                pinGate.set(ip, entry)
                if (entry.lockedUntil > now) log.warn(`[WebRemote] PIN do /transfer bloqueado por tentativas: ${ip}`)
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('PIN')
                return
            }
            pinGate.delete(ip)
            const dir = path.join(app.getPath('userData'), 'downloads', 'transfers')
            try { fs.mkdirSync(dir, { recursive: true }) } catch { /* já existe */ }
            const target = path.join(dir, parsed.name)
            const out = fs.createWriteStream(target)
            let failed = false
            const fail = (status: number, message: string) => {
                if (failed) return
                failed = true
                out.destroy()
                try { fs.unlinkSync(target) } catch { /* nunca chegou a existir */ }
                if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end(message)
            }
            req.on('error', () => fail(500, 'upload aborted'))
            out.on('error', () => fail(500, 'write failed'))
            out.on('finish', () => {
                if (failed) return
                let size = 0
                try { size = fs.statSync(target).size } catch { /* stat falhou; segue 0 */ }
                if (size === 0) {
                    fail(400, 'empty upload')
                    return
                }
                log.info(`[WebRemote] transfer recebido: ${parsed.name} (${size} bytes)`)
                const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
                win?.webContents.send('transfer:received', {
                    kind: parsed.kind,
                    title: parsed.title,
                    filePath: target,
                    size,
                })
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('ok')
            })
            req.pipe(out)
            return
        }
        if (req.url && req.url.startsWith('/recording?')) {
            // ⬇️ Item 122: transfere uma gravação pela LAN (autentica pelo PIN da sessão).
            const query = new URL(req.url, 'http://localhost').searchParams
            const pin = query.get('pin') ?? ''
            const name = path.basename(query.get('name') ?? '')
            if (!sessionPin || pin !== sessionPin) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('PIN')
                return
            }
            const file = path.join(recordingsDir(), name)
            if (!name || !fs.existsSync(file)) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('not found')
                return
            }
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': fs.statSync(file).size,
                'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
                'Cache-Control': 'no-store',
            })
            fs.createReadStream(file).pipe(res)
            return
        }
        if (req.url === '/health') {
            // 🩺 Health-check leve (sem dados sensíveis): monitoração/diagnóstico na LAN.
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
            res.end(JSON.stringify({ ok: true, app: 'neostream-remote', uptimeSeconds: Math.round(process.uptime()) }))
            return
        }
        if (req.url === '/' || req.url === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
            // PIN is NOT injected — the phone must enter the code shown on
            // the desktop settings screen (the page prompts + stores it).
            res.end(renderRemotePage(remoteLang, remoteAccent ?? undefined))
            return
        }
        // PWA assets: "Add to home screen" installs the remote as a real app.
        if (req.url === '/manifest.webmanifest') {
            res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'max-age=3600' })
            res.end(buildManifest(remoteLang))
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
        // 🔗 Hand-off: page that bounces into the neostream://setup deep link
        // so the phone imports the desktop accounts by scanning the QR.
        if (req.url && req.url.startsWith('/setup')) {
            // Mesmo anti brute-force do WebSocket: cooldown por IP no PIN.
            const ip = req.socket.remoteAddress || 'unknown'
            const now = Date.now()
            if (isPinLockedOut(pinGate.get(ip), now)) {
                res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('Aguarde e tente de novo')
                return
            }
            const pin = new URL(req.url, 'http://local').searchParams.get('pin') || ''
            if (pin !== sessionPin) {
                const entry = registerPinFailure(pinGate.get(ip), now)
                pinGate.set(ip, entry)
                if (entry.lockedUntil > now) log.warn(`[WebRemote] PIN do /setup bloqueado por tentativas: ${ip}`)
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('PIN')
                return
            }
            pinGate.delete(ip)
            const link = buildSetupDeepLink(exportPlaylistsForSetup(), getActivePlaylistIdPublic())
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
            res.end(renderSetupHandoffPage(link, remoteLang))
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
