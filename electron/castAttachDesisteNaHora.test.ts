/**
 * 📡 attach() responde na hora quando a TV diz "não tem nada meu tocando" (D097).
 *
 * O attach não lança app nenhum: manda GET_STATUS e espera o RECEIVER_STATUS.
 * Se esse status não traz o receptor de mídia (CC1AD845), a resposta JÁ é "não
 * tem o que adotar". Antes o attach ignorava o status e ficava 15 s pendurado
 * até o teto — com o socket TLS ocupando um slot da TV — e isso tornava
 * inviável o cast:reconnect experimentar os outros aparelhos da casa.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

/** TLS falso: o `connectTransport` roda de verdade, sem rede. */
const tlsFake = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')
    class FakeTlsSocket extends EventEmitter {
        destroyed = false
        encerrado = false
        readonly enviado: Uint8Array[] = []
        setTimeout() { return this }
        write(b: Uint8Array) { this.enviado.push(b); return true }
        end() { this.encerrado = true; this.emit('close') }
        destroy() {
            if (this.destroyed) return
            this.destroyed = true
            this.emit('close')
        }
    }
    return {
        connect: (_options: unknown, onConnect: () => void) => {
            const socket = new FakeTlsSocket()
            onConnect()
            return socket
        },
    }
})
vi.mock('node:tls', () => ({ default: { connect: tlsFake.connect } }))

import { CastSession } from './castClient'
import { NS_RECEIVER, extractFrames, type CastMessage } from './castProtocol'

function sessao() {
    const session = new CastSession('192.168.0.10', 'TV Teste')
    const s = session as unknown as {
        transportId: string | null
        handleMessage: (message: CastMessage) => void
        socket: { enviado: Uint8Array[]; encerrado: boolean } | null
    }
    const feedReceiver = (applications: Record<string, unknown>[]) => {
        s.handleMessage({
            sourceId: 'receiver-0',
            destinationId: 'sender-neostream',
            namespace: NS_RECEIVER,
            payloadUtf8: JSON.stringify({ type: 'RECEIVER_STATUS', requestId: 1, status: { applications } }),
        })
    }
    return { session, s, feedReceiver }
}

/** Tudo que a sessão escreveu no socket, já desenquadrado (só o `type`). */
function tiposEnviados(socket: { enviado: Uint8Array[] }) {
    const total = socket.enviado.reduce((n, b) => n + b.length, 0)
    const grudado = new Uint8Array(total)
    let at = 0
    for (const b of socket.enviado) { grudado.set(b, at); at += b.length }
    return extractFrames(grudado).messages
        .map(m => (JSON.parse(m.payloadUtf8) as { type?: string }).type)
}

/** Acompanha o desfecho de uma promessa sem esperar por ela. */
function desfecho(p: Promise<void>) {
    const d: { estado: 'pendente' | 'ok' | 'falhou'; erro?: unknown } = { estado: 'pendente' }
    p.then(() => { d.estado = 'ok' }, (erro: unknown) => { d.estado = 'falhou'; d.erro = erro })
    return d
}

afterEach(() => { vi.useRealTimers() })

describe('CastSession.attach — sem receptor de mídia, desiste na hora', () => {
    it('RECEIVER_STATUS só com o Netflix: rejeita já, sem esperar o teto', async () => {
        vi.useFakeTimers()
        const { session, feedReceiver } = sessao()
        const d = desfecho(session.attach())
        // Deixa o connectTransport (que tem await próprio) armar o ouvinte.
        await vi.advanceTimersByTimeAsync(0)

        feedReceiver([{ appId: 'CA5E8412', transportId: 'netflix-3', sessionId: 'n1' }])
        // Nenhum relógio andou: a resposta da TV basta.
        await vi.waitFor(() => { expect(d.estado).not.toBe('pendente') }, { timeout: 50, interval: 1 })
        expect(d.estado).toBe('falhou')
        expect(String((d.erro as Error).message)).toContain('nenhuma sessão de mídia ativa')
        session.close()
    })

    it('tela ociosa (backdrop) também é "nada tocando"', async () => {
        vi.useFakeTimers()
        const { session, feedReceiver } = sessao()
        const d = desfecho(session.attach())
        await vi.advanceTimersByTimeAsync(0)

        feedReceiver([{ appId: 'E8C28D3C', transportId: 'backdrop-9', sessionId: 'b', isIdleScreen: true }])
        await vi.waitFor(() => { expect(d.estado).not.toBe('pendente') }, { timeout: 50, interval: 1 })
        expect(d.estado).toBe('falhou')
        session.close()
    })

    it('com o CC1AD845 no status continua adotando a sessão', async () => {
        vi.useFakeTimers()
        const { session, s, feedReceiver } = sessao()
        const d = desfecho(session.attach())
        await vi.advanceTimersByTimeAsync(0)

        feedReceiver([{ appId: 'CC1AD845', transportId: 'web-5', sessionId: 'sess-1' }])
        await vi.waitFor(() => { expect(d.estado).not.toBe('pendente') }, { timeout: 50, interval: 1 })
        expect(d.estado).toBe('ok')
        expect(s.transportId).toBe('web-5')
        session.close()
    })

    it('aparelho mudo: o teto do attach é curto (5 s), não os 15 s do LAUNCH', async () => {
        vi.useFakeTimers()
        const { session } = sessao()
        const d = desfecho(session.attach())
        await vi.advanceTimersByTimeAsync(4999)
        expect(d.estado).toBe('pendente')
        await vi.advanceTimersByTimeAsync(1)
        expect(d.estado).toBe('falhou')
        session.close()
    })
})

describe('CastSession.close — soltar a sessão adotada não derruba a TV', () => {
    // O cast:reconnect agora abre uma tentativa por aparelho e FECHA as que não
    // vencem — inclusive a de uma TV que também está tocando e só respondeu
    // depois. Isso só é seguro porque o close() não faz o STOP chegar à TV (o
    // teardownCast, ao sair do app, depende do mesmo: é o que deixa o filme
    // seguindo na TV pra ser retomado no próximo boot). Se o close() passar a
    // mandar STOP, a retomada precisa de outro jeito de soltar o perdedor.
    it('depois de adotar o CC1AD845, close() encerra o socket sem mandar STOP', async () => {
        const { session, s, feedReceiver } = sessao()
        const d = desfecho(session.attach())
        // O ouvinte do RECEIVER_STATUS é armado antes do GET_STATUS sair.
        await vi.waitFor(() => { expect(s.socket && tiposEnviados(s.socket)).toContain('GET_STATUS') }, { timeout: 500, interval: 1 })
        const socket = s.socket!
        feedReceiver([{ appId: 'CC1AD845', transportId: 'web-5', sessionId: 'sess-1' }])
        await vi.waitFor(() => { expect(d.estado).toBe('ok') }, { timeout: 500, interval: 1 })

        session.close()

        expect(socket.encerrado).toBe(true)
        expect(tiposEnviados(socket)).not.toContain('STOP')
        expect(session.isActive).toBe(false)
    })
})
