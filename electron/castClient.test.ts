import { describe, it, expect, vi } from 'vitest'

// electron-log puxa 'electron' — fora de questão num unit test.
vi.mock('./logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { CastSession, type CastMediaMeta } from './castClient'
import { extractFrames, NS_MEDIA, type CastMessage } from './castProtocol'

/**
 * Grey-box harness: a CastSession with a fake socket injected in place of the
 * TLS connection. MEDIA_STATUS messages are fed straight into handleMessage
 * (the same path the socket data handler uses), and outgoing frames are
 * captured so payloads can be decoded and asserted.
 */
function fakeSession() {
    const session = new CastSession('192.168.0.10', 'TV Teste')
    const written: Uint8Array[] = []
    const s = session as unknown as {
        socket: { write: (b: Uint8Array) => boolean; end: () => void } | null
        transportId: string | null
        mediaSessionId: number | null
        queueMetas: (CastMediaMeta | null)[]
        queueSubtitles: boolean[]
        mediaHasSubtitle: boolean
        intentionalClose: boolean
        handleMessage: (message: CastMessage) => void
    }
    s.socket = { write: (b: Uint8Array) => { written.push(b); return true }, end: () => undefined }
    s.transportId = 'transport-1'
    s.mediaSessionId = 7

    const feed = (statusEntry: Record<string, unknown>) => {
        s.handleMessage({
            sourceId: 'transport-1',
            destinationId: 'sender-neostream',
            namespace: NS_MEDIA,
            payloadUtf8: JSON.stringify({ type: 'MEDIA_STATUS', status: [statusEntry] }),
        })
    }
    /** Decode everything the session sent so far (framed castv2 messages). */
    const sentPayloads = () => {
        const glued = new Uint8Array(written.reduce((n, b) => n + b.length, 0))
        let at = 0
        for (const b of written) { glued.set(b, at); at += b.length }
        return extractFrames(glued).messages.map(m => JSON.parse(m.payloadUtf8) as Record<string, unknown>)
    }
    return { session, s, feed, sentPayloads }
}

const QUEUE_ITEMS = [
    { itemId: 1, media: { metadata: { title: 'T1:E1 · Piloto' } } },
    { itemId: 2, media: { metadata: { title: 'T1:E2 · Meio' } } },
    { itemId: 3, media: { metadata: { title: 'T1:E3 · Final' } } },
]

describe('CastSession (socket fake)', () => {
    it('MEDIA_STATUS alimenta o status: estado, tempos, fila e item atual', () => {
        const { session, feed } = fakeSession()
        feed({ playerState: 'PLAYING', currentTime: 42.5, media: { duration: 3600 }, items: QUEUE_ITEMS, currentItemId: 2 })

        const st = session.status
        expect(st.playing).toBe(true)
        expect(st.currentTime).toBe(42.5)
        expect(st.duration).toBe(3600)
        expect(st.queue.map(q => q.itemId)).toEqual([1, 2, 3])
        expect(st.currentItemId).toBe(2)
    })

    it('meta acompanha o item da fila que está tocando', () => {
        const { session, s, feed } = fakeSession()
        s.queueMetas = [
            { contentId: '55', contentType: 'series', season: 1, episode: 1 },
            { contentId: '55', contentType: 'series', season: 1, episode: 2 },
            { contentId: '55', contentType: 'series', season: 1, episode: 3 },
        ]
        feed({ playerState: 'PLAYING', items: QUEUE_ITEMS, currentItemId: 1 })
        expect(session.status.meta?.episode).toBe(1)

        // A fila avançou → o histórico deve apontar pro episódio novo.
        feed({ playerState: 'PLAYING', currentItemId: 2 })
        expect(session.status.meta?.episode).toBe(2)
    })

    it('legenda: disponibilidade por item, EDIT_TRACKS_INFO no toggle e reset ao avançar', () => {
        const { session, s, feed, sentPayloads } = fakeSession()
        s.queueSubtitles = [true, false, true]
        feed({ playerState: 'PLAYING', items: QUEUE_ITEMS, currentItemId: 1 })
        expect(session.status.subtitleAvailable).toBe(true)
        expect(session.status.subtitleEnabled).toBe(true)

        session.setSubtitleEnabled(false)
        expect(session.status.subtitleEnabled).toBe(false)
        const edit = sentPayloads().find(p => p.type === 'EDIT_TRACKS_INFO')
        expect(edit).toMatchObject({ mediaSessionId: 7, activeTrackIds: [] })

        // Item 2 não tem track; e o avanço reseta o toggle pra ativo.
        feed({ playerState: 'PLAYING', currentItemId: 2 })
        expect(session.status.subtitleAvailable).toBe(false)
        expect(session.status.subtitleEnabled).toBe(true)
    })

    it('fim natural: 3× IDLE/FINISHED no ÚLTIMO item fecham a sessão sem reconectar', () => {
        const { session, s, feed } = fakeSession()
        feed({ playerState: 'PLAYING', items: QUEUE_ITEMS, currentItemId: 3 })

        feed({ playerState: 'IDLE', idleReason: 'FINISHED' })
        feed({ playerState: 'IDLE', idleReason: 'FINISHED' })
        expect(session.isActive).toBe(true) // ainda dentro das confirmações

        feed({ playerState: 'IDLE', idleReason: 'FINISHED' })
        expect(session.isActive).toBe(false)
        expect(s.intentionalClose).toBe(true) // fim natural não dispara auto-reconnect
    })

    it('transição entre episódios NÃO fecha: FINISHED fora do último item é ignorado', () => {
        const { session, feed } = fakeSession()
        feed({ playerState: 'PLAYING', items: QUEUE_ITEMS, currentItemId: 1 })

        for (let i = 0; i < 5; i++) feed({ playerState: 'IDLE', idleReason: 'FINISHED' })
        expect(session.isActive).toBe(true)
    })

    it('FINISHED com loadingItemId (próximo carregando) não conta pro fim', () => {
        const { session, feed } = fakeSession()
        feed({ playerState: 'PLAYING', items: QUEUE_ITEMS, currentItemId: 3 })

        for (let i = 0; i < 5; i++) feed({ playerState: 'IDLE', idleReason: 'FINISHED', loadingItemId: 4 })
        expect(session.isActive).toBe(true)
    })

    it('voltar a tocar zera o contador de fim', () => {
        const { session, feed } = fakeSession()
        feed({ playerState: 'PLAYING', items: QUEUE_ITEMS, currentItemId: 3 })

        feed({ playerState: 'IDLE', idleReason: 'FINISHED' })
        feed({ playerState: 'IDLE', idleReason: 'FINISHED' })
        feed({ playerState: 'PLAYING' }) // seek/replay — zera
        feed({ playerState: 'IDLE', idleReason: 'FINISHED' })
        feed({ playerState: 'IDLE', idleReason: 'FINISHED' })
        expect(session.isActive).toBe(true)
    })

    it('queueSkip e pause enviam os comandos com a mediaSession', () => {
        const { session, sentPayloads } = fakeSession()
        session.queueSkip('next')
        session.pause()
        const sent = sentPayloads()
        expect(sent.find(p => p.type === 'QUEUE_NEXT')).toMatchObject({ mediaSessionId: 7 })
        expect(sent.find(p => p.type === 'PAUSE')).toMatchObject({ mediaSessionId: 7 })
    })

    it('close é idempotente e corta os envios', () => {
        const { session, sentPayloads } = fakeSession()
        session.close()
        session.close() // segundo close: no-op
        const before = sentPayloads().length
        session.pause() // socket já foi solto — nada novo no fio
        expect(sentPayloads().length).toBe(before)
        expect(session.isActive).toBe(false)
    })
})

describe('attemptReconnect (queda de conexão)', () => {
    // O harness substitui attach/connectAndLaunch na instância; os backoffs
    // exponenciais correm em timers fake.
    function reconnectHarness() {
        const base = fakeSession()
        const r = base.s as unknown as {
            reloadMedia: (() => void) | null
            reconnecting: boolean
            closed: boolean
            reconnectAttempts: number
            attemptReconnect: () => Promise<void>
        }
        const inst = base.session as unknown as {
            attach: () => Promise<void>
            connectAndLaunch: () => Promise<void>
        }
        r.reloadMedia = vi.fn()
        return { ...base, r, inst }
    }

    it('re-adota a sessão via attach (blip de rede) sem recarregar a mídia', async () => {
        vi.useFakeTimers()
        const { session, s, r, inst } = reconnectHarness()
        // Fiel ao real: attach reabre o transporte (repõe o socket).
        inst.attach = vi.fn(async () => {
            s.socket = { write: () => true, end: () => undefined }
        })
        inst.connectAndLaunch = vi.fn(async () => undefined)

        const done = r.attemptReconnect()
        await vi.advanceTimersByTimeAsync(1000) // 1º backoff
        await done

        expect(inst.attach).toHaveBeenCalledTimes(1)
        expect(inst.connectAndLaunch).not.toHaveBeenCalled()
        expect(r.reloadMedia).not.toHaveBeenCalled()
        expect(r.reconnecting).toBe(false)
        expect(r.reconnectAttempts).toBe(0) // resetado pro próximo incidente
        expect(session.isActive).toBe(true) // controle retomado
        vi.useRealTimers()
    })

    it('receiver morreu → relança e recarrega na última posição', async () => {
        vi.useFakeTimers()
        const { r, inst } = reconnectHarness()
        inst.attach = vi.fn(async () => { throw new Error('nada rodando') })
        inst.connectAndLaunch = vi.fn(async () => undefined)

        const done = r.attemptReconnect()
        await vi.advanceTimersByTimeAsync(1000)
        await done

        expect(inst.connectAndLaunch).toHaveBeenCalledTimes(1)
        expect(r.reloadMedia).toHaveBeenCalledTimes(1)
        expect(r.reconnecting).toBe(false)
        vi.useRealTimers()
    })

    it('desiste depois de 6 tentativas com backoff exponencial', async () => {
        vi.useFakeTimers()
        const { r, inst } = reconnectHarness()
        inst.attach = vi.fn(async () => { throw new Error('down') })
        inst.connectAndLaunch = vi.fn(async () => { throw new Error('down') })

        const done = r.attemptReconnect()
        // Backoffs: 1s, 2s, 4s, 8s, 15s (cap), 15s.
        for (const ms of [1000, 2000, 4000, 8000, 15000, 15000]) {
            await vi.advanceTimersByTimeAsync(ms)
        }
        await done

        expect(inst.attach).toHaveBeenCalledTimes(6)
        expect(r.closed).toBe(true) // desistiu — sessão morta
        expect(r.reconnecting).toBe(false)
        vi.useRealTimers()
    })

    it('close() durante o backoff cancela a reconexão', async () => {
        vi.useFakeTimers()
        const { session, r, inst } = reconnectHarness()
        inst.attach = vi.fn(async () => { throw new Error('down') })
        inst.connectAndLaunch = vi.fn(async () => { throw new Error('down') })

        const done = r.attemptReconnect()
        session.close() // usuário parou no meio do backoff
        await vi.advanceTimersByTimeAsync(1000)
        await done

        expect(inst.attach).not.toHaveBeenCalled()
        expect(r.reconnecting).toBe(false)
        vi.useRealTimers()
    })

    it('sem reloadMedia (nada foi carregado) → marca fechado e não tenta', async () => {
        const { r } = reconnectHarness()
        r.reloadMedia = null
        await r.attemptReconnect()
        expect(r.closed).toBe(true)
    })
})
