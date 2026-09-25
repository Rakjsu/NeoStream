/**
 * 🔊 O volume que o Chromecast anuncia (D200).
 *
 * A TV manda o volume real — `status.volume.level`, `muted` e `controlType` —
 * em TODO RECEIVER_STATUS: na conexão, no LAUNCH, na resposta ao GET_STATUS do
 * attach e sempre que alguém mexe pelo controle da TV ou pelo Google Home. O
 * `handleMessage` repassava esses pacotes só para o fan-out do LAUNCH/attach e
 * o volume morria ali: `volumeLevel` só era escrito pelo NOSSO `setVolume()`.
 *
 * Na tela isso era o slider do CastControls que nunca aparecia (ele só é
 * desenhado com `volume !== null`, e o único jeito de preencher era o próprio
 * slider). No celular, pior: o ± partia de um 0.5 inventado — com a TV a 20%,
 * um toque no "+" a levava para 60%.
 *
 * O caminho inteiro roda: `setupCastHandlers` de verdade, o `cast:reconnect`
 * adota a sessão com uma `CastSession` de verdade, e a TV fala pelo fio com
 * bytes enquadrados como o Chromecast manda. Só a rede (`node:tls`) e o mDNS
 * são de mentira.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    CAST_MEDIA_APP_ID, CAST_RECEIVER_ID, CAST_SOURCE_ID, NS_RECEIVER,
    extractFrames, extractReceiverVolume, frameCastMessage,
} from './castProtocol'

/** TLS falso: o `connectTransport` e o handler de 'data' rodam de verdade. */
const tlsFake = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')
    const sockets: FakeTlsSocket[] = []

    class FakeTlsSocket extends EventEmitter {
        destroyed = false
        readonly enviado: Uint8Array[] = []
        setTimeout() { return this }
        write(b: Uint8Array) { this.enviado.push(b); return true }
        end() { this.emit('close') }
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
    revokeProxyTokensFor: () => undefined,
}))

type Payload = Record<string, unknown>
type Handlers = typeof import('./castHandlers')

let mod: Handlers

const invocar = (canal: string, carga?: unknown) =>
    (estado.handlers.get(canal) as Manipulador)(null, carga)

function socketAtual() {
    const socket = tlsFake.sockets[tlsFake.sockets.length - 1]
    if (!socket) throw new Error('nenhum socket aberto')
    return socket
}

/** Tudo o que o app já mandou para a TV, decodificado. */
function enviados(): Payload[] {
    const socket = socketAtual()
    const grudado = new Uint8Array(socket.enviado.reduce((n, b) => n + b.length, 0))
    let at = 0
    for (const b of socket.enviado) { grudado.set(b, at); at += b.length }
    return extractFrames(grudado).messages.map(m => JSON.parse(m.payloadUtf8) as Payload)
}

const volumesEnviados = () => enviados().filter(p => p.type === 'SET_VOLUME').map(p => p.volume)

/** A TV manda um RECEIVER_STATUS pelo fio, do jeito que o Chromecast manda. */
function tvAnuncia(volume: unknown) {
    const status: Record<string, unknown> = {
        applications: [{ appId: CAST_MEDIA_APP_ID, transportId: 'web-5', sessionId: 'sess-1' }],
    }
    if (volume !== undefined) status.volume = volume
    socketAtual().emit('data', Buffer.from(frameCastMessage({
        sourceId: CAST_RECEIVER_ID,
        destinationId: CAST_SOURCE_ID,
        namespace: NS_RECEIVER,
        payloadUtf8: JSON.stringify({ type: 'RECEIVER_STATUS', requestId: 0, status }),
    })))
}

/**
 * O indicador global chama `cast:reconnect` ao montar; a TV responde o
 * GET_STATUS do attach com este volume.
 */
