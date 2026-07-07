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

export type DecodedFrame =
    | { type: 'text'; text: string }
    | { type: 'ping'; payload: Uint8Array }
    | { type: 'pong' }
    | { type: 'close' }

/**
 * Pull complete frames off an accumulating client buffer (client→server
 * frames are always masked). Returns the frames and the unconsumed remainder.
 * Throws on a malformed/oversized frame so the caller can drop the socket.
 */
export function decodeFrames(buffer: Uint8Array): { frames: DecodedFrame[]; rest: Uint8Array } {
    const frames: DecodedFrame[] = []
    let offset = 0

    while (buffer.length - offset >= 2) {
        const first = buffer[offset]
        const second = buffer[offset + 1]
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
        if (len > 1_000_000) throw new Error('frame grande demais')

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

        if (opcode === 0x8) frames.push({ type: 'close' })
        else if (opcode === 0x9) frames.push({ type: 'ping', payload })
        else if (opcode === 0xa) frames.push({ type: 'pong' })
        else if (opcode === 0x1) frames.push({ type: 'text', text: Buffer.from(payload).toString('utf-8') })
        // opcode 0x0 (continuation) and binary 0x2 unused by the remote.
    }

    return { frames, rest: buffer.subarray(offset) }
}

/** Where a cast goes. Absent = legacy behaviour (first Chromecast on the LAN). */
export type CastTargetType = 'chromecast' | 'dlna' | 'airplay'
export interface CastTarget { deviceId: string; deviceType: CastTargetType }

export type RemoteCommand =
    | { action: 'togglePlay' | 'stop' | 'next' | 'previous' | 'volumeUp' | 'volumeDown' | 'mute' | 'subtitle' }
    | { action: 'seek'; seconds: number }
    | { action: 'setVolume'; level: number }
    | { action: 'setAudioTrack'; trackId: number }
    | { action: 'playChannel'; channelId: string }
    | { action: 'requestEpg'; channelId: string }
    | { action: 'recordChannel'; channelId: string; channelName?: string }
    | { action: 'stopRecord'; id: string }
    | { action: 'deleteRecording'; name: string }
    | { action: 'scheduleNext'; channelId: string }
    | { action: 'requestCatalog'; query?: string }
    | { action: 'requestLiveSearch'; query?: string }
    | { action: 'requestContinue' }
    | { action: 'requestRecommended' }
    | { action: 'requestRecordings' }
    | { action: 'requestDevices' }
    | { action: 'castMovie'; movieId: string; target?: CastTarget }
    | { action: 'castMovieQueue'; movieIds: string[]; target?: CastTarget }
    | { action: 'requestSeries'; query?: string }
    | { action: 'requestSeriesInfo'; seriesId: string }
    | { action: 'castEpisode'; episodeId: string; target?: CastTarget }

const VALID_ACTIONS = new Set([
    'togglePlay', 'stop', 'next', 'previous', 'volumeUp', 'volumeDown', 'mute', 'subtitle', 'seek', 'setVolume', 'setAudioTrack', 'playChannel', 'requestEpg', 'recordChannel', 'stopRecord', 'deleteRecording', 'scheduleNext',
    'requestCatalog', 'requestLiveSearch', 'requestContinue', 'requestRecommended', 'requestRecordings', 'requestDevices', 'castMovie', 'castMovieQueue', 'requestSeries', 'requestSeriesInfo', 'castEpisode',
])

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
    if (action === 'playChannel' || action === 'requestEpg') {
        const channelId = (parsed as { channelId?: unknown }).channelId
        if (typeof channelId !== 'string' || !channelId) return null
        return { action, channelId }
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
    if (action === 'scheduleNext') {
        const channelId = (parsed as { channelId?: unknown }).channelId
        if (typeof channelId !== 'string' || !channelId) return null
        return { action: 'scheduleNext', channelId }
    }
    if (action === 'castMovie') {
        const movieId = (parsed as { movieId?: unknown }).movieId
        if (typeof movieId !== 'string' || !movieId) return null
        return { action, movieId, target: parseCastTarget(parsed) }
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
    return { action: action as 'togglePlay' | 'stop' | 'next' | 'previous' | 'volumeUp' | 'volumeDown' | 'mute' | 'subtitle' }
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
}

export const PIN_MAX_FAILS = 5
export const PIN_LOCK_MS = 30_000

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
): PinGateEntry {
    const fails = (entry?.fails ?? 0) + 1
    if (fails >= maxFails) return { fails: 0, lockedUntil: now + lockMs }
    return { fails, lockedUntil: 0 }
}
