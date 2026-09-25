/**
 * 📺 Cast AirPlay que acabou na TV nunca some da tela (D094).
 *
 * `airplaySession` só era zerado em dois pontos — o handler `airplay:stop` e o
 * plano `stop` do controle do celular. Nenhum caminho percebia que a Apple TV
 * terminou o filme ou que alguém parou pelo controle DELA: o `airplay:status`
 * seguia respondendo `active:true` pra sempre (com o `/scrub` falhando, o
 * snapshot vinha null e o handler caía nos defaults `position:0, duration:0`),
 * e a barrinha do mini-remoto — montada no raiz do app pelo
 * GlobalCastIndicator — ficava presa na tela até reiniciar o app.
 *
 * O teste roda os HANDLERS DE VERDADE (só o `http` e o `bonjour` são falsos,
 * mesmo molde de `electron/sessaoDeCastOrfa.test.ts` e do mock de `http` de
 * `electron/downloadHandlers.test.ts`) e cobra o comportamento pelo contrato
 * que o renderer consome: depois do fim do filme, `airplay:status` tem que
 * devolver `{success:true, active:false}` — é esse `active:false` que o
 * `mapAirplayStatus` traduz em "No active cast session" e que faz o
 * CastControls chamar `onSessionEnded` (e a pílula do GlobalCastIndicator
 * desmontar).
 *
 * O relógio é um `vi.spyOn(Date,'now')` — nada de fake timers, pra não trocar
 * o `setTimeout` que o próprio `airplay:discover` usa.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

type Manipulador = (event: unknown, ...args: unknown[]) => unknown

/** Marcador de "requisição segurada em voo" no corpo falso do /scrub. */
const PENDENTE = '__em_voo__'

const h = await vi.hoisted(async () => {
    const { Readable } = await import('node:stream')
    const PENDENTE = '__em_voo__'

    const state = {
        handlers: new Map<string, Manipulador>(),
        ouvintesDoBrowser: new Map<string, (service: unknown) => void>(),
        /**
         * Corpo do GET /scrub; `null` = o aparelho não atende mais;
         * `PENDENTE` = a requisição fica EM VOO até o teste soltar.
         */
        scrub: null as string | null,
        /**
         * Leituras de /scrub seguradas em voo (modo PENDENTE). Soltar sem
         * argumento = a TV recusou; com corpo = a TV respondeu (tarde).
         */
        emVoo: [] as ((corpo?: string) => void)[],
        /** Todo caminho pedido ao aparelho, na ordem. */
        pedidos: [] as string[],
    }

    interface FakeOptions { method?: string; path?: string }

    class FakeRequest {
        private ouvintes = new Map<string, (arg?: unknown) => void>()
        constructor(private options: FakeOptions, private cb: (res: unknown) => void) {}
        on(evento: string, fn: (arg?: unknown) => void) { this.ouvintes.set(evento, fn); return this }
        destroy() { /* noop */ }
        end() {
            const caminho = String(this.options.path ?? '')
            state.pedidos.push(`${this.options.method ?? 'GET'} ${caminho}`)

            const ehLeituraDoScrub = this.options.method === 'GET' && caminho.startsWith('/scrub')
            if (ehLeituraDoScrub && state.scrub === PENDENTE) {
                // Fica em voo: quem solta é o teste, depois de mexer na sessão.
                const erro = this.ouvintes.get('error')
                const cb = this.cb
                state.emVoo.push((corpo?: string) => {
                    if (typeof corpo !== 'string') {
                        erro?.(new Error('connect ECONNREFUSED 192.168.0.50:7000'))
                        return
                    }
                    const tardia = Readable.from([corpo]) as unknown as { statusCode: number }
                    tardia.statusCode = 200
                    cb(tardia)
                })
                return
            }
            if (ehLeituraDoScrub && state.scrub === null) {
                // Apple TV de volta na tela inicial: a porta 7000 recusa.
                this.ouvintes.get('error')?.(new Error('connect ECONNREFUSED 192.168.0.50:7000'))
                return
            }

            const corpo = ehLeituraDoScrub ? state.scrub! : ''
            const response = Readable.from(corpo ? [corpo] : []) as unknown as { statusCode: number }
            response.statusCode = 200
            this.cb(response)
        }
    }

    return {
        state,
        request: (options: FakeOptions, cb: (res: unknown) => void) => new FakeRequest(options, cb),
    }
})