async function adotarSessao(volume: unknown) {
    const promessa = invocar('cast:reconnect', {}) as Promise<{ success: boolean; volume?: number | null }>
    // Espera a CONDIÇÃO: o GET_STATUS saiu, então o ouvinte do attach existe.
    await vi.waitFor(() => {
        expect(tlsFake.sockets.length > 0 && enviados().some(p => p.type === 'GET_STATUS')).toBe(true)
    })
    tvAnuncia(volume)
    const r = await promessa
    expect(r.success).toBe(true)
    return r
}

/** O que o `cast:get-status` entrega para o CastControls (a ponte do IPC). */
const volumeNaTela = async () =>
    ((await invocar('cast:get-status')) as { volume: number | null }).volume

/** O que vai para o controle do celular (castVolume do webRemoteServer). */
const volumeNoCelular = () => mod.getCastStatus().volume

describe('volume que o Chromecast anuncia (D200)', () => {
    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.ouvintesDoBrowser.clear()
        tlsFake.sockets.length = 0
        mod = await import('./castHandlers')
        mod.setupCastHandlers()
        estado.ouvintesDoBrowser.get('up')?.({
            fqdn: 'sala._googlecast._tcp.local',
            name: 'Chromecast-sala',
            addresses: ['192.168.0.42'],
            txt: { fn: 'TV da Sala', md: 'Chromecast Ultra' },
        })
    })

    afterEach(async () => {
        await invocar('cast:stop')
    })

    it('o volume da TV chega na tela e no celular logo na conexão, sem o app mexer nele', async () => {
        const r = await adotarSessao({ controlType: 'attenuation', level: 0.35, muted: false, stepInterval: 0.05 })
        // Hoje: null — o slider do CastControls nem é desenhado.
        expect(r.volume).toBe(0.35)
        expect(await volumeNaTela()).toBe(0.35)
        expect(volumeNoCelular()).toBe(0.35)
        // E nada de SET_VOLUME inventado pelo caminho.
        expect(volumesEnviados()).toEqual([])
    })

    it('mexer pelo controle da TV / Google Home atualiza a tela', async () => {
        await adotarSessao({ level: 0.35, muted: false })
        tvAnuncia({ level: 0.8, muted: false })
        expect(await volumeNaTela()).toBe(0.8)
    })

    it('o "+" e o "-" do celular partem do volume REAL da TV, não de um 0.5 chutado', async () => {
        await adotarSessao({ level: 0.2, muted: false })
        expect(mod.castRemoteControl('volumeUp')).toBe(true)
        // Hoje: 0.6 (0.5 + 0.1) — a TV pulava de 20% para 60% num toque.
        const subiu = volumesEnviados().at(-1) as { level: number }
        expect(subiu.level).toBeCloseTo(0.3, 5)
        expect(volumeNoCelular()).toBeCloseTo(0.3, 5)

        tvAnuncia({ level: 0.7, muted: false })
        expect(mod.castRemoteControl('volumeDown')).toBe(true)
        const desceu = volumesEnviados().at(-1) as { level: number }
        expect(desceu.level).toBeCloseTo(0.6, 5)
    })

    it('o slider da tela manda o nível pelo cast:set-volume', async () => {
        await adotarSessao({ level: 0.35, muted: false })
        expect(await invocar('cast:set-volume', { level: 0.5 })).toEqual({ success: true })
        expect(volumesEnviados()).toEqual([{ level: 0.5 }])
        expect(await volumeNaTela()).toBe(0.5)
    })

    it('TV muda pelo controle: mostra 0, e subir o volume tira o mudo', async () => {
        await adotarSessao({ level: 0.6, muted: true })
        expect(await volumeNaTela()).toBe(0)
        expect(volumeNoCelular()).toBe(0)

        await invocar('cast:set-volume', { level: 0.4 })
        // O protocolo quer `level` e `muted` em SET_VOLUME separados.
        expect(volumesEnviados()).toEqual([{ level: 0.4 }, { muted: false }])
        expect(await volumeNaTela()).toBe(0.4)

        // Já sem mudo: mexer de novo manda só o nível.
        await invocar('cast:set-volume', { level: 0.5 })
        expect(volumesEnviados()).toEqual([{ level: 0.4 }, { muted: false }, { level: 0.5 }])
    })

    it('TV muda: pedir 0 não tira o mudo nem apaga o nível que a TV guarda', async () => {
        await adotarSessao({ level: 0.6, muted: true })
        // "-" do celular com a TV muda: ela já está calada.
        mod.castRemoteControl('volumeDown')
        await invocar('cast:set-volume', { level: 0 })
        expect(volumesEnviados()).toEqual([])
        expect(await volumeNaTela()).toBe(0)
    })

    it('tirar o mudo pelo controle da TV volta o nível que ela guardava', async () => {
        await adotarSessao({ level: 0.6, muted: true })
        tvAnuncia({ level: 0.6, muted: false })
        expect(await volumeNaTela()).toBe(0.6)
        // E, já sem mudo, o slider não manda `muted:false` à toa.
        await invocar('cast:set-volume', { level: 0.3 })
        expect(volumesEnviados()).toEqual([{ level: 0.3 }])
    })

    it('aparelho de volume fixo: sem slider e sem SET_VOLUME que ele ignoraria', async () => {
        await adotarSessao({ controlType: 'fixed', level: 1, muted: false })
        expect(await volumeNaTela()).toBeNull()
        expect(volumeNoCelular()).toBeNull()
        await invocar('cast:set-volume', { level: 0.3 })
        mod.castRemoteControl('volumeUp')
        expect(volumesEnviados()).toEqual([])
        expect(await volumeNaTela()).toBeNull()
    })

    it('RECEIVER_STATUS sem volume não apaga o volume já conhecido', async () => {
        await adotarSessao({ level: 0.45, muted: false })
        tvAnuncia(undefined)
        expect(await volumeNaTela()).toBe(0.45)
    })
})

