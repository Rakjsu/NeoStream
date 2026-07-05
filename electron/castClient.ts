/**
 * Google Cast client (main process): one TLS connection per cast session.
 *
 * Flow: TLS :8009 (self-signed cert → rejectUnauthorized:false, same trust
 * model every cast sender uses) → CONNECT to receiver-0 → LAUNCH the Default
 * Media Receiver → CONNECT to the app's transportId → LOAD the media URL.
 * Heartbeat PINGs every 5s keep the session alive; PLAY/PAUSE/STOP/SEEK ride
 * the media namespace with the mediaSessionId from MEDIA_STATUS.
 */

import tls from 'node:tls'
import log from './logger'
import {
    CAST_PORT,
    CAST_SOURCE_ID,
    CAST_RECEIVER_ID,
    NS_CONNECTION,
    NS_HEARTBEAT,
    NS_RECEIVER,
    NS_MEDIA,
    frameCastMessage,
    extractFrames,
    connectPayload,
    pingPayload,
    pongPayload,
    launchPayload,
    stopAppPayload,
    loadMediaPayload,
    mediaCommandPayload,
    seekPayload,
    extractTransportId,
    extractSessionId,
    extractMediaSessionId,
    type CastMessage,
} from './castProtocol'

const HEARTBEAT_MS = 5000
const LAUNCH_TIMEOUT_MS = 15000

export interface CastMediaInput {
    url: string
    title: string
    contentType: string
    live: boolean
}

export class CastSession {
    private socket: tls.TLSSocket | null = null
    private buffer: Uint8Array = new Uint8Array(0)
    private requestId = 1
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null
    private transportId: string | null = null
    private sessionId: string | null = null
    private mediaSessionId: number | null = null
    private lastMediaState: string | null = null
    private closed = false

    constructor(
        readonly host: string,
        readonly deviceName: string,
    ) {}

    get isActive(): boolean {
        return this.socket !== null && !this.closed
    }

    get status() {
        return {
            deviceName: this.deviceName,
            playing: this.lastMediaState === 'PLAYING' || this.lastMediaState === 'BUFFERING',
            mediaState: this.lastMediaState,
        }
    }

    private send(destinationId: string, namespace: string, payloadUtf8: string): void {
        if (!this.socket || this.closed) return
        const message: CastMessage = { sourceId: CAST_SOURCE_ID, destinationId, namespace, payloadUtf8 }
        this.socket.write(frameCastMessage(message))
    }

    private handleMessage(message: CastMessage): void {
        let payload: Record<string, unknown>
        try {
            payload = JSON.parse(message.payloadUtf8) as Record<string, unknown>
        } catch {
            return
        }
        if (message.namespace === NS_HEARTBEAT && payload.type === 'PING') {
            this.send(message.sourceId, NS_HEARTBEAT, pongPayload())
            return
        }
        if (message.namespace === NS_RECEIVER) {
            this.notifyReceiverStatus(message)
            return
        }
        if (message.namespace === NS_MEDIA && payload.type === 'MEDIA_STATUS') {
            const id = extractMediaSessionId(payload)
            if (id !== null) this.mediaSessionId = id
            const statusList = payload.status
            if (Array.isArray(statusList) && statusList[0] && typeof statusList[0] === 'object') {
                const state = (statusList[0] as { playerState?: unknown }).playerState
                if (typeof state === 'string') this.lastMediaState = state
            }
        }
    }

    /** Connect, launch the media receiver and LOAD the given media. */
    async start(media: CastMediaInput): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const socket = tls.connect(
                { host: this.host, port: CAST_PORT, rejectUnauthorized: false },
                () => resolve(),
            )
            socket.setTimeout(10000, () => socket.destroy(new Error('timeout de conexão')))
            socket.on('error', reject)
            this.socket = socket
        })
        const socket = this.socket!
        socket.setTimeout(0)

        socket.on('data', (chunk: Buffer) => {
            const glued = new Uint8Array(this.buffer.length + chunk.length)
            glued.set(this.buffer, 0)
            glued.set(chunk, this.buffer.length)
            try {
                const { messages, rest } = extractFrames(glued)
                this.buffer = rest
                for (const message of messages) this.handleMessage(message)
            } catch (error) {
                log.warn('[Cast] frame inválido, encerrando sessão:', error)
                this.close()
            }
        })
        socket.on('close', () => {
            this.closed = true
            if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
        })
        socket.on('error', (error) => {
            log.warn('[Cast] socket error:', error.message)
        })

        // Virtual connection + keep-alive.
        this.send(CAST_RECEIVER_ID, NS_CONNECTION, connectPayload())
        this.heartbeatTimer = setInterval(() => {
            this.send(CAST_RECEIVER_ID, NS_HEARTBEAT, pingPayload())
        }, HEARTBEAT_MS)

        // Launch the Default Media Receiver and wait for its transportId.
        const launched = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('o dispositivo não abriu o receptor de mídia')), LAUNCH_TIMEOUT_MS)
            const onData = (message: CastMessage) => {
                let payload: unknown
                try {
                    payload = JSON.parse(message.payloadUtf8)
                } catch {
                    return
                }
                if ((payload as { type?: string }).type !== 'RECEIVER_STATUS') return
                const transportId = extractTransportId(payload)
                if (!transportId) return
                this.transportId = transportId
                this.sessionId = extractSessionId(payload)
                clearTimeout(timer)
                this.receiverStatusListeners.delete(onData)
                resolve()
            }
            this.receiverStatusListeners.add(onData)
        })
        this.send(CAST_RECEIVER_ID, NS_RECEIVER, launchPayload(this.requestId++))
        await launched

        // Connect to the app and load the media.
        this.send(this.transportId!, NS_CONNECTION, connectPayload())
        this.send(this.transportId!, NS_MEDIA, loadMediaPayload(this.requestId++, media))
        log.info('[Cast] LOAD enviado para', this.deviceName, '(', media.live ? 'LIVE' : 'BUFFERED', ')')
    }

    // RECEIVER_STATUS fan-out (start() waits on it; handleMessage feeds it).
    private receiverStatusListeners = new Set<(message: CastMessage) => void>()

    private notifyReceiverStatus(message: CastMessage): void {
        for (const listener of [...this.receiverStatusListeners]) listener(message)
    }

    pause(): void {
        if (this.transportId && this.mediaSessionId !== null) {
            this.send(this.transportId, NS_MEDIA, mediaCommandPayload(this.requestId++, 'PAUSE', this.mediaSessionId))
        }
    }

    resume(): void {
        if (this.transportId && this.mediaSessionId !== null) {
            this.send(this.transportId, NS_MEDIA, mediaCommandPayload(this.requestId++, 'PLAY', this.mediaSessionId))
        }
    }

    seek(seconds: number): void {
        if (this.transportId && this.mediaSessionId !== null) {
            this.send(this.transportId, NS_MEDIA, seekPayload(this.requestId++, this.mediaSessionId, seconds))
        }
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        try {
            if (this.sessionId) {
                this.send(CAST_RECEIVER_ID, NS_RECEIVER, stopAppPayload(this.requestId++, this.sessionId))
            }
        } catch { /* best-effort */ }
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
        this.socket?.end()
        this.socket = null
    }
}
