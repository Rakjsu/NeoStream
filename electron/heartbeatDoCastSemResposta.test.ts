/**
 * 📺 Chromecast arrancado da tomada ficava "transmitindo" até o app fechar (D198).
 *
 * O heartbeat da CastSession só ESCREVIA um PING a cada 5 s — ninguém olhava
 * se a TV respondia. E a reconexão só nasce do evento 'close' do socket, que
 * a conexão meio-aberta (TV sem energia, Wi-Fi que sumiu sem FIN/RST) pode
 * levar minutos para emitir: o write de um TCP sem par não falha na hora.
 * Resultado: o mini-controle dizia "Transmitindo na TV" com a TV desligada.
 *
 * O teste roda o `connectTransport` DE VERDADE (só o `node:tls` é falso, como
 * em castClient.test.ts) e cobra comportamento, não chamada:
 *  - TV calada além da tolerância → o socket é derrubado e a sessão cai no
 *    caminho de reconexão que já existe (ou morre, se não há o que recarregar);
 *  - TV viva NUNCA é derrubada — nem a que responde PONG, nem a que responde
 *    com qualquer outra mensagem, nem a que dá um branco curto, nem a conexão
 *    nova de uma reconexão (QUALQUER byte conta, tolerância de 3 intervalos);
 *  - de ponta a ponta: com o handler de verdade, o `cast:get-status` que o
 *    indicador global lê passa a dizer `active: false`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    CAST_MEDIA_APP_ID, CAST_SOURCE_ID, NS_HEARTBEAT, NS_MEDIA, NS_RECEIVER,
    extractFrames, frameCastMessage,
} from './castProtocol'

type Manipulador = (event: unknown, ...args: unknown[]) => unknown

const estado = vi.hoisted(() => ({
    handlers: new Map<string, Manipulador>(),
    ouvintesDoBrowser: new Map<string, (service: unknown) => void>(),
}))

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
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
vi.mock('./dlnaHandlers', () => ({
    isLoopbackUrl: () => false,
    createLanProxyUrlFor: async (url: string) => url,
    registerCastSubtitleVtt: async () => 'http://192.168.0.2/legenda.vtt',
}))

/** Como a TV reage aos PINGs que recebe. */
type ModoDaTv = 'pong' | 'media-status' | 'muda'

/** TLS falso: o `connectTransport` roda de verdade, sem rede. */
const tlsFake = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')
    const sockets: FakeTlsSocket[] = []

    class FakeTlsSocket extends EventEmitter {
        destroyed = false
        pings = 0
        /** Preenchido pelo teste: como responder ao que chega. */
        responder: ((socket: FakeTlsSocket) => void) | null = null
        readonly escritas: Uint8Array[] = []
        setTimeout() { return this }
        write(b: Uint8Array) {
            if (this.destroyed) return false
            this.escritas.push(b)
            this.responder?.(this)
            return true
        }
        end() { this.emit('close') }
        destroy() {
            if (this.destroyed) return
            this.destroyed = true
            this.emit('close')
        }
    }

    const fake = {
        sockets,
        FakeTlsSocket,
        /** TV sem energia: o handshake nunca completa e estoura no timeout de 10 s. */
        semEnergia: false,
        /** "Firmware" instalado em toda conexão nova (teste de ponta a ponta). */
        aoConectar: null as ((socket: FakeTlsSocket) => void) | null,
        connect: (_options: unknown, onConnect: () => void) => {
            const socket = new FakeTlsSocket()
            sockets.push(socket)
            if (fake.semEnergia) {
                setTimeout(() => socket.emit('error', new Error('connect ETIMEDOUT')), 10_000)
                return socket
            }
            fake.aoConectar?.(socket)
            onConnect()
            return socket
        },
    }
    return fake
})

vi.mock('node:tls', () => ({ default: { connect: tlsFake.connect } }))

import { CastSession } from './castClient'

