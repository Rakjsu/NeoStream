/**
 * 📡 cast:reconnect — retomar o cast depois de reiniciar o app (D097).
 *
 * O GlobalCastIndicator chama `cast:reconnect` UMA vez, na montagem, sem
 * deviceId. Antes o handler pegava `[...devices.values()][0]` — o primeiro
 * aparelho que o mDNS respondeu, sorteio puro numa casa com Chromecast + Nest
 * Hub + TV com Cast — e, se o mDNS ainda não tinha respondido, devolvia
 * "Nenhum dispositivo" e nunca mais tentava. Este teste prende o contrato novo:
 *   - sem deviceId, experimenta TODOS os aparelhos e adota o que tem o
 *     receptor de mídia tocando;
 *   - com o mapa vazio, dá um tempo ao mDNS antes de desistir;
 *   - quem perdeu a corrida (ou chegou atrasado) é fechado;
 *   - um cast iniciado enquanto a retomada corria não é atropelado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Manipulador = (event: unknown, ...args: unknown[]) => unknown

interface SessaoFalsa {
    host: string
    deviceName: string
    fechada: boolean
    adotada: boolean
}

const estado = vi.hoisted(() => ({
    handlers: new Map<string, Manipulador>(),
    ouvintesDoBrowser: new Map<string, (service: unknown) => void>(),
    cutucoes: 0,
    sessoes: [] as SessaoFalsa[],
    /** host → como o attach daquele aparelho termina (ausente = nada tocando). */
    attachPorHost: new Map<string, () => Promise<void>>(),
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
                update: () => { estado.cutucoes++ },
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
vi.mock('./castClient', () => ({
    CastSession: class {
        fechada = false
        adotada = false
        constructor(readonly host: string, readonly deviceName: string) {
            estado.sessoes.push(this as unknown as SessaoFalsa)
        }
        get isActive() { return this.adotada && !this.fechada }
        get status() { return { deviceName: this.deviceName } }
        async attach() {
            const comportamento = estado.attachPorHost.get(this.host)
            if (!comportamento) throw new Error('nenhuma sessão de mídia ativa no dispositivo')
            await comportamento()
            this.adotada = true
        }
        async start() { this.adotada = true }
        setMeta() { /* noop */ }
        requestMediaStatus() { /* noop */ }
        close() { this.fechada = true }
    },
}))

type Resposta = { success: boolean; active?: boolean; deviceId?: string; deviceName?: string; error?: string }

const reconectar = (opts?: { deviceId?: string }) =>
    (estado.handlers.get('cast:reconnect') as Manipulador)(null, opts) as Promise<Resposta>

const aparelho = (id: string, nome: string, host: string) => {
    estado.ouvintesDoBrowser.get('up')?.({
        fqdn: `${id}._googlecast._tcp.local`,
        name: id,
        addresses: [host],
        txt: { fn: nome, md: 'Chromecast' },
    })
}

/** Uma promessa que o teste resolve quando quiser (TV que demora a responder). */
function adiado() {
    let resolver!: () => void
    const promessa = new Promise<void>(r => { resolver = r })
    return { promessa, resolver }
}

