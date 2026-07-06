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
    queueLoadPayload,
    queueSkipPayload,
    queueJumpPayload,
    mediaCommandPayload,
    seekPayload,
    getMediaStatusPayload,
    getReceiverStatusPayload,
    setVolumePayload,
    extractMediaTimes,
    extractQueueItems,
    extractCurrentItemId,
    extractTransportId,
    extractRunningAppId,
    extractSessionId,
    extractMediaSessionId,
    CAST_MEDIA_APP_ID,
    type CastMessage,
    type QueueItemStatus,
} from './castProtocol'

const HEARTBEAT_MS = 5000
const LAUNCH_TIMEOUT_MS = 15000

export interface CastMediaInput {
    url: string
    title: string
    contentType: string
    live: boolean
    subtitleUrl?: string
    subtitleLanguage?: string
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
    private currentTime: number | null = null
    private duration: number | null = null
    private volumeLevel: number | null = null
    private queueItems: QueueItemStatus[] = []
    private currentItemId: number | null = null
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
            currentTime: this.currentTime,
            duration: this.duration,
            volume: this.volumeLevel,
            queue: this.queueItems,
            currentItemId: this.currentItemId,
        }
    }

    /** Jump the active queue to a specific itemId. */
    queueJump(itemId: number): void {
        if (this.transportId && this.mediaSessionId !== null) {
            this.send(this.transportId, NS_MEDIA, queueJumpPayload(this.requestId++, this.mediaSessionId, itemId))
        }
    }

    /** Prompt the device for a fresh MEDIA_STATUS (updates currentTime). */
    requestMediaStatus(): void {
        if (this.transportId) {
            this.send(this.transportId, NS_MEDIA, getMediaStatusPayload(this.requestId++, this.mediaSessionId))
        }
    }

    /** Receiver-level volume (0..1). */
    setVolume(level: number): void {
        this.send(CAST_RECEIVER_ID, NS_RECEIVER, setVolumePayload(this.requestId++, level))
        this.volumeLevel = Math.min(1, Math.max(0, level))
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
            const times = extractMediaTimes(payload)
            if (times) {
                if (times.currentTime !== null) this.currentTime = times.currentTime
                if (times.duration !== null) this.duration = times.duration
            }
            // Only overwrite the queue when the device actually reports one, so
            // a periodic status without `items` doesn't blank a live queue.
            const items = extractQueueItems(payload)
            if (items.length > 0) this.queueItems = items
            const currentItemId = extractCurrentItemId(payload)
            if (currentItemId !== null) this.currentItemId = currentItemId
        }
    }

    /** Connect, launch the media receiver and LOAD the given media. */
    async start(media: CastMediaInput): Promise<void> {
        await this.connectAndLaunch()
        this.send(this.transportId!, NS_CONNECTION, connectPayload())
        this.send(this.transportId!, NS_MEDIA, loadMediaPayload(this.requestId++, media))
        log.info('[Cast] LOAD enviado para', this.deviceName, '(', media.live ? 'LIVE' : 'BUFFERED', ')')
    }

    /** Connect, launch the receiver and QUEUE_LOAD a list of items. */
    async startQueue(items: CastMediaInput[], startIndex = 0): Promise<void> {
        await this.connectAndLaunch()
        this.send(this.transportId!, NS_CONNECTION, connectPayload())
        this.send(this.transportId!, NS_MEDIA, queueLoadPayload(
            this.requestId++,
            items.map(i => ({
                url: i.url, title: i.title, contentType: i.contentType,
                subtitleUrl: i.subtitleUrl, subtitleLanguage: i.subtitleLanguage,
            })),
            startIndex,
        ))
        log.info('[Cast] QUEUE_LOAD enviado para', this.deviceName, `(${items.length} itens)`)
    }

    /** TLS connect + data handler + virtual connection + heartbeat. */
    private async connectTransport(): Promise<void> {
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
    }

    /** Wait for a RECEIVER_STATUS that satisfies `accept`, capturing transportId. */
    private waitForReceiver(accept: (payload: unknown, transportId: string) => boolean, errorMsg: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { this.receiverStatusListeners.delete(onData); reject(new Error(errorMsg)) }, LAUNCH_TIMEOUT_MS)
            const onData = (message: CastMessage) => {
                let payload: unknown
                try { payload = JSON.parse(message.payloadUtf8) } catch { return }
                if ((payload as { type?: string }).type !== 'RECEIVER_STATUS') return
                const transportId = extractTransportId(payload)
                if (!transportId || !accept(payload, transportId)) return
                this.transportId = transportId
                this.sessionId = extractSessionId(payload)
                clearTimeout(timer)
                this.receiverStatusListeners.delete(onData)
                resolve()
            }
            this.receiverStatusListeners.add(onData)
        })
    }

    /** TLS connect + heartbeat + LAUNCH; resolves once transportId is known. */
    private async connectAndLaunch(): Promise<void> {
        await this.connectTransport()
        const launched = this.waitForReceiver(() => true, 'o dispositivo não abriu o receptor de mídia')
        this.send(CAST_RECEIVER_ID, NS_RECEIVER, launchPayload(this.requestId++))
        await launched
    }

    /**
     * Adopt a Default Media Receiver session already running on the device (no
     * LAUNCH) — used to resume control after the app restarts mid-cast. Only
     * adopts CC1AD845 so it never hijacks Netflix/YouTube (their own receivers).
     * Rejects if nothing castable is running.
     */
    async attach(): Promise<void> {
        await this.connectTransport()
        const attached = this.waitForReceiver(
            (payload) => extractRunningAppId(payload) === CAST_MEDIA_APP_ID,
            'nenhuma sessão de mídia ativa no dispositivo',
        )
        this.send(CAST_RECEIVER_ID, NS_RECEIVER, getReceiverStatusPayload(this.requestId++))
        await attached
        // Join the running app's virtual connection and pull its media status.
        this.send(this.transportId!, NS_CONNECTION, connectPayload())
        this.requestMediaStatus()
        log.info('[Cast] sessão retomada em', this.deviceName)
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

    queueSkip(direction: 'next' | 'prev'): void {
        if (this.transportId && this.mediaSessionId !== null) {
            this.send(this.transportId, NS_MEDIA, queueSkipPayload(this.requestId++, this.mediaSessionId, direction))
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
