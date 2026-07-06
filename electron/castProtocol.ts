/**
 * Google Cast (castv2) wire protocol — PURE helpers (no net/electron import).
 *
 * The protocol is protobuf `CastMessage` frames over TLS :8009, each prefixed
 * by a 4-byte big-endian length. The message schema is tiny and fixed, so the
 * protobuf encoding is hand-rolled here (varints + length-delimited fields)
 * instead of pulling a protobuf dependency — same spirit as the from-scratch
 * DLNA SOAP client:
 *
 *   message CastMessage {
 *     required ProtocolVersion protocol_version = 1;  // 0 = CASTV2_1_0
 *     required string source_id      = 2;
 *     required string destination_id = 3;
 *     required string namespace      = 4;
 *     required PayloadType payload_type = 5;          // 0 = STRING
 *     optional string payload_utf8   = 6;
 *   }
 *
 * Payloads are JSON strings on well-known namespaces.
 */

export const CAST_PORT = 8009
export const CAST_SOURCE_ID = 'sender-neostream'
export const CAST_RECEIVER_ID = 'receiver-0'
/** Google's Default Media Receiver app. */
export const CAST_MEDIA_APP_ID = 'CC1AD845'

export const NS_CONNECTION = 'urn:x-cast:com.google.cast.tp.connection'
export const NS_HEARTBEAT = 'urn:x-cast:com.google.cast.tp.heartbeat'
export const NS_RECEIVER = 'urn:x-cast:com.google.cast.receiver'
export const NS_MEDIA = 'urn:x-cast:com.google.cast.media'

export interface CastMessage {
    sourceId: string
    destinationId: string
    namespace: string
    payloadUtf8: string
}

// ---------------------------------------------------------------- protobuf --

function encodeVarint(value: number): number[] {
    const bytes: number[] = []
    let v = value >>> 0
    do {
        let byte = v & 0x7f
        v >>>= 7
        if (v > 0) byte |= 0x80
        bytes.push(byte)
    } while (v > 0)
    return bytes
}

function encodeStringField(fieldNumber: number, text: string): number[] {
    const utf8 = Array.from(new TextEncoder().encode(text))
    return [(fieldNumber << 3) | 2, ...encodeVarint(utf8.length), ...utf8]
}

/** Serialize a CastMessage (STRING payload, protocol v0) without the frame. */
export function encodeCastMessage(message: CastMessage): Uint8Array {
    const bytes = [
        (1 << 3) | 0, 0, // protocol_version = CASTV2_1_0
        ...encodeStringField(2, message.sourceId),
        ...encodeStringField(3, message.destinationId),
        ...encodeStringField(4, message.namespace),
        (5 << 3) | 0, 0, // payload_type = STRING
        ...encodeStringField(6, message.payloadUtf8),
    ]
    return Uint8Array.from(bytes)
}

/** Add the 4-byte big-endian length prefix. */
export function frameCastMessage(message: CastMessage): Uint8Array {
    const body = encodeCastMessage(message)
    const framed = new Uint8Array(4 + body.length)
    new DataView(framed.buffer).setUint32(0, body.length, false)
    framed.set(body, 4)
    return framed
}

function decodeVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
    let value = 0
    let shift = 0
    let index = offset
    for (;;) {
        const byte = bytes[index]
        if (byte === undefined) throw new Error('varint truncado')
        value |= (byte & 0x7f) << shift
        index++
        if ((byte & 0x80) === 0) break
        shift += 7
        if (shift > 35) throw new Error('varint longo demais')
    }
    return { value: value >>> 0, next: index }
}