interface Internos {
    reloadMedia: (() => void) | null
    connectTransport: () => Promise<void>
    attach: () => Promise<void>
    connectAndLaunch: () => Promise<void>
}

type SocketFalso = InstanceType<typeof tlsFake.FakeTlsSocket>

/** Mensagem vinda da TV, já no formato do fio (castv2 com prefixo de tamanho). */
function daTv(namespace: string, payload: Record<string, unknown>): Buffer {
    return Buffer.from(frameCastMessage({
        sourceId: 'receiver-0',
        destinationId: CAST_SOURCE_ID,
        namespace,
        payloadUtf8: JSON.stringify(payload),
    }))
}

/** Chama `responder` para cada mensagem NOVA que o app escreveu no socket. */
function aCadaMensagem(socket: SocketFalso, responder: (s: SocketFalso, tipo: unknown, namespace: string) => void): void {
    let lidos = 0
    socket.responder = (s) => {
        const tudo = Buffer.concat(s.escritas.map(b => Buffer.from(b)))
        const mensagens = extractFrames(new Uint8Array(tudo)).messages
        const novas = mensagens.slice(lidos)
        lidos = mensagens.length
        for (const m of novas) {
            let tipo: unknown
            try { tipo = (JSON.parse(m.payloadUtf8) as { type?: unknown }).type } catch { continue }
            responder(s, tipo, m.namespace)
        }
    }
}

/** Latência de rede: a resposta chega um pouco depois do pedido. */
function responderDepois(s: SocketFalso, mensagem: Buffer, podeResponder = () => true): void {
    setTimeout(() => {
        if (s.destroyed || !podeResponder()) return
        s.emit('data', mensagem)
    }, 80)
}

/** Liga o "firmware" da TV falsa: responde (ou não) a cada PING que chega. */
function ligarTv(socket: SocketFalso, modo: ModoDaTv): void {
    aCadaMensagem(socket, (s, tipo, namespace) => {
        if (namespace !== NS_HEARTBEAT || tipo !== 'PING') return
        s.pings++
        if (modo === 'muda') return
        responderDepois(s, modo === 'pong'
            ? daTv(NS_HEARTBEAT, { type: 'PONG' })
            // Alguns receptores respondem o PING com status, não PONG.
            : daTv(NS_MEDIA, { type: 'MEDIA_STATUS', status: [] }))
    })
}

async function sessaoConectada(
    modo: ModoDaTv,
    { comMidia = false, tvVolta = 'muda' as ModoDaTv } = {},
) {
    const session = new CastSession('192.168.0.10', 'TV da Sala')
    const inst = session as unknown as Internos
    if (comMidia) {
        inst.reloadMedia = vi.fn()
        // A reconexão real abriria TLS e adotaria a sessão; aqui basta a
        // conexão nova, com a TV se comportando como `tvVolta` dali em diante.
        inst.attach = vi.fn(async () => {
            await inst.connectTransport()
            ligarTv(tlsFake.sockets[tlsFake.sockets.length - 1], tvVolta)
        })
    }
    await inst.connectTransport()
    const socket = tlsFake.sockets[0]
    ligarTv(socket, modo)
    return { session, inst, socket }
}