describe('cast:reconnect — varre os aparelhos em vez de sortear o primeiro', () => {
    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.ouvintesDoBrowser.clear()
        estado.cutucoes = 0
        estado.sessoes.length = 0
        estado.attachPorHost.clear()
        const mod = await import('./castHandlers')
        mod.setupCastHandlers()
    })
    afterEach(() => { vi.useRealTimers() })

    it('o primeiro aparelho não está tocando, o segundo está: adota o segundo', async () => {
        aparelho('hub', 'Nest Hub', '192.168.0.11')
        aparelho('sala', 'TV da Sala', '192.168.0.42')
        estado.attachPorHost.set('192.168.0.42', async () => undefined)

        const r = await reconectar()

        expect(r.success).toBe(true)
        expect(r.deviceName).toBe('TV da Sala')
        expect(r.deviceId).toBe('sala._googlecast._tcp.local')
        // A tentativa no Nest Hub não fica com o socket aberto.
        const hub = estado.sessoes.find(s => s.host === '192.168.0.11')
        expect(hub?.fechada).toBe(true)
    })

    it('ninguém tocando: falha limpa e fecha TODAS as tentativas', async () => {
        aparelho('hub', 'Nest Hub', '192.168.0.11')
        aparelho('sala', 'TV da Sala', '192.168.0.42')

        const r = await reconectar()

        expect(r.success).toBe(false)
        expect(estado.sessoes).toHaveLength(2)
        expect(estado.sessoes.every(s => s.fechada)).toBe(true)
    })

    it('dois aparelhos com sessão: fica com quem respondeu primeiro e fecha o atrasado', async () => {
        const lenta = adiado()
        aparelho('quarto', 'TV do Quarto', '192.168.0.50')
        aparelho('sala', 'TV da Sala', '192.168.0.42')
        estado.attachPorHost.set('192.168.0.50', () => lenta.promessa)
        estado.attachPorHost.set('192.168.0.42', async () => undefined)

        const r = await reconectar()
        expect(r.deviceName).toBe('TV da Sala')

        lenta.resolver()
        const quarto = estado.sessoes.find(s => s.host === '192.168.0.50')!
        await vi.waitFor(() => { expect(quarto.fechada).toBe(true) })

        const status = await (estado.handlers.get('cast:get-status') as Manipulador)(null) as Resposta
        expect(status.active).toBe(true)
        expect(status.deviceName).toBe('TV da Sala')
    })

    it('mapa vazio na montagem: espera o mDNS responder em vez de desistir', async () => {
        vi.useFakeTimers()
        estado.attachPorHost.set('192.168.0.42', async () => undefined)

        let resposta: Resposta | null = null
        void reconectar().then(r => { resposta = r })
        await vi.advanceTimersByTimeAsync(0)
        expect(resposta).toBeNull()
        // Ninguém tinha respondido: o handler cutuca o mDNS.
        expect(estado.cutucoes).toBeGreaterThan(0)

        // A TV responde um segundo depois da montagem.
        await vi.advanceTimersByTimeAsync(1000)
        aparelho('sala', 'TV da Sala', '192.168.0.42')
        await vi.advanceTimersByTimeAsync(3000)

        expect(resposta).not.toBeNull()
        expect(resposta!.success).toBe(true)
        expect(resposta!.deviceName).toBe('TV da Sala')
    })

    it('mapa vazio: depois do primeiro aparelho, espera os outros da casa aparecerem', async () => {
        // O mDNS não entrega todos de uma vez: o Nest Hub responde primeiro, a
        // TV que está tocando chega logo depois. Varrer só quem veio primeiro
        // repetia o sorteio que este item conserta.
        vi.useFakeTimers()
        estado.attachPorHost.set('192.168.0.42', async () => undefined)

        let resposta: Resposta | null = null
        void reconectar().then(r => { resposta = r })
        await vi.advanceTimersByTimeAsync(1000)
        aparelho('hub', 'Nest Hub', '192.168.0.11')
        await vi.advanceTimersByTimeAsync(800)
        aparelho('sala', 'TV da Sala', '192.168.0.42')
        await vi.advanceTimersByTimeAsync(3000)

        expect(resposta).not.toBeNull()
        expect(resposta!.success).toBe(true)
        expect(resposta!.deviceName).toBe('TV da Sala')
    })

    it('rede sem Chromecast: desiste depois da espera, sem ficar pendurado', async () => {
        vi.useFakeTimers()
        let resposta: Resposta | null = null
        void reconectar().then(r => { resposta = r })
        await vi.advanceTimersByTimeAsync(10_000)

        expect(resposta).toEqual({ success: false, error: 'Nenhum dispositivo' })
    })

    it('um cast iniciado enquanto a retomada corria NÃO é atropelado', async () => {
        const lenta = adiado()
        aparelho('quarto', 'TV do Quarto', '192.168.0.50')
        aparelho('sala', 'TV da Sala', '192.168.0.42')
        estado.attachPorHost.set('192.168.0.50', () => lenta.promessa)

        const retomada = reconectar()
        // O usuário manda um filme pra TV da Sala antes de o Quarto responder.
        const play = await (estado.handlers.get('cast:play') as Manipulador)(null, {
            deviceId: 'sala._googlecast._tcp.local',
            url: 'http://192.168.0.2/filme.mp4',
        }) as Resposta
        expect(play.success).toBe(true)

        lenta.resolver()
        await retomada

        const status = await (estado.handlers.get('cast:get-status') as Manipulador)(null) as Resposta
        expect(status.deviceName).toBe('TV da Sala')
        const quarto = estado.sessoes.find(s => s.host === '192.168.0.50' && s.deviceName === 'TV do Quarto')!
        expect(quarto.fechada).toBe(true)
    })

    it('com deviceId explícito tenta só aquele aparelho', async () => {
        aparelho('hub', 'Nest Hub', '192.168.0.11')
        aparelho('sala', 'TV da Sala', '192.168.0.42')
        estado.attachPorHost.set('192.168.0.11', async () => undefined)
        estado.attachPorHost.set('192.168.0.42', async () => undefined)

        const r = await reconectar({ deviceId: 'sala._googlecast._tcp.local' })

        expect(r.deviceName).toBe('TV da Sala')
        expect(estado.sessoes.map(s => s.host)).toEqual(['192.168.0.42'])
    })
})