/** Parse one unframed CastMessage body (unknown fields are skipped). */
export function decodeCastMessage(body: Uint8Array): CastMessage {
    const message: CastMessage = { sourceId: '', destinationId: '', namespace: '', payloadUtf8: '' }
    const decoder = new TextDecoder()
    let offset = 0
    while (offset < body.length) {
        const tag = decodeVarint(body, offset)
        const fieldNumber = tag.value >>> 3
        const wireType = tag.value & 0x7
        offset = tag.next

        if (wireType === 0) {
            offset = decodeVarint(body, offset).next
            continue
        }
        if (wireType === 2) {
            const len = decodeVarint(body, offset)
            const start = len.next
            const end = start + len.value
            if (end > body.length) throw new Error('campo truncado')
            const text = decoder.decode(body.subarray(start, end))
            if (fieldNumber === 2) message.sourceId = text
            else if (fieldNumber === 3) message.destinationId = text
            else if (fieldNumber === 4) message.namespace = text
            else if (fieldNumber === 6) message.payloadUtf8 = text
            offset = end
            continue
        }
        throw new Error(`wire type inesperado: ${wireType}`)
    }
    return message
}

/**
 * Pull complete frames off an accumulating socket buffer. Returns the parsed
 * messages and the unconsumed remainder (partial frame bytes).
 */
export function extractFrames(buffer: Uint8Array): { messages: CastMessage[]; rest: Uint8Array } {
    const messages: CastMessage[] = []
    let offset = 0
    while (buffer.length - offset >= 4) {
        const length = new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, false)
        if (length > 1024 * 1024) throw new Error('frame castv2 grande demais')
        if (buffer.length - offset - 4 < length) break
        messages.push(decodeCastMessage(buffer.subarray(offset + 4, offset + 4 + length)))
        offset += 4 + length
    }
    return { messages, rest: buffer.subarray(offset) }
}

// ---------------------------------------------------------------- payloads --

export function connectPayload(): string {
    return JSON.stringify({ type: 'CONNECT' })
}

export function pingPayload(): string {
    return JSON.stringify({ type: 'PING' })
}

export function pongPayload(): string {
    return JSON.stringify({ type: 'PONG' })
}

export function launchPayload(requestId: number, appId: string = CAST_MEDIA_APP_ID): string {
    return JSON.stringify({ type: 'LAUNCH', requestId, appId })
}

export function stopAppPayload(requestId: number, sessionId: string): string {
    return JSON.stringify({ type: 'STOP', requestId, sessionId })
}

export function loadMediaPayload(
    requestId: number,
    media: { url: string; title: string; contentType: string; live: boolean; subtitleUrl?: string; subtitleLanguage?: string },
): string {
    // Optional WebVTT side-load: one TEXT track, active from the start. The
    // URL must be reachable by the device (the DLNA proxy serves it on LAN).
    const tracks = media.subtitleUrl
        ? [{
            trackId: 1,
            type: 'TEXT',
            subtype: 'SUBTITLES',
            trackContentId: media.subtitleUrl,
            trackContentType: 'text/vtt',
            language: media.subtitleLanguage || 'pt',
            name: 'Legenda',
        }]
        : undefined
    return JSON.stringify({
        type: 'LOAD',
        requestId,
        autoplay: true,
        ...(tracks ? { activeTrackIds: [1] } : {}),
        media: {
            contentId: media.url,
            contentType: media.contentType,
            streamType: media.live ? 'LIVE' : 'BUFFERED',
            metadata: { metadataType: 0, title: media.title },
            ...(tracks ? { tracks, textTrackStyle: { backgroundColor: '#00000000', edgeType: 'OUTLINE', edgeColor: '#000000FF' } } : {}),
        },
    })
}

export interface QueueItemInput {
    url: string
    title: string
    contentType: string
    /** Optional WebVTT side-load, reachable by the device (served on LAN). */
    subtitleUrl?: string
    subtitleLanguage?: string
}

/**
 * QUEUE_LOAD — play a list of items in sequence on the receiver. `startIndex`
 * is the item to begin with; the rest auto-advance. Items with a subtitleUrl
 * carry one active WebVTT TEXT track (same shape as the single LOAD).
 */