describe('heartbeat do Chromecast confere se a TV ainda responde (D198)', () => {
    beforeEach(() => {
        tlsFake.sockets.length = 0
        tlsFake.semEnergia = false
        tlsFake.aoConectar = null
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
    })

    it('TV arrancada da tomada: sem nenhum byte, a sessão para de dizer "transmitindo"', async () => {
        const { session, socket } = await sessaoConectada('muda')
        expect(session.isActive).toBe(true)

        // Um minuto de silêncio absoluto — o socket meio-aberto não emite 'close' sozinho.
        await vi.advanceTimersByTimeAsync(60_000)

        expect(socket.pings).toBeGreaterThan(0) // o PING saiu…
        expect(socket.destroyed).toBe(true) // …e a falta de resposta derrubou a conexão
        expect(session.isActive).toBe(false) // nada pra recarregar → sessão morta
        expect(vi.getTimerCount()).toBe(0) // e o heartbeat parou de bater
    })

    it('a queda é percebida em ~20 s: 15 s de tolerância (3 intervalos), nem menos nem mais', async () => {
        const { socket } = await sessaoConectada('muda')

        // O tique dos 15 s ainda está DENTRO da tolerância — um detector de
        // 2 intervalos (ou com >=) já teria derrubado aqui.
        await vi.advanceTimersByTimeAsync(19_000)
        expect(socket.destroyed).toBe(false)

        // O tique dos 20 s passa dela — um detector de 4 intervalos ainda esperaria.
        await vi.advanceTimersByTimeAsync(2_000)
        expect(socket.destroyed).toBe(true)
    })

    it('com mídia carregada, a TV calada cai no caminho de reconexão que já existe', async () => {
        const { session, inst, socket } = await sessaoConectada('muda', { comMidia: true })

        await vi.advanceTimersByTimeAsync(21_000) // detecta (≤ 20 s) + 1º backoff (1 s)

        expect(socket.destroyed).toBe(true)
        expect(inst.attach).toHaveBeenCalled() // tentou retomar o controle
        expect(tlsFake.sockets.length).toBeGreaterThanOrEqual(2) // abriu conexão nova
        session.close()
    })

    it('a conexão nova da reconexão ganha a própria tolerância (não herda o silêncio da velha)', async () => {
        // A TV sumiu (Wi-Fi caiu) e voltou: a reconexão acha a TV respondendo.
        const { session, socket } = await sessaoConectada('muda', { comMidia: true, tvVolta: 'pong' })

        await vi.advanceTimersByTimeAsync(21_000) // velha derrubada + reconexão
        expect(socket.destroyed).toBe(true)
        expect(tlsFake.sockets).toHaveLength(2)
        const nova = tlsFake.sockets[1]

        await vi.advanceTimersByTimeAsync(60_000)

        expect(nova.pings).toBeGreaterThanOrEqual(10)
        expect(nova.destroyed).toBe(false) // o relógio da velha não derruba a nova
        expect(tlsFake.sockets).toHaveLength(2) // e nada de reconexão em laço
        expect(session.isActive).toBe(true)
        session.close()
    })

    it('TV que responde PONG nunca é derrubada', async () => {
        const { session, socket } = await sessaoConectada('pong')

        await vi.advanceTimersByTimeAsync(120_000)

        expect(socket.pings).toBeGreaterThanOrEqual(20)
        expect(socket.destroyed).toBe(false)
        expect(session.isActive).toBe(true)
        session.close()
    })

    it('TV que responde o PING com MEDIA_STATUS (e não PONG) também conta como viva', async () => {
        const { session, socket } = await sessaoConectada('media-status')

        await vi.advanceTimersByTimeAsync(120_000)

        expect(socket.destroyed).toBe(false)
        expect(session.isActive).toBe(true)
        session.close()
    })

    it('um branco curto (TV ocupada ~12 s) não derruba a sessão', async () => {
        const { session, socket } = await sessaoConectada('muda')

        await vi.advanceTimersByTimeAsync(12_000)
        // A TV volta a falar (qualquer byte) e segue respondendo dali em diante.
        socket.emit('data', daTv(NS_HEARTBEAT, { type: 'PING' }))
        ligarTv(socket, 'pong')
        await vi.advanceTimersByTimeAsync(60_000)

        expect(socket.destroyed).toBe(false)
        expect(session.isActive).toBe(true)
        session.close()
    })
})

