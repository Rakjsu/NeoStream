/**
 * 📺 Cast que falha deixa a conexão presa na TV.
 *
 * Os três caminhos que criam sessão (`cast:play`, `cast:play-queue`,
 * `cast:reconnect`) constroem a `CastSession` e devolvem `{success:false}`
 * quando o passo seguinte falha — sem nunca chamar `close()`. Só que a essa
 * altura o `connectTransport()` JÁ abriu o socket TLS e JÁ armou o heartbeat
 * de 5 s: o que fica pra trás não é uma referência solta, é uma conexão viva
 * num dos poucos slots do Chromecast, batendo ping pra sempre.
 *
 * O teste roda a CastSession DE VERDADE (só o `node:tls` é falso, como em
 * castClient.test.ts) e cobra o recurso, não a chamada: depois de um handler
 * responder `success:false`, o socket tem que estar encerrado e o heartbeat
 * tem que ter parado de escrever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    CAST_SOURCE_ID, CAST_RECEIVER_ID, NS_RECEIVER,
    extractFrames, frameCastMessage,
} from './castProtocol'

/** TLS falso: o `connectTransport` roda de verdade, sem rede. */
const tlsFake = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')
    const sockets: FakeTlsSocket[] = []

    class FakeTlsSocket extends EventEmitter {
        destroyed = false
        encerrado = false
        escritas = 0
        readonly enviado: Uint8Array[] = []
        setTimeout() { return this }
        write(b: Uint8Array) { this.escritas++; this.enviado.push(b); return true }
        end() { this.encerrado = true; this.emit('close') }
        destroy() {
            if (this.destroyed) return
            this.destroyed = true
            this.emit('close')
        }
    }

    return {
        sockets,
        connect: (_options: unknown, onConnect: () => void) => {
            const socket = new FakeTlsSocket()
            sockets.push(socket)
            onConnect()
            return socket
        },
    }
})

vi.mock('node:tls', () => ({ default: { connect: tlsFake.connect } }))

type Manipulador = (event: unknown, ...args: unknown[]) => unknown

const estado = vi.hoisted(() => ({
    handlers: new Map<string, Manipulador>(),
    ouvintesDoBrowser: new Map<string, (service: unknown) => void>(),
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: Manipulador) => { estado.handlers.set(canal, fn) },
        on: () => undefined,
    },
}))
vi.mock('bonjour-service', () => ({
    Bonjour: class {
        find() {
            return {
                on: (evento: string, fn: (service: unknown) => void) => { estado.ouvintesDoBrowser.set(evento, fn) },
                update: () => undefined,
                stop: () => undefined,
            }
        }
        destroy() { /* noop */ }
    },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./dlnaHandlers', () => ({
    isLoopbackUrl: () => false,
    createLanProxyUrlFor: async (url: string) => url,
    registerCastSubtitleVtt: async () => 'http://192.168.0.2/legenda.vtt',
}))

/** O LAUNCH_TIMEOUT_MS do castClient — a espera que estoura quando a TV cala. */
const ESPERA_DO_LAUNCH = 15000
const HEARTBEAT = 5000

const invocar = (canal: string, carga?: unknown) =>
    (estado.handlers.get(canal) as Manipulador)(null, carga)