export function queueLoadPayload(requestId: number, items: QueueItemInput[], startIndex = 0): string {
    return JSON.stringify({
        type: 'QUEUE_LOAD',
        requestId,
        startIndex,
        repeatMode: 'REPEAT_OFF',
        items: items.map(item => {
            const tracks = item.subtitleUrl
                ? [{
                    trackId: 1,
                    type: 'TEXT',
                    subtype: 'SUBTITLES',
                    trackContentId: item.subtitleUrl,
                    trackContentType: 'text/vtt',
                    language: item.subtitleLanguage || 'pt',
                    name: 'Legenda',
                }]
                : undefined
            return {
                autoplay: true,
                preloadTime: 8,
                ...(tracks ? { activeTrackIds: [1] } : {}),
                media: {
                    contentId: item.url,
                    contentType: item.contentType,
                    streamType: 'BUFFERED',
                    metadata: { metadataType: 0, title: item.title },
                    ...(tracks ? { tracks, textTrackStyle: { backgroundColor: '#00000000', edgeType: 'OUTLINE', edgeColor: '#000000FF' } } : {}),
                },
            }
        }),
    })
}

/** QUEUE_NEXT / QUEUE_PREV skip within an active queue. */
export function queueSkipPayload(requestId: number, mediaSessionId: number, direction: 'next' | 'prev'): string {
    return JSON.stringify({
        type: direction === 'next' ? 'QUEUE_NEXT' : 'QUEUE_PREV',
        requestId,
        mediaSessionId,
    })
}

/** receiver GET_STATUS (prompts a RECEIVER_STATUS listing running apps). */
export function getReceiverStatusPayload(requestId: number): string {
    return JSON.stringify({ type: 'GET_STATUS', requestId })
}

/** media GET_STATUS (prompts a fresh MEDIA_STATUS with currentTime). */
export function getMediaStatusPayload(requestId: number, mediaSessionId?: number | null): string {
    return JSON.stringify({
        type: 'GET_STATUS',
        requestId,
        ...(typeof mediaSessionId === 'number' ? { mediaSessionId } : {}),
    })
}

/** Receiver-level volume (0..1). */
export function setVolumePayload(requestId: number, level: number): string {
    return JSON.stringify({
        type: 'SET_VOLUME',
        requestId,
        volume: { level: Math.min(1, Math.max(0, level)) },
    })
}

/** currentTime/duration out of a MEDIA_STATUS, or null when absent. */
export function extractMediaTimes(mediaStatusJson: unknown): { currentTime: number | null; duration: number | null } | null {
    if (mediaStatusJson === null || typeof mediaStatusJson !== 'object') return null
    const status = (mediaStatusJson as { status?: unknown }).status
    if (!Array.isArray(status) || status.length === 0) return null
    const entry = status[0]
    if (entry === null || typeof entry !== 'object') return null
    const e = entry as Record<string, unknown>
    const currentTime = typeof e.currentTime === 'number' ? e.currentTime : null
    const mediaInfo = e.media
    const duration = mediaInfo !== null && typeof mediaInfo === 'object' && typeof (mediaInfo as { duration?: unknown }).duration === 'number'
        ? (mediaInfo as { duration: number }).duration
        : null
    return { currentTime, duration }
}

export function mediaCommandPayload(
    requestId: number,
    type: 'PLAY' | 'PAUSE' | 'STOP',
    mediaSessionId: number,
): string {
    return JSON.stringify({ type, requestId, mediaSessionId })
}

/** Jump the queue straight to a given itemId (QUEUE_UPDATE with currentItemId). */
export function queueJumpPayload(requestId: number, mediaSessionId: number, itemId: number): string {
    return JSON.stringify({ type: 'QUEUE_UPDATE', requestId, mediaSessionId, currentItemId: itemId })
}

export interface QueueItemStatus {
    itemId: number
    title: string
}