vi.mock('http', () => ({ default: { request: h.request } }))
vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: Manipulador) => { h.state.handlers.set(canal, fn) },
        on: () => undefined,
    },
}))
vi.mock('bonjour-service', () => ({
    Bonjour: class {
        find() {
            return {
                on: (evento: string, fn: (service: unknown) => void) => { h.state.ouvintesDoBrowser.set(evento, fn) },
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
    revokeProxyTokensFor: () => undefined,
}))

const ID_DA_TV = 'apple-tv-sala._airplay._tcp.local'
const ID_DA_TV2 = 'apple-tv-quarto._airplay._tcp.local'
const TOCANDO = 'duration: 3600.000000\nposition: 12.000000\n'

const invocar = (canal: string, carga?: unknown) =>
    (h.state.handlers.get(canal) as Manipulador)(null, carga)

interface StatusDoAirplay {
    success: boolean
    active: boolean
    playing?: boolean
    position?: number
    duration?: number
    deviceName?: string
}

const status = () => invocar('airplay:status') as Promise<StatusDoAirplay>
/** Deixa o `void run()` do controle do celular terminar. */
const escoarMicrotarefas = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Solta a(s) leitura(s) de /scrub seguradas em voo e devolve o que a promessa
 * pendurada resolveu. Sem `corpo`, a TV recusa; com `corpo`, responde tarde.
 */
async function emVooSolto<T>(promessa: Promise<T>, corpo?: string): Promise<T> {
    expect(h.state.emVoo.length).toBeGreaterThan(0)
    h.state.emVoo.splice(0).forEach((soltar) => soltar(corpo))
    return promessa
}

describe('sessão AirPlay que terminou na TV some da tela', () => {
    let mod: typeof import('./airplayHandlers')
    let relogio: MockInstance<() => number>
    let agora = 1_700_000_000_000

    const castar = async (deviceId = ID_DA_TV) => {
        expect(await invocar('airplay:cast', {
            deviceId,
            url: 'http://192.168.0.2:8080/filme.mp4',
            title: 'Filme',
        })).toEqual({ success: true })
    }

    beforeEach(async () => {
        vi.resetModules()
        h.state.handlers.clear()
        h.state.ouvintesDoBrowser.clear()
        h.state.pedidos.length = 0
        h.state.emVoo.length = 0
        h.state.scrub = TOCANDO
        agora = 1_700_000_000_000
        relogio = vi.spyOn(Date, 'now').mockImplementation(() => agora)

        mod = await import('./airplayHandlers')
        mod.setupAirPlayHandlers()
        // Uma Apple TV na rede, entregue pelo mDNS como o bonjour entregaria.
        h.state.ouvintesDoBrowser.get('up')?.({
            fqdn: ID_DA_TV,
            name: 'Apple TV Sala',
            addresses: ['192.168.0.50'],
            port: 7000,
            txt: { model: 'AppleTV14,1' },
        })
        h.state.ouvintesDoBrowser.get('up')?.({
            fqdn: ID_DA_TV2,
            name: 'Apple TV Quarto',
            addresses: ['192.168.0.51'],
            port: 7000,
            txt: { model: 'AppleTV14,1' },
        })
        await castar()
        expect(await status()).toMatchObject({ success: true, active: true, duration: 3600 })
    })

    afterEach(() => {
        relogio.mockRestore()
    })

    it('o filme chega ao fim na Apple TV e o airplay:status para de anunciar a sessão', async () => {
        // O /scrub ainda responde, mas a posição bateu a duração: acabou.
        h.state.scrub = 'duration: 3600.000000\nposition: 3600.000000\n'

        expect(await status()).toEqual({ success: true, active: false })
        // E continua encerrada no poll seguinte (a sessão morreu de verdade).
        expect(await status()).toEqual({ success: true, active: false })
    })

    it('o último segundo já conta como fim (a TV encerra antes do valor exato)', async () => {
        // Sem a folga, a Apple TV que para em 3599.4 deixaria a barrinha viva.
        h.state.scrub = 'duration: 3600.000000\nposition: 3599.400000\n'
        expect(await status()).toEqual({ success: true, active: false })
    })

    it('faltando mais que a folga, a sessão continua de pé', async () => {
        h.state.scrub = 'duration: 3600.000000\nposition: 3595.000000\n'
        expect(await status()).toMatchObject({ active: true, position: 3595 })
    })

    it('a Apple TV muda derruba a sessão depois da tolerância — e não antes', async () => {
        h.state.scrub = null // ninguém atende mais na porta 7000

        // Falha isolada continua sendo tratada como transitória.
        expect(await status()).toMatchObject({ active: true })
        agora += 4000
        expect(await status()).toMatchObject({ active: true })

        // Um milissegundo antes do limite ainda é seek/Wi-Fi ruim.
        agora += 7999
        expect(await status()).toMatchObject({ active: true })

        // No limite (12 s de silêncio) a TV voltou pra tela inicial.
        agora += 1
        expect(await status()).toEqual({ success: true, active: false })
        expect(await status()).toEqual({ success: true, active: false })
    })

    it('falha isolada do /scrub no meio de um seek NÃO derruba a sessão', async () => {
        h.state.scrub = null
        expect(await status()).toMatchObject({ active: true })

        // A TV volta a responder: o relógio do silêncio tem que ZERAR...
        agora += 2000
        h.state.scrub = 'duration: 3600.000000\nposition: 100.000000\n'
        expect(await status()).toMatchObject({ active: true, position: 100 })

        // ...senão a falha seguinte, muito depois, mataria a sessão na hora
        // por causa de um silêncio antigo que já tinha passado.
        agora += 30_000
        h.state.scrub = null
        expect(await status()).toMatchObject({ active: true })
        agora += 1000
        expect(await status()).toMatchObject({ active: true })
    })

    it('cast novo zera o relógio do silêncio do cast anterior', async () => {
        h.state.scrub = null
        expect(await status()).toMatchObject({ active: true }) // marca o silêncio

        agora += 60_000
        h.state.scrub = TOCANDO
        await castar() // o usuário mandou de novo pra mesma TV
        h.state.scrub = null
        // Primeira falha DESTE cast: não pode herdar o silêncio do anterior.
        expect(await status()).toMatchObject({ active: true })
    })

    it('o /scrub em voo da sessão ANTIGA não envenena o relógio da nova', async () => {
        // A TV da sala fica muda com uma leitura ainda em voo...
        h.state.scrub = PENDENTE
        const emVoo = status()

        // ...e o usuário manda o filme pra TV do quarto (sessão nova).
        h.state.scrub = TOCANDO
        await castar(ID_DA_TV2)
        expect(await emVooSolto(emVoo)).toMatchObject({ active: true })

        // Muito depois, a PRIMEIRA falha da TV do quarto é transitória: se a
        // falha órfã da sala tivesse armado o relógio, isto mataria a sessão.
        agora += 13_000
        h.state.scrub = null
        expect(await status()).toMatchObject({ active: true })
    })

    it('o /scrub em voo da sessão ANTIGA não fala pela nova', async () => {
        // Mesma corrida, mas a TV da sala responde TARDE (em vez de recusar):
        // sem a guarda, o snapshot sairia com o nome/título da sessão morta e
        // o celular mostraria a TV errada transmitindo.
        h.state.scrub = PENDENTE
        const emVoo = mod.getAirplayStatusSnapshot()

        h.state.scrub = TOCANDO
        await castar(ID_DA_TV2)

        expect(await emVooSolto(emVoo, TOCANDO)).toBeNull()
        // A sessão nova segue inteira e é ela quem responde.
        expect((await mod.getAirplayStatusSnapshot())?.deviceName).toBe('Apple TV Quarto')
    })

    it('canal ao vivo (duration 0) não é confundido com fim de filme', async () => {
        h.state.scrub = 'duration: 0.000000\nposition: 0.000000\n'
        expect(await status()).toMatchObject({ success: true, active: true, duration: 0 })
    })

    it('o celular também perde o cast quando o filme acaba na TV', async () => {
        // O controle web pergunta por isAirplaySessionActive/getAirplayStatusSnapshot;
        // enquanto a sessão não morre, o celular segue mostrando "transmitindo".
        h.state.scrub = 'duration: 120.000000\nposition: 120.000000\n'
        expect(mod.isAirplaySessionActive()).toBe(true)

        expect(await mod.getAirplayStatusSnapshot()).toBeNull()
        expect(mod.isAirplaySessionActive()).toBe(false)
    })

    it('parar pelo app continua encerrando a sessão e mandando /stop', async () => {
        expect(await invocar('airplay:stop', { deviceId: ID_DA_TV })).toEqual({ success: true })
        expect(h.state.pedidos.includes('POST /stop')).toBe(true)
        expect(await status()).toEqual({ success: true, active: false })
    })

    it('parar pelo controle do celular continua encerrando a sessão', async () => {
        expect(mod.airplayRemoteControl('stop')).toBe(true)
        await escoarMicrotarefas()
        expect(h.state.pedidos.includes('POST /stop')).toBe(true)
        expect(mod.isAirplaySessionActive()).toBe(false)
        expect(await status()).toEqual({ success: true, active: false })
    })

    it('depois do fim na TV os comandos do mini-remoto recusam em vez de mandar HTTP', async () => {
        h.state.scrub = 'duration: 3600.000000\nposition: 3600.000000\n'
        expect(await status()).toEqual({ success: true, active: false })

        const antes = h.state.pedidos.length
        expect(await invocar('airplay:set-playing', { playing: false }))
            .toEqual({ success: false, error: 'No active cast session' })
        expect(await invocar('airplay:seek', { seconds: 10 }))
            .toEqual({ success: false, error: 'No active cast session' })
        expect(mod.airplayRemoteControl('togglePlay')).toBe(false)
        expect(h.state.pedidos.length).toBe(antes)
    })
})
