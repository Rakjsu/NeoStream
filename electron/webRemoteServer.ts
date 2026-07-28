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
import {
    generateSelfSignedCert,
    shouldReuseStoredCert,
    mergeCertAltNames,
    type StoredSelfSignedCert,
} from './selfSignedCert'
import { recordingsDir } from './dvrHandlers'
import {
    buildHandshakeResponse,
    encodeTextFrame,
    encodePongFrame,
    encodePingFrame,
    encodeCloseFrame,
    decodeFrames,
    parseRemoteCommand,
    isPinLockedOut,
    registerPinFailure,
    pickLanAddress,
    canDeliverTo,
    isPeerStale,
    isLinkPing,
    LINK_PONG_MESSAGE,
    WS_CLOSE_PIN_ROTATED,
    WS_PING_INTERVAL_MS,
    type FrameAssembly,
    type PinGateEntry,
    type NetAddress,
    parseProgressReport,
    parseMobileHello,
    buildDesktopHello,
    parsePushAck,
    isOutdatedMobile,
    markMobileInHistory,
    MIN_MOBILE_APP_VERSION,
    type MobileHello,
    type PushAckStatus,
} from './webRemoteProtocol'
import { renderRemotePage, type RemoteAccent } from './webRemotePage'
import { buildSetupDeepLink, renderSetupHandoffPage } from './setupPayload'
import { parseTransferQuery, transferEntryId, transferSizeVerdict, uniqueTransferName } from './transferReceiver'
import { recordReceivedTransfer, transfersDir } from './transferHandlers'
import { resolveSessionPin } from './webRemotePin'
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
    /**
     * PIN do pareamento, persistido entre sessões. Regenerar a cada start
     * invalidava o código salvo no celular a cada restart do PC: o app
     * re-tentava o WS com o PIN velho a cada 15s, caía no lockout por IP e o
     * POST /transfer respondia 429 — que o celular mostrava como "falha de
     * rede". Revogar continua manual, pelo botão de gerar novo PIN.
     */
    pin: string
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
    /** Mensagem fragmentada em montagem entre chunks (FIN=0 → continuações). */
    pending: FrameAssembly | null
    /** Último byte recebido do cliente — base do keepalive (peer meio-morto). */
    lastSeenAt: number
    /** 📟 Item 14: id estável da sessão — alvo do "desconectar" do painel. */
    id: string
    /** 📟 Identificação pro painel de aparelhos conectados. */
    ip?: string
    connectedAt?: number
    /** 'mobile' quando o cliente é o app NeoStream Mobile (não a página do navegador). */
    role?: 'mobile'
    name?: string
    /** 0 = app sem hello versionado (APK ≤ v0.20.0): nada é negociado. */
    protocolVersion?: number
    appVersion?: string
    /** O que o app anunciou saber fazer — vazio no app legado. */
    capabilities?: Set<string>
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
    return { enabled: false, https: false, pin: '', ...(store.get('webRemote') as Partial<WebRemoteConfig> | undefined) }
}

/** Grava o PIN em uso (sem mexer no resto da config). */
function persistPin(pin: string): void {
    store.set('webRemote', { ...getConfig(), pin })
}

/** The LAN URL of the running server (http/https), or null when stopped. */
function serverUrl(): string | null {
    return serverPort ? `${serverSecure ? 'https' : 'http'}://${getLanAddress()}:${serverPort}/` : null
}

/** Best LAN IPv4 the phone can reach (skips VPN/virtual adapters), or 127.0.0.1. */
export function getLanAddress(): string {
    return pickLanAddress(os.networkInterfaces() as Record<string, NetAddress[] | undefined>)
}

// ------------------------------------------------- certificado do modo https --

/** Chave + cert do modo https, guardados entre sessões. */
const CERT_FILE = 'webremote-cert.json'
/** 10 anos: o objetivo é estabilidade (confiar uma vez), não rotação. */
const CERT_VALIDITY_DAYS = 3650

function certFilePath(): string {
    return path.join(app.getPath('userData'), CERT_FILE)
}

function readStoredCert(): Partial<StoredSelfSignedCert> | null {
    try {
        return JSON.parse(fs.readFileSync(certFilePath(), 'utf-8')) as Partial<StoredSelfSignedCert>
    } catch {
        return null // ausente, ilegível ou corrompido → gera um novo
    }
}