/** The queue items (itemId + title) out of a MEDIA_STATUS, or [] when none. */
export function extractQueueItems(mediaStatusJson: unknown): QueueItemStatus[] {
    if (mediaStatusJson === null || typeof mediaStatusJson !== 'object') return []
    const status = (mediaStatusJson as { status?: unknown }).status
    if (!Array.isArray(status) || status.length === 0) return []
    const items = (status[0] as { items?: unknown }).items
    if (!Array.isArray(items)) return []
    const out: QueueItemStatus[] = []
    for (const item of items) {
        if (item === null || typeof item !== 'object') continue
        const itemId = (item as { itemId?: unknown }).itemId
        if (typeof itemId !== 'number') continue
        const media = (item as { media?: { metadata?: { title?: unknown } } }).media
        const title = typeof media?.metadata?.title === 'string' ? media.metadata.title : ''
        out.push({ itemId, title })
    }
    return out
}

/** The itemId currently playing in the queue, or null. */
export function extractCurrentItemId(mediaStatusJson: unknown): number | null {
    if (mediaStatusJson === null || typeof mediaStatusJson !== 'object') return null
    const status = (mediaStatusJson as { status?: unknown }).status
    if (!Array.isArray(status) || status.length === 0) return null
    const id = (status[0] as { currentItemId?: unknown }).currentItemId
    return typeof id === 'number' ? id : null
}

export function seekPayload(requestId: number, mediaSessionId: number, currentTime: number): string {
    return JSON.stringify({ type: 'SEEK', requestId, mediaSessionId, currentTime })
}

/** transportId of the running media-receiver app in a RECEIVER_STATUS, or null. */
export function extractTransportId(receiverStatusJson: unknown): string | null {
    if (receiverStatusJson === null || typeof receiverStatusJson !== 'object') return null
    const status = (receiverStatusJson as { status?: { applications?: unknown } }).status
    const apps = status?.applications
    if (!Array.isArray(apps)) return null
    for (const app of apps) {
        if (app === null || typeof app !== 'object') continue
        const a = app as Record<string, unknown>
        if (typeof a.transportId === 'string' && a.transportId) return a.transportId
    }
    return null
}

/** appId of the running app in a RECEIVER_STATUS, or null (nothing running). */
export function extractRunningAppId(receiverStatusJson: unknown): string | null {
    if (receiverStatusJson === null || typeof receiverStatusJson !== 'object') return null
    const status = (receiverStatusJson as { status?: { applications?: unknown } }).status
    const apps = status?.applications
    if (!Array.isArray(apps)) return null
    for (const app of apps) {
        if (app === null || typeof app !== 'object') continue
        const id = (app as { appId?: unknown }).appId
        if (typeof id === 'string' && id) return id
    }
    return null
}

/** sessionId of the running app (needed to STOP it), or null. */
export function extractSessionId(receiverStatusJson: unknown): string | null {
    if (receiverStatusJson === null || typeof receiverStatusJson !== 'object') return null
    const status = (receiverStatusJson as { status?: { applications?: unknown } }).status
    const apps = status?.applications
    if (!Array.isArray(apps)) return null
    for (const app of apps) {
        if (app === null || typeof app !== 'object') continue
        const a = app as Record<string, unknown>
        if (typeof a.sessionId === 'string' && a.sessionId) return a.sessionId
    }
    return null
}

/** mediaSessionId out of a MEDIA_STATUS payload, or null. */
export function extractMediaSessionId(mediaStatusJson: unknown): number | null {
    if (mediaStatusJson === null || typeof mediaStatusJson !== 'object') return null
    const status = (mediaStatusJson as { status?: unknown }).status
    if (!Array.isArray(status)) return null
    for (const entry of status) {
        if (entry === null || typeof entry !== 'object') continue
        const id = (entry as { mediaSessionId?: unknown }).mediaSessionId
        if (typeof id === 'number') return id
    }
    return null
}