describe('cast que falha não deixa conexão presa na TV', () => {
    beforeEach(async () => {
        vi.resetModules()
        vi.useFakeTimers()
        estado.handlers.clear()
        estado.ouvintesDoBrowser.clear()
        tlsFake.sockets.length = 0
        const mod = await import('./castHandlers')
        mod.setupCastHandlers()
        // Uma TV na rede, entregue pelo mDNS como o bonjour entregaria.
        estado.ouvintesDoBrowser.get('up')?.({
            fqdn: 'sala._googlecast._tcp.local',
            name: 'Chromecast-sala',
            addresses: ['192.168.0.42'],
            txt: { fn: 'TV da Sala', md: 'Chromecast Ultra' },
        })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    /**
     * A TV nunca responde o RECEIVER_STATUS: é assim que o LAUNCH estoura os
     * 15 s no mundo real (aparelho ocupado, Wi-Fi ruim, slots esgotados).
     */
    const deixarOLaunchEstourar = async <T,>(promessa: Promise<T>): Promise<T> => {
        await vi.advanceTimersByTimeAsync(ESPERA_DO_LAUNCH + 100)
        return promessa
    }

    /** O recurso ficou preso? Socket aberto ou heartbeat ainda batendo. */
    const conexaoPresa = async (socket: (typeof tlsFake.sockets)[number]) => {
        const antes = socket.escritas
        await vi.advanceTimersByTimeAsync(HEARTBEAT * 4)
        return { aberto: !socket.encerrado, pings: socket.escritas - antes }
    }

    /** Tudo que a sessão mandou pra TV, já desenquadrado. */
    const tiposEnviados = (socket: (typeof tlsFake.sockets)[number]) => {
        const total = socket.enviado.reduce((n, b) => n + b.length, 0)
        const grudado = new Uint8Array(total)
        let at = 0
        for (const b of socket.enviado) { grudado.set(b, at); at += b.length }
        return extractFrames(grudado).messages
            .map(m => (JSON.parse(m.payloadUtf8) as { type?: string }).type)
    }

    /** A TV responde o RECEIVER_STATUS que o `attach()` está esperando. */
    const responderStatusDoReceptor = (
        socket: (typeof tlsFake.sockets)[number],
        app: { appId: string; sessionId: string; transportId: string },
    ) => {
        socket.emit('data', Buffer.from(frameCastMessage({
            sourceId: CAST_RECEIVER_ID,
            destinationId: CAST_SOURCE_ID,
            namespace: NS_RECEIVER,
            payloadUtf8: JSON.stringify({ type: 'RECEIVER_STATUS', status: { applications: [app] } }),
        })))
    }

    it('cast:play que falha encerra o socket e mata o heartbeat', async () => {
        const r = await deixarOLaunchEstourar(invocar('cast:play', {
            deviceId: 'sala._googlecast._tcp.local',
            url: 'http://prov.tv/filme.mp4',
            title: 'Filme',
        }) as Promise<{ success: boolean }>)

        expect(r.success).toBe(false)
        expect(tlsFake.sockets).toHaveLength(1)
        expect(await conexaoPresa(tlsFake.sockets[0])).toEqual({ aberto: false, pings: 0 })
    })

    it('cast:play-queue que falha encerra o socket e mata o heartbeat', async () => {
        const r = await deixarOLaunchEstourar(invocar('cast:play-queue', {
            deviceId: 'sala._googlecast._tcp.local',
            items: [{ url: 'http://prov.tv/ep1.mp4', title: 'T1:E1' }],
        }) as Promise<{ success: boolean }>)

        expect(r.success).toBe(false)
        expect(tlsFake.sockets).toHaveLength(1)
        expect(await conexaoPresa(tlsFake.sockets[0])).toEqual({ aberto: false, pings: 0 })
    })

    it('cast:reconnect que não acha nada pra retomar encerra o socket e mata o heartbeat', async () => {
        // É o caminho mais disparado dos três: o indicador global chama
        // cast:reconnect em toda montagem, e quase nunca há algo tocando.
        const r = await deixarOLaunchEstourar(
            invocar('cast:reconnect', {}) as Promise<{ success: boolean }>,
        )

        expect(r.success).toBe(false)
        expect(tlsFake.sockets).toHaveLength(1)
        expect(await conexaoPresa(tlsFake.sockets[0])).toEqual({ aberto: false, pings: 0 })
    })

    it('fechar a tentativa NÃO derruba o app que já estava na TV', async () => {
        // O risco de acrescentar o close(): o cast:reconnect dispara na
        // montagem do indicador global, e a TV pode estar na Netflix. O
        // attach() recusa (só adota o CC1AD845) — e o close() que entra agora
        // não pode mandar STOP, ou o app do usuário some da tela sozinho.
        const promessa = invocar('cast:reconnect', {}) as Promise<{ success: boolean }>
        await vi.advanceTimersByTimeAsync(0)
        responderStatusDoReceptor(tlsFake.sockets[0], {
            appId: 'CA5E8412', sessionId: 'sessao-da-netflix', transportId: 'web-9',
        })
        const r = await deixarOLaunchEstourar(promessa)

        expect(r.success).toBe(false)
        expect(tiposEnviados(tlsFake.sockets[0])).not.toContain('STOP')
        expect(await conexaoPresa(tlsFake.sockets[0])).toEqual({ aberto: false, pings: 0 })
    })

    it('tentativas seguidas não acumulam conexões abertas no aparelho', async () => {
        // O sintoma do usuário: depois de algumas tentativas frustradas a TV
        // esgota os slots e para de aceitar o app.
        for (let i = 0; i < 3; i++) {
            await deixarOLaunchEstourar(invocar('cast:play', {
                deviceId: 'sala._googlecast._tcp.local',
                url: 'http://prov.tv/filme.mp4',
                title: 'Filme',
            }) as Promise<unknown>)
        }

        expect(tlsFake.sockets).toHaveLength(3)
        const presos = []
        for (const socket of tlsFake.sockets) presos.push(await conexaoPresa(socket))
        expect(presos).toEqual([
            { aberto: false, pings: 0 },
            { aberto: false, pings: 0 },
            { aberto: false, pings: 0 },
        ])
    })
})
