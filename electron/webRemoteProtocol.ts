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

/** A single close frame (server→client, no code). */
export function encodeCloseFrame(): Uint8Array {
    return Uint8Array.from([0x88, 0x00])
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

export type RemoteCommand =
    | { action: 'togglePlay' | 'stop' | 'next' | 'previous' | 'volumeUp' | 'volumeDown' | 'mute' }
    | { action: 'seek'; seconds: number }
    | { action: 'playChannel'; channelId: string }
    | { action: 'requestEpg'; channelId: string }

const VALID_ACTIONS = new Set([
    'togglePlay', 'stop', 'next', 'previous', 'volumeUp', 'volumeDown', 'mute', 'seek', 'playChannel', 'requestEpg',
])

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
    if (action === 'playChannel' || action === 'requestEpg') {
        const channelId = (parsed as { channelId?: unknown }).channelId
        if (typeof channelId !== 'string' || !channelId) return null
        return { action, channelId }
    }
    return { action: action as 'togglePlay' | 'stop' | 'next' | 'previous' | 'volumeUp' | 'volumeDown' | 'mute' }
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