function writeStoredCert(value: StoredSelfSignedCert): void {
    try {
        // 0o600 porque o arquivo carrega a chave privada. No Linux/macOS isso
        // deixa o arquivo só para o dono; no Windows o modo só reflete o
        // atributo somente-leitura e quem protege é a ACL da pasta do usuário.
        fs.writeFileSync(certFilePath(), JSON.stringify(value), { mode: 0o600 })
        try { fs.chmodSync(certFilePath(), 0o600) } catch { /* sem suporte a modo */ }
    } catch (error) {
        log.warn('[WebRemote] não consegui gravar o certificado https:', error)
    }
}

/**
 * Par chave/cert do https, reaproveitado entre sessões.
 *
 * Regerar a cada start fazia o celular ver um certificado diferente toda vez:
 * confiar uma vez era impossível e o usuário aprendia a apertar "avançar mesmo
 * assim" em qualquer certificado — inclusive no de um impostor na mesma LAN.
 * Agora só regeramos quando não há nada gravado, quando o cert está perto de
 * vencer ou quando o SAN não cobre o endereço desta rede. Para forçar um par
 * novo à mão, basta apagar `webremote-cert.json` na pasta userData.
 */
function loadOrCreateCert(now: number): { key: string; cert: string } {
    const lanAddress = getLanAddress()
    const wanted = [lanAddress, '127.0.0.1', 'localhost']
    const stored = readStoredCert()

    if (stored && shouldReuseStoredCert(stored, now, wanted)) {
        return { key: stored.key as string, cert: stored.cert as string }
    }

    const altNames = mergeCertAltNames(stored?.altNames, wanted)
    const fresh = generateSelfSignedCert(now, {
        commonName: lanAddress,
        validityDays: CERT_VALIDITY_DAYS,
        altNames,
    })
    writeStoredCert({ key: fresh.key, cert: fresh.cert, altNames, notAfter: fresh.notAfter })
    log.info('[WebRemote] novo certificado https gerado para', altNames.join(', '))
    return { key: fresh.key, cert: fresh.cert }
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

/**
 * Envia um comando só pros clientes que são o APP mobile (não a página).
 * Só conta como entregue quem está vivo no TCP E deu sinal dentro da janela
 * do keepalive: escrever num socket meio-morto "funciona" por minutos, e era
 * esse número que virava {success:true} no "Enviar pro celular".
 */
function sendToMobileClients(text: string): number {
    const frame = encodeTextFrame(text)
    const now = Date.now()
    let delivered = 0
    for (const client of clients) {
        if (client.role !== 'mobile') continue
        if (!canDeliverTo({ destroyed: client.socket.destroyed, writable: client.socket.writable, lastSeenAt: client.lastSeenAt }, now)) continue
        try {
            client.socket.write(frame)
            delivered++
        } catch { /* dropped on next read */ }
    }
    return delivered
}

/**
 * Keepalive: pinga cada cliente e derruba quem passou da tolerância sem dar
 * um byte. Sem isto o Set guarda fantasmas role='mobile' pra sempre (o socket
 * só sai em 'close'/'error', que a metade-aberta nunca dispara).
 */
function heartbeatTick(): void {
    if (clients.size === 0) return
    const now = Date.now()
    const ping = encodePingFrame()
    for (const client of [...clients]) {
        if (isPeerStale(client.lastSeenAt, now)) {
            log.warn('[WebRemote] cliente sem resposta — derrubando:', client.name ?? client.ip ?? '?')
            client.socket.destroy()
            if (clients.delete(client)) {
                pushHistory({ name: client.name ?? null, ip: client.ip ?? '?', role: client.role ?? 'browser', at: now, event: 'disconnect' })
            }
            continue
        }
        try {
            client.socket.write(ping)
        } catch { /* cai no drop do socket */ }
    }
}

// 📡 Handshake: o app se identifica com versão + capacidades e o desktop
// responde com as dele. Sem esses campos o cliente é LEGADO — segue valendo o
// comportamento antigo (entrega sem confirmação, sync no escuro).
function applyMobileHello(client: ClientSocket, hello: MobileHello): void {
    // 🔐 O helloMobile é a ÚNICA coisa que separa "app" de "página": registra
    // quando um segundo cliente assume o papel (recebe progresso e os pushes).
    const other = [...clients].find(c => c !== client && c.role === 'mobile')
    if (other) {
        log.warn(`[WebRemote] segundo cliente assumiu o papel de celular: ${hello.name} (${client.ip}) — já havia ${other.name ?? '?'} (${other.ip})`)
    }
    client.role = 'mobile'
    client.name = hello.name
    client.protocolVersion = hello.protocolVersion
    client.appVersion = hello.appVersion
    client.capabilities = new Set(hello.capabilities)
    const history = (store.get('connectionHistory') as ConnectionEvent[] | undefined) ?? []
    store.set('connectionHistory', markMobileInHistory(history, client.ip ?? '?', hello.name))
    log.info(`[WebRemote] app mobile conectado: ${hello.name} (v${hello.appVersion || '?'}, protocolo v${hello.protocolVersion})`)
    if (isOutdatedMobile(hello.appVersion)) {
        log.warn(`[WebRemote] app do celular desatualizado (mínimo ${MIN_MOBILE_APP_VERSION}) — sem os gates de tranca/parental no push`)
    }
    try {
        client.socket.write(encodeTextFrame(buildDesktopHello(app.getVersion())))
    } catch { /* dropado na próxima leitura */ }
}

// ⏳ Pushes de reprodução aguardando o ACK do app (só quem anuncia 'pushAck').
// O timeout SEMPRE resolve — um app que não responde nunca trava o botão.
const PUSH_ACK_TIMEOUT_MS = 3000
const pendingPushes = new Map<string, (status: PushAckStatus) => void>()

type PushOutcome = PushAckStatus | 'delivered' | 'timeout' | 'none'

/**
 * Entrega um push pros celulares pareados. Com o peer anunciando 'pushAck',
 * resolve com o desfecho real (o app pode descartar por tranca/parental/canal
 * inexistente); sem isso, resolve na hora com o comportamento antigo.
 */
function pushToMobile(message: Record<string, unknown>): Promise<{ delivered: number; status: PushOutcome }> {
    const pushId = crypto.randomUUID().slice(0, 8)
    const waits = [...clients].some(c => c.role === 'mobile' && c.capabilities?.has('pushAck'))
    const delivered = sendToMobileClients(JSON.stringify({ ...message, pushId }))
    if (delivered === 0) return Promise.resolve({ delivered: 0, status: 'none' })
    if (!waits) return Promise.resolve({ delivered, status: 'delivered' })
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            pendingPushes.delete(pushId)
            resolve({ delivered, status: 'timeout' })
        }, PUSH_ACK_TIMEOUT_MS)
        pendingPushes.set(pushId, (status) => {
            clearTimeout(timer)
            pendingPushes.delete(pushId)
            resolve({ delivered, status })
        })
    })
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
    const client: ClientSocket = { socket, buffer: new Uint8Array(0), pending: null, lastSeenAt: Date.now(), id: crypto.randomUUID(), ip, connectedAt: Date.now() }
    clients.add(client)
    pushHistory({ name: null, ip: ip ?? '?', role: 'browser', at: Date.now(), event: 'connect' })
    // Send the current state + guide snapshot immediately.
    socket.write(encodeTextFrame(stateMessage()))
    if (guideState) socket.write(encodeTextFrame(guideMessage()))

    socket.on('data', (chunk: Buffer) => {
        client.lastSeenAt = Date.now() // qualquer byte (inclusive pong) prova vida
        const glued = new Uint8Array(client.buffer.length + chunk.length)
        glued.set(client.buffer, 0)
        glued.set(chunk, client.buffer.length)
        try {
            const { frames, rest, pending } = decodeFrames(glued, client.pending)
            client.buffer = rest
            client.pending = pending
            for (const frame of frames) {
                if (frame.type === 'close') {
                    socket.end()
                } else if (frame.type === 'ping') {
                    socket.write(encodePongFrame(frame.payload))
                } else if (frame.type === 'text') {
                    // Heartbeat do app: responde na hora, sem passar pelo
                    // roteamento de comandos (não é uma ação do controle).
                    if (isLinkPing(frame.text)) {
                        socket.write(encodeTextFrame(LINK_PONG_MESSAGE))
                        continue
                    }
                    // Hello do app mobile: marca o cliente como app — vira o
                    // alvo do "enviar pro celular" (a página do navegador não).
                    if (frame.text.includes('helloMobile')) {
                        const hello = parseMobileHello(frame.text)
                        if (hello) {
                            applyMobileHello(client, hello)
                            continue
                        }
                    }
                    // ✅ ACK de um push de reprodução: solta quem espera o desfecho.
                    if (frame.text.includes('pushResult')) {
                        const ack = parsePushAck(frame.text)
                        if (ack) {
                            pendingPushes.get(ack.pushId)?.(ack.status)
                            continue
                        }
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
const RENDERER_ONLY = new Set(['playChannel', 'requestEpg', 'recordChannel', 'stopRecord', 'deleteRecording', 'scheduleNext', 'cancelSchedule', 'requestRecordings', 'renameRecording', 'toggleProtectRecording', 'navKey', 'requestFavorites', 'reportProgress', 'requestProgress', 'requestCatalog', 'requestLiveSearch', 'requestContinue', 'requestRecommended', 'requestDevices', 'castMovie', 'castMovieQueue', 'requestSeries', 'requestSeriesInfo', 'castEpisode', 'sleep', 'requestStats', 'requestReminders', 'cancelReminder', 'partyAdd'])

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
    if (command.action === 'playChannel') {
        // 📱 O listener de playChannel só existe na TV ao vivo MONTADA (a
        // página zera a guia ao desmontar, então guideState sem canais = fora
        // dela). Antes o comando morria aí em silêncio, com o celular
        // afirmando sucesso: agora traz o app, navega e reenvia com atraso —
        // o mesmo caminho que o openMultiview já usava.
        const appWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
        if (!appWin) return
        if ((guideState?.channels.length ?? 0) > 0) {
            appWin.webContents.send('media:control', 'playChannel', command.channelId, command.name)
            return
        }
        if (appWin.isMinimized()) appWin.restore()
        appWin.show()
        appWin.focus()
        appWin.webContents.send('tray:navigate', '/dashboard/live')
        setTimeout(() => {
            if (!appWin.isDestroyed()) appWin.webContents.send('media:control', 'playChannel', command.channelId, command.name)
        }, 700)
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
    } else if (command.action === 'requestProgress') {
        // 🔄 Reconciliação: o celular reconectou e quer o estado daqui.
        win.webContents.send('media:control', 'requestProgress')
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

    // Keepalive do WebSocket (independente do cast): detecta peer meio-morto.
    setInterval(heartbeatTick, WS_PING_INTERVAL_MS)

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
    ipcMain.handle('web-remote:play-vod-on-mobile', async (_e, data: { kind?: string; sid?: string; container?: string; name?: string }) => {
        const kind = data?.kind === 'series' ? 'series' : 'movie'
        const sid = String(data?.sid ?? '').trim()
        if (!sid) return { success: false, error: 'sid ausente' }
        const { delivered, status } = await pushToMobile({
            type: 'playVodOnMobile',
            kind,
            sid,
            container: String(data?.container ?? 'mp4'),
            name: String(data?.name ?? ''),
        })
        // success só é verdade quando o app confirmou (ou é um app legado, que
        // nunca confirma): tranca/parental/conteúdo ausente viram falha honesta.
        return { success: status === 'played' || status === 'delivered', count: delivered, delivered, status }
    })

    // 🔄 Item 11: amostra de progresso local do renderer → celulares pareados.
    ipcMain.on('web-remote:progress', (_e, raw: unknown) => {
        const report = parseProgressReport(raw)
        if (!report) return
        sendToMobileClients(JSON.stringify({ type: 'progressSync', ...report }))
    })

    // 🔄 Reconciliação: resposta ao requestProgress — o que o PC assistiu
    // enquanto o celular estava fora. O celular resolve por updatedAt (LWW),
    // então basta mandar o estado; teto de 40 pra não estourar um frame.
    ipcMain.on('web-remote:progress-snapshot', (_e, raw: unknown) => {
        const payload = (raw ?? {}) as { items?: unknown }
        const items = (Array.isArray(payload.items) ? payload.items : [])
            .map(parseProgressReport)
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .slice(0, 40)
        if (items.length === 0) return
        sendToMobileClients(JSON.stringify({ type: 'progressSnapshot', items }))
    })

    // 🔔 Notificação cruzada: espelha um aviso do desktop nos celulares.
    ipcMain.handle('web-remote:notify-mobile', (_e, data: { title?: string; body?: string }) => {
        const title = String(data?.title ?? '').slice(0, 80)
        const body = String(data?.body ?? '').slice(0, 200)
        if (!title) return { success: false }
        const count = sendToMobileClients(JSON.stringify({ type: 'notifyMobile', title, body }))
        return { success: count > 0, count }
    })

    ipcMain.handle('web-remote:play-on-mobile', async (_e, raw: unknown) => {
        const data = raw as { streamId?: unknown; name?: unknown } | null
        if (!data || data.streamId === undefined) return { success: false, delivered: 0, status: 'none' }
        const { delivered, status } = await pushToMobile({
            type: 'playOnMobile',
            streamId: String(data.streamId),
            name: typeof data.name === 'string' ? data.name.slice(0, 120) : '',
        })
        return { success: status === 'played' || status === 'delivered', delivered, status }
    })

    ipcMain.on('web-remote:guide', (_e, raw: unknown) => {
        guideState = sanitizeGuide(raw)
        broadcast(guideMessage())
    })

    // 📱 Desfecho do playChannel: sem isto o pedido do celular sumia quando o
    // canal não existia nesta conta. Vai com o channelId pra cada cliente só
    // reagir ao que ELE pediu (o celular e a página mandam o mesmo comando).
    ipcMain.on('web-remote:play-channel-result', (_e, raw: unknown) => {
        const data = (raw ?? {}) as { status?: unknown; channelId?: unknown }
        const channelId = String(data.channelId ?? '')
        if (!channelId) return
        broadcast(JSON.stringify({
            type: 'playChannelResult',
            status: data.status === 'ok' ? 'ok' : 'notFound',
            channelId,
        }))
    })

    // On-demand EPG for a single channel: the renderer answers a requestEpg by
    // fetching that channel's now/next and pushing it here, relayed to phones.
    // 📊 Stats rápidas do renderer → página (hoje / 7 dias / streak).
    // ⏰ Lembretes do renderer pro celular (lista com cancelar remoto).
    // ⭐ Favoritos do renderer pro app do celular (sync por id do provedor).
    ipcMain.on('web-remote:favorites', (_e, raw: unknown) => {
        const payload = (raw ?? {}) as { items?: unknown }
        const items = Array.isArray(payload.items) ? payload.items.slice(0, 200) : []
        // Só pros apps: a página do navegador não consome 'favorites' e o
        // broadcast fazia qualquer aba pedindo favoritos reimportar a lista
        // inteira no celular (ressuscitando o que ele tinha apagado).
        sendToMobileClients(JSON.stringify({ type: 'favorites', items }))
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
            // 📱 App sem versão no hello (ou abaixo do mínimo) roda sem os
            // gates de tranca/parental: o painel avisa pra atualizar.
            appVersion: c.appVersion ?? '',
            outdated: c.role === 'mobile' && isOutdatedMobile(c.appVersion ?? ''),
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
        store.set('webRemote', { ...current, enabled, https: useHttps })
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
        persistPin(sessionPin)
        pinGate.clear()
        // Fecha com motivo antes de destruir: o app do celular não tem como
        // ver "PIN velho" num 1006 e reconectava a cada 15s com a credencial
        // morta, armando o anti brute-force contra o próprio dono do PC.
        // `end` (não `destroy`): destruir na hora descarta o frame no buffer.
        // Sem o listener de dados o cliente revogado não manda mais comando na
        // janela entre o close frame e o FIN de volta (o `destroy` cortava isso).
        const bye = Buffer.from(encodeCloseFrame(WS_CLOSE_PIN_ROTATED, 'pin-rotated'))
        for (const client of clients) {
            client.socket.removeAllListeners('data')
            try { client.socket.end(bye) } catch { client.socket.destroy() }
        }
        clients.clear()
        log.info('[WebRemote] PIN regenerado')
        return { success: true, pin: sessionPin }
    })

    if (getConfig().enabled) void start()
    log.info('[WebRemote] initialized')
}

// Uploads em andamento (caminho absoluto). Dois envios simultâneos do mesmo
// título entrelaçavam escritas no MESMO arquivo — cada um ganha o seu.
const inFlightTransfers = new Set<string>()

/** Bytes livres na partição do destino, ou null quando o SO não informa. */
function freeDiskBytes(dir: string): number | null {
    try {
        const stats = fs.statfsSync(dir)
        return stats.bavail * stats.bsize
    } catch {
        return null
    }
}

function start(): Promise<void> {
    if (server) return Promise.resolve()
    const resolved = resolveSessionPin(getConfig().pin, newPin)
    sessionPin = resolved.pin
    if (resolved.persist) persistPin(sessionPin)
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
            const dir = transfersDir()
            try { fs.mkdirSync(dir, { recursive: true }) } catch { /* já existe */ }
            // 🚦 Corpo era aceito sem teto nem checagem de espaço: dava pra
            // encher o disco do PC. Content-Length decide antes do pipe.
            const verdict = transferSizeVerdict(req.headers['content-length'], freeDiskBytes(dir))
            if (verdict !== 'ok') {
                const status = verdict === 'too-large' ? 413 : verdict === 'no-space' ? 507 : 400
                log.warn(`[WebRemote] /transfer recusado (${verdict}): ${parsed.name}`)
                res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end(verdict)
                return
            }
            // Nome único: o app monta o nome só do título, então reenvio ou
            // homônimo caíam no MESMO arquivo (createWriteStream trunca) e
            // apagar uma entrada deixava a outra sem mídia.
            const name = uniqueTransferName(parsed.name, candidate =>
                inFlightTransfers.has(path.join(dir, candidate)) || fs.existsSync(path.join(dir, candidate)))
            const target = path.join(dir, name)
            // Rede de segurança do saneamento: nada pode escapar da pasta.
            if (path.dirname(path.resolve(target)) !== path.resolve(dir)) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('bad request')
                return
            }
            inFlightTransfers.add(target)
            const expected = Number(req.headers['content-length'])
            const out = fs.createWriteStream(target)
            let failed = false
            const fail = (status: number, message: string) => {
                if (failed) return
                failed = true
                inFlightTransfers.delete(target)
                out.destroy()
                try { fs.unlinkSync(target) } catch { /* nunca chegou a existir */ }
                if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end(message)
            }
            req.on('error', () => fail(500, 'upload aborted'))
            // Conexão que morre sem 'error' nem 'finish' deixaria o nome
            // travado no Set até o próximo start do servidor.
            req.on('close', () => inFlightTransfers.delete(target))
            out.on('error', () => fail(500, 'write failed'))
            out.on('finish', () => {
                inFlightTransfers.delete(target)
                if (failed) return
                let size = 0
                try { size = fs.statSync(target).size } catch { /* stat falhou; segue 0 */ }
                if (size === 0) {
                    fail(400, 'empty upload')
                    return
                }
                // Conexão cortada no meio fechava o stream com um arquivo
                // truncado que virava download "concluído" na biblioteca.
                if (Number.isInteger(expected) && expected > 0 && size !== expected) {
                    fail(400, 'incomplete upload')
                    return
                }
                log.info(`[WebRemote] transfer recebido: ${name} (${size} bytes)`)
                const entry = {
                    id: transferEntryId(target),
                    kind: parsed.kind,
                    title: parsed.title,
                    seriesName: parsed.seriesName,
                    season: parsed.season,
                    episode: parsed.episode,
                    filePath: target,
                    size,
                    receivedAt: Date.now(),
                }
                // Manifest ANTES do 200: o send abaixo é fire-and-forget e some
                // se o renderer estiver recarregando — o arquivo virava órfão
                // com o celular reportando sucesso. O bridge reconcilia ao montar.
                recordReceivedTransfer(entry)
                const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
                win?.webContents.send('transfer:received', entry)
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
            // `version`/`features`: o app do celular usa pra dizer "atualize o
            // desktop" em vez de "falha de rede" quando falta um endpoint.
            res.end(JSON.stringify({
                ok: true,
                app: 'neostream-remote',
                uptimeSeconds: Math.round(process.uptime()),
                version: app.getVersion(),
                features: ['transfer', 'setup'],
            }))
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
            // Self-signed cert (hand-rolled X.509) PERSISTIDO entre sessões: o
            // celular aceita uma vez e volta a ver o mesmo certificado nas
            // próximas. A LAN IP vai no SAN para o navegador validar o host.
            const { key, cert } = loadOrCreateCert(Date.now())
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