describe('extractReceiverVolume', () => {
    const rs = (volume: unknown) => ({ type: 'RECEIVER_STATUS', status: { volume } })

    it('lê level, muted e controlType', () => {
        expect(extractReceiverVolume(rs({ level: 0.25, muted: false, controlType: 'attenuation' })))
            .toEqual({ level: 0.25, muted: false, fixed: false })
        expect(extractReceiverVolume(rs({ level: 0.7, muted: true, controlType: 'master' })))
            .toEqual({ level: 0.7, muted: true, fixed: false })
        expect(extractReceiverVolume(rs({ level: 1, controlType: 'fixed' })))
            .toEqual({ level: 1, muted: false, fixed: true })
        // `muted` que não é o booleano true não conta como mudo.
        expect(extractReceiverVolume(rs({ level: 0.5, muted: 'true' }))?.muted).toBe(false)
    })

    it('limita a 0..1', () => {
        expect(extractReceiverVolume(rs({ level: 1.4 }))?.level).toBe(1)
        expect(extractReceiverVolume(rs({ level: -0.2 }))?.level).toBe(0)
    })

    it('null para o que não é RECEIVER_STATUS com volume.level numérico', () => {
        expect(extractReceiverVolume(null)).toBeNull()
        expect(extractReceiverVolume('x')).toBeNull()
        expect(extractReceiverVolume({ type: 'LAUNCH_ERROR', status: { volume: { level: 0.5 } } })).toBeNull()
        expect(extractReceiverVolume({ type: 'RECEIVER_STATUS' })).toBeNull()
        expect(extractReceiverVolume({ type: 'RECEIVER_STATUS', status: null })).toBeNull()
        expect(extractReceiverVolume(rs(undefined))).toBeNull()
        expect(extractReceiverVolume(rs(null))).toBeNull()
        expect(extractReceiverVolume(rs({ muted: true }))).toBeNull()
        expect(extractReceiverVolume(rs({ level: '0.5' }))).toBeNull()
        expect(extractReceiverVolume(rs({ level: Number.NaN }))).toBeNull()
        expect(extractReceiverVolume(rs({ level: Number.POSITIVE_INFINITY }))).toBeNull()
    })
})
