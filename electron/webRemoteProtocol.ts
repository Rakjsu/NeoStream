/**
 * Minimal WebSocket (RFC 6455) wire helpers — PURE, no net import, so the
 * handshake key and frame codec are unit-testable. Same from-scratch spirit
 * as the DLNA SOAP and Cast castv2 clients: no `ws` dependency.
 *
 * Only what the phone remote needs: server-side accept-key, text frames
 * (server→client unmasked, client→server masked), close, ping/pong.
 */

import crypto from 'node:crypto'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** Sec-WebSocket-Accept for a given client Sec-WebSocket-Key. */
export function computeAcceptKey(secWebSocketKey: string): string {
    return crypto.createHash('sha1').update(secWebSocketKey + WS_GUID).digest('base64')
}

/** The 101 Switching Protocols response headers (as a raw string). */
export function buildHandshakeResponse(secWebSocketKey: string): string {
    return [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${computeAcceptKey(secWebSocketKey)}`,
        '\r\n',
    ].join('\r\n')
}

/** Encode a UTF-8 text frame (server→client: no mask). */
export function encodeTextFrame(text: string): Uint8Array {
    const payload = Buffer.from(text, 'utf-8')
    const len = payload.length
    let header: Buffer
    if (len < 126) {
        header = Buffer.from([0x81, len])
    } else if (len < 65536) {
        header = Buffer.alloc(4)
        header[0] = 0x81
        header[1] = 126
        header.writeUInt16BE(len, 2)
    } else {
        header = Buffer.alloc(10)
        header[0] = 0x81
        header[1] = 127
        header.writeUInt32BE(0, 2)
        header.writeUInt32BE(len, 6)
    }
    return Buffer.concat([header, payload])
}

/** Pong in response to a client ping (echoes the payload). */
export function encodePongFrame(payload: Uint8Array): Uint8Array {
    const len = payload.length & 0x7f
    return Uint8Array.from([0x8a, len, ...payload])
}

/** Ping originado pelo servidor (o keepalive; o cliente responde pong). */
export function encodePingFrame(): Uint8Array {
    return Uint8Array.from([0x89, 0])
}

/**
 * Close com código (RFC 6455 §5.5.1). Usado pra avisar o motivo do
 * fechamento: sem ele o app do celular só vê 1006 e não sabe se caiu a rede
 * ou se o pareamento foi revogado — e reconecta pra sempre com o PIN velho.
 */
export function encodeCloseFrame(code: number, reason = ''): Uint8Array {
    const body = Buffer.from(reason, 'utf-8').subarray(0, 123)
    const payload = Buffer.alloc(2 + body.length)
    payload.writeUInt16BE(code, 0)
    body.copy(payload, 2)
    return Uint8Array.from([0x88, payload.length, ...payload])
}

/** Código privado (4000-4999): "o PIN foi regenerado, pareie de novo". */
export const WS_CLOSE_PIN_ROTATED = 4001

export type DecodedFrame =
    | { type: 'text'; text: string }
    | { type: 'ping'; payload: Uint8Array }
    | { type: 'pong' }
    | { type: 'close' }

/** Mensagem fragmentada em montagem (FIN=0 → continuações até o FIN=1). */
export interface FrameAssembly {
    opcode: number
    chunks: Uint8Array[]
    size: number
}

const MAX_FRAME_BYTES = 1_000_000

/**
 * Pull complete frames off an accumulating client buffer (client→server
 * frames are always masked). Returns the frames and the unconsumed remainder.
 * Throws on a malformed/oversized frame so the caller can drop the socket.
 *
 * O bit FIN importa: OkHttp (o WebSocket do React Native) e proxies da LAN
 * podem partir uma mensagem em vários frames. Tratar o 1º pedaço como
 * mensagem inteira gerava JSON truncado descartado em silêncio — daí o
 * `pending`, que atravessa as chamadas até o frame com FIN=1 fechar o texto.
 * O UTF-8 só é decodificado no payload REMONTADO: um caractere multibyte pode
 * ficar partido entre dois fragmentos.
 */
export function decodeFrames(
    buffer: Uint8Array,
    pending: FrameAssembly | null = null,
): { frames: DecodedFrame[]; rest: Uint8Array; pending: FrameAssembly | null } {
    const frames: DecodedFrame[] = []
    let offset = 0
    let assembly = pending

    while (buffer.length - offset >= 2) {
        const first = buffer[offset]
        const second = buffer[offset + 1]
        const fin = (first & 0x80) !== 0
        const opcode = first & 0x0f
        const masked = (second & 0x80) !== 0
        let len = second & 0x7f
        let cursor = offset + 2

        if (len === 126) {
            if (buffer.length - cursor < 2) break
            len = (buffer[cursor] << 8) | buffer[cursor + 1]
            cursor += 2
        } else if (len === 127) {
            if (buffer.length - cursor < 8) break
            // Only support payloads that fit in 32 bits (remote commands are tiny).
            const high = (buffer[cursor] << 24) | (buffer[cursor + 1] << 16) | (buffer[cursor + 2] << 8) | buffer[cursor + 3]
            if (high !== 0) throw new Error('frame grande demais')
            len = (buffer[cursor + 4] << 24) | (buffer[cursor + 5] << 16) | (buffer[cursor + 6] << 8) | buffer[cursor + 7]
            cursor += 8
        }
        if (len > MAX_FRAME_BYTES) throw new Error('frame grande demais')

        const maskLen = masked ? 4 : 0
        if (buffer.length - cursor < maskLen + len) break // incomplete
        const mask = masked ? buffer.subarray(cursor, cursor + 4) : null
        cursor += maskLen

        const payload = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
            payload[i] = mask ? buffer[cursor + i] ^ mask[i & 3] : buffer[cursor + i]
        }
        cursor += len
        offset = cursor

        // Frames de controle nunca são fragmentados e podem chegar NO MEIO de
        // uma mensagem em pedaços — não encostam na montagem em curso.
        if (opcode === 0x8) { frames.push({ type: 'close' }); continue }
        if (opcode === 0x9) { frames.push({ type: 'ping', payload }); continue }
        if (opcode === 0xa) { frames.push({ type: 'pong' }); continue }

        if (opcode === 0x0) {
            if (!assembly) throw new Error('continuação sem frame inicial')
            const size = assembly.size + payload.length
            if (size > MAX_FRAME_BYTES) throw new Error('frame grande demais')
            const chunks = [...assembly.chunks, payload]
            if (!fin) {
                assembly = { opcode: assembly.opcode, chunks, size }
                continue
            }
            const isText = assembly.opcode === 0x1
            assembly = null
            if (isText) frames.push({ type: 'text', text: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf-8') })
            continue
        }

        // Frame de dados (0x1 texto / 0x2 binário).
        if (assembly) throw new Error('frame novo no meio de uma mensagem fragmentada')
        if (!fin) {
            assembly = { opcode, chunks: [payload], size: payload.length }
            continue
        }
        if (opcode === 0x1) frames.push({ type: 'text', text: Buffer.from(payload).toString('utf-8') })
        // Binário (0x2) não é usado pelo controle remoto.
    }

    return { frames, rest: buffer.subarray(offset), pending: assembly }
}

// ---------------------------------------------------------------- liveness --
// Um TCP meio-morto (celular trocou de Wi-Fi sem FIN, PC hibernou) aceita
// `write` por minutos sem entregar nada. Sem keepalive o desktop conta esse
// write como entrega e responde {success:true} pro "Enviar pro celular".
// O servidor origina ping e derruba quem não dá sinal de vida na tolerância.

/** Intervalo entre pings originados pelo servidor. */
export const WS_PING_INTERVAL_MS = 20_000
/** Sem NENHUM byte do cliente por este tempo, o socket é considerado morto. */
export const WS_PEER_TIMEOUT_MS = 50_000

/** Cliente calado além da tolerância (≈2 pings perdidos + folga). */
export function isPeerStale(lastSeenAt: number, now: number, timeoutMs: number = WS_PEER_TIMEOUT_MS): boolean {
    return now - lastSeenAt > timeoutMs
}

/** Vale contar como entregue? Socket vivo no TCP E respondendo na janela. */
export function canDeliverTo(
    client: { destroyed?: boolean; writable?: boolean; lastSeenAt: number },
    now: number,
    timeoutMs: number = WS_PEER_TIMEOUT_MS,
): boolean {
    if (client.destroyed === true || client.writable === false) return false
    return !isPeerStale(client.lastSeenAt, now, timeoutMs)
}

/**
 * Heartbeat do app mobile. O WebSocket do React Native não expõe ping/pong
 * ao JS, então o app não enxerga o ping do servidor — precisa de um ping em
 * nível de aplicação pra saber que o PC ainda está do outro lado.
 */
export const LINK_PONG_MESSAGE = '{"type":"pong"}'

export function isLinkPing(text: string): boolean {
    if (!text.includes('"ping"')) return false
    try {
        return (JSON.parse(text) as { action?: unknown } | null)?.action === 'ping'
    } catch {
        return false
    }
}

/** Where a cast goes. Absent = legacy behaviour (first Chromecast on the LAN). */
export type CastTargetType = 'chromecast' | 'dlna' | 'airplay'
export interface CastTarget { deviceId: string; deviceType: CastTargetType }

export type RemoteCommand =
    | { action: 'togglePlay' | 'stop' | 'next' | 'previous' | 'volumeUp' | 'volumeDown' | 'mute' | 'subtitle' }
    | { action: 'seek'; seconds: number }
    | { action: 'setVolume'; level: number }
    | { action: 'setAudioTrack'; trackId: number }
    | { action: 'playChannel'; channelId: string; name?: string }
    | { action: 'requestEpg'; channelId: string }
    | { action: 'recordChannel'; channelId: string; channelName?: string }
    | { action: 'stopRecord'; id: string }
    | { action: 'deleteRecording'; name: string }
    | { action: 'scheduleNext'; channelId: string }
    | { action: 'cancelSchedule'; id: string }
    | { action: 'requestCatalog'; query?: string }
    | { action: 'requestLiveSearch'; query?: string }
    | { action: 'requestContinue' }
    | { action: 'requestRecommended' }
    | { action: 'requestRecordings' }
    | { action: 'requestDevices' }
    | { action: 'castMovie'; movieId: string; target?: CastTarget }
    | { action: 'partyAdd'; movieId: string }
    | { action: 'castMovieQueue'; movieIds: string[]; target?: CastTarget }
    | { action: 'requestSeries'; query?: string }
    | { action: 'requestSeriesInfo'; seriesId: string }
    | { action: 'castEpisode'; episodeId: string; target?: CastTarget }
    | { action: 'sleep'; minutes: number }
    | { action: 'requestStats' }
    | { action: 'focusApp' }
    | { action: 'requestReminders' }
    | { action: 'cancelReminder'; id: string }
    | { action: 'openMultiview' }
    | { action: 'screenshot' }
    | { action: 'renameRecording'; name: string; newName: string }
    | { action: 'toggleProtectRecording'; name: string }
    | { action: 'navKey'; key: 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' }
    | { action: 'requestFavorites' }
    | { action: 'reportProgress'; report: ProgressReport }
    | { action: 'requestProgress' }

const VALID_ACTIONS = new Set([
    'togglePlay', 'stop', 'next', 'previous', 'volumeUp', 'volumeDown', 'mute', 'subtitle', 'seek', 'setVolume', 'setAudioTrack', 'playChannel', 'requestEpg', 'recordChannel', 'stopRecord', 'deleteRecording', 'scheduleNext', 'cancelSchedule',
    'requestCatalog', 'requestLiveSearch', 'requestContinue', 'requestRecommended', 'requestRecordings', 'requestDevices', 'castMovie', 'castMovieQueue', 'requestSeries', 'requestSeriesInfo', 'castEpisode',
    'sleep', 'requestStats', 'focusApp', 'requestReminders', 'cancelReminder', 'openMultiview', 'screenshot', 'renameRecording', 'toggleProtectRecording', 'navKey', 'requestFavorites', 'reportProgress',
    'partyAdd', 'requestProgress',
])

/**
 * 🔄 Item 11: amostra de progresso trocada entre PC e celular.
 * Filme casa por stream_id (mesma conta nos 2 lados); episódio casa por
 * nome da série + SxxEyy (o celular não conhece o seriesId do desktop).
 */
export interface ProgressReport {
    kind: 'movie' | 'episode'
    /** stream_id do filme (só kind movie). */
    movieId?: string
    /** Filme: título; episódio: nome da série. */
    title: string
    season?: number
    episode?: number
    positionSec: number
    durationSec: number
    updatedAt: number
    /** Etiqueta do perfil de ORIGEM; sem ela o progresso vaza entre perfis. */
    profile?: string
}

/** Valida uma amostra vinda do fio (entrada do celular, não confiável). PURO. */
export function parseProgressReport(raw: unknown): ProgressReport | null {
    if (raw === null || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const kind = r.kind
    if (kind !== 'movie' && kind !== 'episode') return null
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 200) : ''
    if (!title) return null
    const positionSec = r.positionSec
    const durationSec = r.durationSec
    const updatedAt = r.updatedAt
    if (typeof positionSec !== 'number' || !Number.isFinite(positionSec) || positionSec < 0) return null
    if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) return null
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return null
    const profile = typeof r.profile === 'string' ? r.profile.trim().slice(0, 60) : ''
    if (kind === 'movie') {
        const movieId = typeof r.movieId === 'string' ? r.movieId.trim().slice(0, 60) : ''
        if (!movieId) return null
        return { kind, movieId, title, positionSec, durationSec, updatedAt, profile }
    }
    const season = r.season
    const episode = r.episode
    if (typeof season !== 'number' || !Number.isInteger(season) || season < 0) return null
    if (typeof episode !== 'number' || !Number.isInteger(episode) || episode < 0) return null
    return { kind, title, season, episode, positionSec, durationSec, updatedAt, profile }
}

const CAST_TARGET_TYPES = new Set<CastTargetType>(['chromecast', 'dlna', 'airplay'])

/** Extract an optional {deviceId, deviceType} target; ignores anything malformed. */
function parseCastTarget(parsed: unknown): CastTarget | undefined {
    const deviceId = (parsed as { deviceId?: unknown }).deviceId
    const deviceType = (parsed as { deviceType?: unknown }).deviceType
    if (typeof deviceId !== 'string' || !deviceId) return undefined
    if (typeof deviceType !== 'string' || !CAST_TARGET_TYPES.has(deviceType as CastTargetType)) return undefined
    return { deviceId, deviceType: deviceType as CastTargetType }
}

/** Optional search term for catalog/series (trimmed, capped); undefined if absent/empty. */
function parseQuery(parsed: unknown): string | undefined {
    const q = (parsed as { query?: unknown }).query
    if (typeof q !== 'string') return undefined
    const trimmed = q.trim().slice(0, 100)
    return trimmed || undefined
}

/** Validate a command coming off the wire (untrusted phone input). */
export function parseRemoteCommand(text: string): RemoteCommand | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return null
    }
    if (parsed === null || typeof parsed !== 'object') return null
    const action = (parsed as { action?: unknown }).action
    if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) return null
    if (action === 'reportProgress') {
        const report = parseProgressReport((parsed as { report?: unknown }).report)
        return report ? { action: 'reportProgress', report } : null
    }
    if (action === 'seek') {
        const seconds = (parsed as { seconds?: unknown }).seconds
        if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
        return { action: 'seek', seconds }
    }
    if (action === 'setVolume') {
        const level = (parsed as { level?: unknown }).level
        if (typeof level !== 'number' || !Number.isFinite(level)) return null
        return { action: 'setVolume', level: Math.min(1, Math.max(0, level)) }
    }
    if (action === 'setAudioTrack') {
        const trackId = (parsed as { trackId?: unknown }).trackId
        if (typeof trackId !== 'number' || !Number.isFinite(trackId)) return null
        return { action: 'setAudioTrack', trackId }
    }
    if (action === 'sleep') {
        const minutes = (parsed as { minutes?: unknown }).minutes
        if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return null
        return { action: 'sleep', minutes: Math.min(480, Math.floor(minutes)) }
    }
    if (action === 'playChannel' || action === 'requestEpg') {
        const channelId = (parsed as { channelId?: unknown }).channelId
        if (typeof channelId !== 'string' || !channelId) return null
        if (action === 'requestEpg') return { action, channelId }
        // Nome é o resgate quando as contas dos dois lados são diferentes: o
        // stream_id do celular não existe aqui e só o nome casa (é o mesmo
        // fallback que o playOnMobile já dá na direção contrária).
        const rawName = (parsed as { name?: unknown }).name
        const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 160) : undefined
        return { action, channelId, name }
    }
    if (action === 'recordChannel') {
        const channelId = (parsed as { channelId?: unknown }).channelId
        if (typeof channelId !== 'string' || !channelId) return null
        const rawName = (parsed as { channelName?: unknown }).channelName
        const channelName = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 160) : undefined
        return { action: 'recordChannel', channelId, channelName }
    }
    if (action === 'stopRecord') {
        const id = (parsed as { id?: unknown }).id
        if (typeof id !== 'string' || !id) return null
        return { action: 'stopRecord', id: id.slice(0, 60) }
    }
    if (action === 'deleteRecording') {
        const name = (parsed as { name?: unknown }).name
        if (typeof name !== 'string' || !name.trim()) return null
        return { action: 'deleteRecording', name: name.trim().slice(0, 200) }
    }
    if (action === 'renameRecording') {
        const name = (parsed as { name?: unknown }).name
        const newName = (parsed as { newName?: unknown }).newName
        if (typeof name !== 'string' || !name.trim() || typeof newName !== 'string' || !newName.trim()) return null
        return { action: 'renameRecording', name: name.trim().slice(0, 200), newName: newName.trim().slice(0, 80) }
    }
    if (action === 'toggleProtectRecording') {
        const name = (parsed as { name?: unknown }).name
        if (typeof name !== 'string' || !name.trim()) return null
        return { action: 'toggleProtectRecording', name: name.trim().slice(0, 200) }
    }
    if (action === 'navKey') {
        const key = (parsed as { key?: unknown }).key
        if (key !== 'up' && key !== 'down' && key !== 'left' && key !== 'right' && key !== 'ok' && key !== 'back') return null
        return { action: 'navKey', key }
    }
    if (action === 'scheduleNext') {
        const channelId = (parsed as { channelId?: unknown }).channelId
        if (typeof channelId !== 'string' || !channelId) return null
        return { action: 'scheduleNext', channelId }
    }
    if (action === 'cancelSchedule') {
        const id = (parsed as { id?: unknown }).id
        if (typeof id !== 'string' || !id.trim()) return null
        return { action: 'cancelSchedule', id: id.trim().slice(0, 80) }
    }
    if (action === 'cancelReminder') {
        const id = (parsed as { id?: unknown }).id
        if (typeof id !== 'string' || !id.trim()) return null
        return { action: 'cancelReminder', id: id.trim().slice(0, 80) }
    }
    if (action === 'castMovie') {
        const movieId = (parsed as { movieId?: unknown }).movieId
        if (typeof movieId !== 'string' || !movieId) return null
        return { action, movieId, target: parseCastTarget(parsed) }
    }
    // 🎉 Item 40: modo festa — qualquer celular adiciona um filme à fila da TV.
    if (action === 'partyAdd') {
        const movieId = (parsed as { movieId?: unknown }).movieId
        if (typeof movieId !== 'string' || !movieId) return null
        return { action, movieId }
    }
    if (action === 'castMovieQueue') {
        const raw = (parsed as { movieIds?: unknown }).movieIds
        if (!Array.isArray(raw)) return null
        const movieIds = raw.filter((id): id is string => typeof id === 'string' && !!id).slice(0, 200)
        if (movieIds.length === 0) return null
        return { action: 'castMovieQueue', movieIds, target: parseCastTarget(parsed) }
    }
    if (action === 'requestSeriesInfo') {
        const seriesId = (parsed as { seriesId?: unknown }).seriesId
        if (typeof seriesId !== 'string' || !seriesId) return null
        return { action, seriesId }
    }
    if (action === 'castEpisode') {
        const episodeId = (parsed as { episodeId?: unknown }).episodeId
        if (typeof episodeId !== 'string' || !episodeId) return null
        return { action, episodeId, target: parseCastTarget(parsed) }
    }
    if (action === 'requestCatalog') return { action: 'requestCatalog', query: parseQuery(parsed) }
    if (action === 'requestLiveSearch') return { action: 'requestLiveSearch', query: parseQuery(parsed) }
    if (action === 'requestSeries') return { action: 'requestSeries', query: parseQuery(parsed) }
    if (action === 'requestContinue') return { action: 'requestContinue' }
    if (action === 'requestRecommended') return { action: 'requestRecommended' }
    if (action === 'requestRecordings') return { action: 'requestRecordings' }
    if (action === 'requestDevices') return { action: 'requestDevices' }
    if (action === 'requestStats') return { action: 'requestStats' }
    // 🔄 Reconciliação: o celular pede o estado de progresso ao reconectar.
    if (action === 'requestProgress') return { action: 'requestProgress' }
    if (action === 'focusApp') return { action: 'focusApp' }
    return { action: action as 'togglePlay' | 'stop' | 'next' | 'previous' | 'volumeUp' | 'volumeDown' | 'mute' | 'subtitle' }
}

// ------------------------------------------------------ handshake versionado --
// Até a v4.44 o hello do app era só {action:'helloMobile', name}: o desktop não
// tinha como distinguir um APK com os gates de tranca/parental (v0.20.0+) de um
// sem eles, e empurrava conteúdo igual. Agora os dois lados anunciam versão e
// capacidades. A AUSÊNCIA dos campos significa "peer legado" — nunca "recusar":
// contra um app/desktop antigo tudo continua funcionando como antes.

/** Versão do contrato desktop↔app. 0 = peer sem hello versionado (legado). */
export const REMOTE_PROTOCOL_VERSION = 1

/** O que ESTE desktop sabe fazer — o app usa pra não pedir sync no vazio. */
export const DESKTOP_CAPABILITIES = [
    'favoritesSync', 'remindersSync', 'progressSync', 'vodPush', 'notifyPush', 'pushAck',
] as const

/** Primeiro APK com os gates de tranca/parental no push (Rodada 2). */
export const MIN_MOBILE_APP_VERSION = '0.20.0'

export interface MobileHello {
    name: string
    protocolVersion: number
    /** '' quando o app não manda a versão (APK ≤ v0.20.0). */
    appVersion: string
    capabilities: string[]
}

/** Hello do app (entrada do fio, não confiável). PURO. */
export function parseMobileHello(text: string): MobileHello | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return null
    }
    if (parsed === null || typeof parsed !== 'object') return null
    const hello = parsed as Record<string, unknown>
    if (hello.action !== 'helloMobile') return null
    const version = hello.protocolVersion
    const rawCaps = Array.isArray(hello.capabilities) ? hello.capabilities : []
    return {
        name: typeof hello.name === 'string' ? hello.name.slice(0, 40) : 'celular',
        protocolVersion: typeof version === 'number' && Number.isFinite(version) && version > 0 ? Math.floor(version) : 0,
        appVersion: typeof hello.appVersion === 'string' ? hello.appVersion.trim().slice(0, 20) : '',
        capabilities: rawCaps
            .filter((cap): cap is string => typeof cap === 'string' && !!cap)
            .slice(0, 32)
            .map(cap => cap.slice(0, 32)),
    }
}

/** Resposta ao hello: versão + capacidades deste desktop (app legado ignora). */
export function buildDesktopHello(appVersion: string): string {
    return JSON.stringify({
        type: 'helloDesktop',
        protocolVersion: REMOTE_PROTOCOL_VERSION,
        appVersion,
        capabilities: [...DESKTOP_CAPABILITIES],
    })
}

/** Compara versões "x.y.z" numericamente (4.9.1 < 4.44.0). PURO. */
export function compareAppVersions(a: string, b: string): number {
    const parts = (value: string) => value.split('.').map(part => Number.parseInt(part, 10) || 0)
    const left = parts(a)
    const right = parts(b)
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] ?? 0) - (right[i] ?? 0)
        if (diff !== 0) return diff > 0 ? 1 : -1
    }
    return 0
}

/** APK sem versão no hello ou abaixo do mínimo com os gates de tranca/parental. */
export function isOutdatedMobile(appVersion: string): boolean {
    if (!appVersion) return true
    return compareAppVersions(appVersion, MIN_MOBILE_APP_VERSION) < 0
}

/**
 * O papel real do cliente só chega no helloMobile — DEPOIS de o connect já ter
 * entrado no histórico como 'browser'. Corrige a última entrada daquele IP pra
 * que um cliente que se diz app não fique indistinguível de um navegador. PURO.
 */
export function markMobileInHistory<T extends { ip: string; role: string; event: string; name: string | null }>(
    history: T[],
    ip: string,
    name: string,
): T[] {
    for (let i = history.length - 1; i >= 0; i--) {
        const entry = history[i]
        if (entry.event !== 'connect' || entry.ip !== ip || entry.role === 'mobile') continue
        const out = history.slice()
        out[i] = { ...entry, role: 'mobile', name }
        return out
    }
    return history
}

/** Desfecho de um push de reprodução, reportado pelo app. */
export type PushAckStatus = 'played' | 'locked' | 'blocked' | 'notFound'

const PUSH_ACK_STATUSES = new Set<string>(['played', 'locked', 'blocked', 'notFound'])

export interface PushAck {
    pushId: string
    status: PushAckStatus
}

/** ACK do app a um playOnMobile/playVodOnMobile (entrada do fio). PURO. */
export function parsePushAck(text: string): PushAck | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return null
    }
    if (parsed === null || typeof parsed !== 'object') return null
    const ack = parsed as Record<string, unknown>
    if (ack.action !== 'pushResult') return null
    const pushId = typeof ack.pushId === 'string' ? ack.pushId.trim().slice(0, 40) : ''
    const status = ack.status
    if (!pushId || typeof status !== 'string' || !PUSH_ACK_STATUSES.has(status)) return null
    return { pushId, status: status as PushAckStatus }
}

// ------------------------------------------------------------- LAN address --
// A machine often has several non-internal IPv4s: the real Wi-Fi/Ethernet plus
// VPN/virtual adapters (Radmin, ZeroTier, Hyper-V's vEthernet, WSL, VMware…).
// The phone can only reach the REAL LAN one, so picking the first (as before)
// broke pairing whenever a VPN adapter sorted first. Score by name + range.

export interface NetAddress {
    family: string | number
    address: string
    internal: boolean
}

const VIRTUAL_NAME = /vpn|virtual|vethernet|hyper-?v|zerotier|radmin|vmware|virtualbox|tailscale|\bwsl\b|loopback|\btap\b|\btun\b|hamachi|docker|bluetooth|npcap/i

/** Score one candidate: real Wi-Fi/Ethernet on a private range ranks highest. */
export function scoreLanCandidate(name: string, address: string): number {
    let score = 0
    if (VIRTUAL_NAME.test(name)) score -= 100
    if (/^192\.168\./.test(address)) score += 30
    else if (/^10\./.test(address)) score += 20
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 10
    if (/^169\.254\./.test(address)) score -= 50 // link-local (unconfigured)
    return score
}

/** Best LAN IPv4 the phone can actually reach, or 127.0.0.1. */
export function pickLanAddress(interfaces: Record<string, NetAddress[] | undefined>): string {
    let best: string | null = null
    let bestScore = -Infinity
    for (const [name, addresses] of Object.entries(interfaces)) {
        for (const addr of addresses ?? []) {
            if ((addr.family !== 'IPv4' && addr.family !== 4) || addr.internal) continue
            const score = scoreLanCandidate(name, addr.address)
            if (score > bestScore) { bestScore = score; best = addr.address }
        }
    }
    return best ?? '127.0.0.1'
}

// -------------------------------------------------------------- PIN lockout --
// A 4-digit PIN has only 10k combinations — trivially brute-forceable over the
// LAN without a limit. These PURE helpers track failures per client and lock a
// client out for a cooldown after too many misses. State lives in the caller
// (a Map keyed by IP); the helpers just compute the next entry / gate.

export interface PinGateEntry {
    fails: number
    lockedUntil: number
    /** Quando a última falha entrou — base do decaimento por tempo. */
    lastFailAt?: number
}

export const PIN_MAX_FAILS = 5
export const PIN_LOCK_MS = 30_000

/**
 * Teto GLOBAL, somando todos os clientes. O cooldown por IP sozinho é
 * multiplicável: quem tem várias origens (aliases de IPv4/IPv6, um /64 inteiro
 * de IPv6, ou só reconectar de outra máquina) ganha 5 tentativas por endereço.
 * Com 10 mil combinações possíveis, isso é a diferença entre horas e minutos.
 */
export const PIN_GLOBAL_MAX_FAILS = 30
export const PIN_GLOBAL_LOCK_MS = 60_000
/**
 * O contador global DECAI. Sem isso ele só acumula: um aparelho com PIN velho
 * reconectando a cada 15s soma falhas pra sempre e acaba trancando o DONO —
 * justamente quando ele acabou de gerar um PIN novo e tenta parear.
 */
export const PIN_GLOBAL_DECAY_MS = 10 * 60_000

/**
 * `::ffff:192.168.0.5` e `192.168.0.5` são o MESMO cliente — contá-los
 * separado dobra a cota de tentativas de graça.
 */
export function pinGateKey(ip: string | undefined): string {
    const raw = (ip ?? '').trim().toLowerCase()
    if (!raw) return 'unknown'
    return raw.startsWith('::ffff:') ? raw.slice(7) : raw
}

/**
 * Comparação de PIN em tempo constante. `!==` sai no primeiro dígito diferente;
 * na LAN, com milhares de amostras, essa diferença é mensurável.
 */
export function pinMatches(candidate: string, expected: string): boolean {
    if (!expected) return false
    // O XOR percorre o comprimento do esperado SEMPRE, mesmo com tamanhos
    // diferentes, pra não vazar o tamanho do segredo.
    let diff = candidate.length ^ expected.length
    for (let i = 0; i < expected.length; i++) {
        diff |= candidate.charCodeAt(i % (candidate.length || 1)) ^ expected.charCodeAt(i)
    }
    return diff === 0
}

/** True while the client is inside its cooldown window. */
export function isPinLockedOut(entry: PinGateEntry | undefined, now: number): boolean {
    return !!entry && entry.lockedUntil > now
}

/**
 * Next entry after a wrong PIN. Reaching PIN_MAX_FAILS arms the cooldown and
 * resets the counter; otherwise the failure count just grows.
 */
export function registerPinFailure(
    entry: PinGateEntry | undefined,
    now: number,
    maxFails: number = PIN_MAX_FAILS,
    lockMs: number = PIN_LOCK_MS,
    decayMs = 0,
): PinGateEntry {
    // Falha velha o bastante não conta mais: quem erra uma vez por hora não
    // deve chegar no teto por acúmulo eterno.
    const vivo = decayMs > 0 && entry?.lastFailAt !== undefined && now - entry.lastFailAt > decayMs
        ? undefined
        : entry
    const fails = (vivo?.fails ?? 0) + 1
    if (fails >= maxFails) return { fails: 0, lockedUntil: now + lockMs, lastFailAt: now }
    return { fails, lockedUntil: 0, lastFailAt: now }
}