describe('ponta a ponta: o cast:get-status que o indicador global lê (D198)', () => {
    const SALA = 'sala._googlecast._tcp.local'
    const tomada = { ligada: true }

    /** Chromecast de verdade (do ponto de vista do app) enquanto está na tomada. */
    function chromecast(socket: SocketFalso): void {
        const naTomada = () => tomada.ligada
        aCadaMensagem(socket, (s, tipo, namespace) => {
            if (!tomada.ligada) return
            if (namespace === NS_HEARTBEAT && tipo === 'PING') {
                responderDepois(s, daTv(NS_HEARTBEAT, { type: 'PONG' }), naTomada)
            } else if (namespace === NS_RECEIVER && (tipo === 'LAUNCH' || tipo === 'GET_STATUS')) {
                responderDepois(s, daTv(NS_RECEIVER, {
                    type: 'RECEIVER_STATUS',
                    status: { applications: [{ appId: CAST_MEDIA_APP_ID, transportId: 'web-5', sessionId: 'sessao-1' }] },
                }), naTomada)
            } else if (namespace === NS_MEDIA && (tipo === 'LOAD' || tipo === 'GET_STATUS')) {
                responderDepois(s, daTv(NS_MEDIA, {
                    type: 'MEDIA_STATUS',
                    status: [{ mediaSessionId: 1, playerState: 'PLAYING', currentTime: 42 }],
                }), naTomada)
            }
        })
    }

    const handler = (canal: string) => estado.handlers.get(canal) as Manipulador
    const statusDoCast = () => handler('cast:get-status')(null) as { success: boolean; active: boolean }

    beforeEach(async () => {
        tlsFake.sockets.length = 0
        tlsFake.semEnergia = false
        tlsFake.aoConectar = chromecast
        tomada.ligada = true
        vi.useFakeTimers()
        vi.resetModules()
        estado.handlers.clear()
        estado.ouvintesDoBrowser.clear()
        const mod = await import('./castHandlers')
        mod.setupCastHandlers()
        estado.ouvintesDoBrowser.get('up')?.({
            fqdn: SALA,
            name: 'sala',
            addresses: ['192.168.0.42'],
            txt: { fn: 'TV da Sala', md: 'Chromecast' },
        })
    })
    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
    })

    it('Chromecast tirado da tomada no meio do filme: o "transmitindo" some sozinho', async () => {
        const tocando = handler('cast:play')(null, {
            deviceId: SALA, url: 'http://192.168.0.2/filme.mp4', title: 'Filme',
        }) as Promise<{ success: boolean }>
        await vi.advanceTimersByTimeAsync(1_000)
        expect((await tocando).success).toBe(true)
        expect(statusDoCast().active).toBe(true)

        // Tomada puxada: nenhum byte mais, e ninguém atende conexão nova.
        tomada.ligada = false
        tlsFake.semEnergia = true

        // Enquanto a reconexão tenta, ainda vale esperar a TV voltar.
        await vi.advanceTimersByTimeAsync(30_000)
        expect(statusDoCast().active).toBe(true)

        // Esgotadas as tentativas (backoff + timeout de conexão), desiste.
        await vi.advanceTimersByTimeAsync(200_000)
        expect(statusDoCast().active).toBe(false)
        expect(vi.getTimerCount()).toBe(0) // sem heartbeat nem tentativa pendurada
    })

    it('Chromecast ligado o filme inteiro: o cast:get-status segue "transmitindo"', async () => {
        const tocando = handler('cast:play')(null, {
            deviceId: SALA, url: 'http://192.168.0.2/filme.mp4', title: 'Filme',
        }) as Promise<{ success: boolean }>
        await vi.advanceTimersByTimeAsync(1_000)
        expect((await tocando).success).toBe(true)

        // Sem o indicador cutucando (nenhum cast:get-status): só o heartbeat mantém a conversa.
        await vi.advanceTimersByTimeAsync(300_000)

        expect(statusDoCast().active).toBe(true)
        expect(tlsFake.sockets).toHaveLength(1) // nunca derrubou nem reconectou
    })
})
