/**
 * 🔑 Parar um cast de Chromecast/AirPlay não revogava os tokens do proxy (D201).
 *
 * O Chromecast e o AirPlay usam o MESMO servidor de proxy do DLNA (escuta em
 * 0.0.0.0): `createLanProxyUrlFor` embrulha a fonte em loopback (o transcode
 * de resgate) e `registerCastSubtitleVtt` publica cada legenda — uma por
 * episódio numa fila de temporada. Só que o único caminho que revogava token
 * era o do DLNA; `cast:stop`, o stop do controle do celular, o `airplay:stop`
 * e o plano `stop` do AirPlay no celular deixavam o link do filme e das
 * legendas valendo por mais 2 horas de inatividade para qualquer um na LAN.
 *
 * O teste roda os handlers DE VERDADE e o proxy DE VERDADE (a rota que a TV
 * chama) — só o socket (`http`), o mDNS, a `CastSession` e o upstream
 * (`node-fetch`) são falsos. Cobra pelo que a TV (ou o vizinho) veria: o link
 * responde 200 enquanto o cast vive e 404 depois do stop.
 *
 * E cobra a armadilha do conserto: `stopActiveSession()` também roda no
 * COMEÇO de um `cast:play`/`cast:play-queue` para trocar de sessão. Se ele
 * revogar pelo host DEPOIS de os tokens do vídeo novo existirem, um segundo
 * cast para a MESMA TV mata a própria legenda e o próprio link de resgate.
 *
 * Por fim, o cast que NÃO chega a começar (a TV recusa o LOAD): a sessão
 * anterior já acabou e nenhum stop vai encontrar sessão pra encerrar — sem a
 * revogação no próprio erro, os links dele ficavam órfãos pelas mesmas 2 h.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Manipulador = (evento: unknown, carga?: unknown) => unknown

interface MidiaEnviada { url: string; subtitleUrl?: string }

const estado = vi.hoisted(() => ({
    handlers: new Map<string, Manipulador>(),
    /** Ouvintes do mDNS, por tipo de serviço ('googlecast' | 'airplay'). */
    browsers: new Map<string, Map<string, (servico: unknown) => void>>(),
    /** Handler do servidor de proxy criado pelo dlnaHandlers. */
    proxy: null as ((req: unknown, res: unknown) => unknown) | null,
    /** Sessões de Chromecast criadas, na ordem. */
    sessoes: [] as { host: string; fechada: boolean; midias: MidiaEnviada[] }[],
    /** A TV recusa o próximo LOAD/QUEUE_LOAD (depois de ter recebido as URLs). */
    recusarLoad: false,
    /** Um por LOAD, na ordem: o que a TV faz antes de responder (ex.: segurar e recusar). */
    planoDoLoad: [] as (() => Promise<void>)[],
    /** Pedidos HTTP mandados ao aparelho AirPlay ("host METODO caminho"). */
    pedidosAirplay: [] as string[],
    /** Aparelhos que não respondem (TV desligada). */
    mudos: new Set<string>(),
    /** Content-Location de cada POST /play do AirPlay: o link que a Apple TV recebeu. */
    linksAirplay: [] as string[],
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: Manipulador) => { estado.handlers.set(canal, fn) },
        on: () => undefined,
    },
}))

vi.mock('./logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('./certificatePolicy', () => ({
    resolveProviderHttpsAgent: async () => undefined,
    getCertificateSettings: () => ({ approvedProviderHosts: [] }),
}))

vi.mock('./ffmpegPath', () => ({ resolveFfmpegPath: () => null }))

vi.mock('bonjour-service', () => ({
    Bonjour: class {
        find(opcoes: { type: string }) {
            const ouvintes = new Map<string, (servico: unknown) => void>()
            estado.browsers.set(opcoes.type, ouvintes)
            return {
                on: (evento: string, fn: (servico: unknown) => void) => { ouvintes.set(evento, fn) },
                update: () => undefined,
                stop: () => undefined,
            }
        }
        destroy() { /* noop */ }
    },
}))

// CastSession falsa: o protocolo do Chromecast tem teste próprio; aqui só
// importa o que o handler entrega à TV (as URLs) e se a sessão foi fechada.
vi.mock('./castClient', () => ({
    CastSession: class {
        isActive = false
        private registro: { host: string; fechada: boolean; midias: MidiaEnviada[] }
        constructor(readonly host: string, readonly name: string) {
            this.registro = { host, fechada: false, midias: [] }
            estado.sessoes.push(this.registro)
        }
        get status() { return { queue: [], currentItemId: null } }
        setMeta() { /* noop */ }
        async start(midia: MidiaEnviada) {
            this.registro.midias = [midia]
            await estado.planoDoLoad.shift()?.()
            if (estado.recusarLoad) throw new Error('LOAD_FAILED')
            this.isActive = true
        }
        async startQueue(itens: MidiaEnviada[]) {
            this.registro.midias = [...itens]
            if (estado.recusarLoad) throw new Error('LOAD_FAILED')
            this.isActive = true
        }
        requestMediaStatus() { /* noop */ }
        close() {
            this.registro.fechada = true
            this.isActive = false
        }
    },
}))

// Upstream (o transcode de resgate em loopback): a sonda HEAD do proxy.
vi.mock('node-fetch', () => ({
    default: async () => ({
        ok: true,
        status: 200,
        headers: {
            get: (nome: string) => ({ 'content-type': 'video/mp2t', 'content-length': '999' } as Record<string, string>)[nome.toLowerCase()] ?? null,
        },
        body: { destroy: () => undefined },
        text: async () => '',
    }),
}))

vi.mock('http', async () => {
    const { EventEmitter } = await import('node:events')

    function createServer(handler: (req: unknown, res: unknown) => unknown) {
        estado.proxy = handler
        const servidor = new EventEmitter() as InstanceType<typeof EventEmitter> & {
            listen: (porta: number, host: string, pronto: () => void) => unknown
            address: () => { port: number }
            close: () => void
        }
        servidor.listen = (_porta, _host, pronto) => { pronto(); return servidor }
        servidor.address = () => ({ port: 45678 })
        servidor.close = () => undefined
        return servidor
    }

    // Cliente do AirPlay: POST /play, POST /stop etc. na porta 7000.
    function request(
        opcoes: { host: string; method?: string; path?: string },
        aoResponder: (resposta: unknown) => void,
    ) {
        const pedido = new EventEmitter() as InstanceType<typeof EventEmitter> & {
            end: (corpo?: string) => void
            destroy: () => void
        }
        pedido.end = (corpo?: string) => {
            estado.pedidosAirplay.push(`${opcoes.host} ${opcoes.method ?? 'GET'} ${opcoes.path ?? ''}`)
            const link = /Content-Location: (\S+)/.exec(String(corpo ?? ''))?.[1]
            if (link) estado.linksAirplay.push(link)
            setTimeout(() => {
                if (estado.mudos.has(opcoes.host)) {
                    pedido.emit('error', new Error(`connect EHOSTUNREACH ${opcoes.host}:7000`))
                    return
                }
                const resposta = new EventEmitter() as InstanceType<typeof EventEmitter> & {
                    statusCode: number
                    resume: () => void
                }
                resposta.statusCode = 200
                resposta.resume = () => undefined
                aoResponder(resposta)
                resposta.emit('end')
            }, 0)
        }
        pedido.destroy = () => undefined
        return pedido
    }

    return { default: { createServer, request }, createServer, request }
})

const TV_SALA = '192.168.0.42'
const APPLE_TV = '192.168.0.50'
const CHROMECAST = 'sala._googlecast._tcp.local'
const AIRPLAY = 'Quarto._airplay._tcp.local'
const RESGATE = 'http://127.0.0.1:47000/resgate/index.m3u8'
const RESGATE_2 = 'http://127.0.0.1:47000/resgate-2/index.m3u8'
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOi\n'

const invocar = <T = { success: boolean; error?: string }>(canal: string, carga?: unknown): Promise<T> => {
    const handler = estado.handlers.get(canal)
    if (!handler) throw new Error(`handler ${canal} não registrado`)
    return Promise.resolve(handler(null, carga) as T)
}

/** Bate no proxy local como a TV (ou o vizinho de LAN) bateria. */
async function statusNoProxy(urlDoProxy: string | undefined, metodo: 'HEAD' | 'GET' = 'HEAD'): Promise<number> {
    if (!urlDoProxy) throw new Error('nenhuma URL do proxy foi entregue ao aparelho')
    const alvo = new URL(urlDoProxy)
    let status = 0
    const resposta = {
        writeHead: (codigo: number) => { status = codigo },
        end: () => undefined,
        destroy: () => undefined,
        headersSent: false,
        writableEnded: false,
        write: () => true,
        on: () => undefined,
    }
    await estado.proxy?.({ method: metodo, url: `${alvo.pathname}${alvo.search}`, headers: {} }, resposta)
    return status
}

type ModCast = typeof import('./castHandlers')
type ModAirplay = typeof import('./airplayHandlers')
let cast: ModCast
let airplay: ModAirplay

describe('stop de Chromecast/AirPlay revoga os links do proxy da LAN', () => {
    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.browsers.clear()
        estado.proxy = null
        estado.sessoes.length = 0
        estado.recusarLoad = false
        estado.planoDoLoad.length = 0
        estado.pedidosAirplay.length = 0
        estado.mudos.clear()
        estado.linksAirplay.length = 0

        cast = await import('./castHandlers')
        airplay = await import('./airplayHandlers')
        cast.setupCastHandlers()
        airplay.setupAirPlayHandlers()

        estado.browsers.get('googlecast')?.get('up')?.({
            fqdn: CHROMECAST,
            name: 'Chromecast-sala',
            addresses: [TV_SALA],
            txt: { fn: 'TV da Sala', md: 'Chromecast' },
        })
        estado.browsers.get('airplay')?.get('up')?.({
            fqdn: AIRPLAY,
            name: 'Quarto',
            addresses: [APPLE_TV],
            port: 7000,
            txt: { model: 'AppleTV6,2' },
        })
    })

    /** Faz um cast:play com resgate em loopback + legenda e devolve os links. */
    async function castComLegenda(url = RESGATE): Promise<MidiaEnviada> {
        const r = await invocar('cast:play', { deviceId: CHROMECAST, url, title: 'Filme', subtitleVtt: VTT })
        expect(r.success, r.error).toBe(true)
        const midia = estado.sessoes.at(-1)?.midias[0]
        if (!midia) throw new Error('a sessão não recebeu mídia')
        return midia
    }

    it('cast:stop derruba o link do resgate e o da legenda', async () => {
        const midia = await castComLegenda()
        expect(midia.url).toContain('/dlna-proxy/')
        expect(await statusNoProxy(midia.url)).toBe(200)
        expect(await statusNoProxy(midia.subtitleUrl, 'GET')).toBe(200)

        expect((await invocar('cast:stop')).success).toBe(true)

        expect(estado.sessoes[0].fechada).toBe(true)
        expect(await statusNoProxy(midia.url)).toBe(404)
        expect(await statusNoProxy(midia.subtitleUrl, 'GET')).toBe(404)
    })

    it('o stop pelo controle do celular também revoga', async () => {
        const midia = await castComLegenda()

        expect(cast.castRemoteControl('stop')).toBe(true)

        expect(await statusNoProxy(midia.url)).toBe(404)
        expect(await statusNoProxy(midia.subtitleUrl, 'GET')).toBe(404)
    })

    it('fechar o app (teardownCast) revoga os links do cast vivo', async () => {
        const midia = await castComLegenda()

        cast.teardownCast()

        expect(await statusNoProxy(midia.subtitleUrl, 'GET')).toBe(404)
    })

    it('segundo cast para a MESMA TV: o vídeo novo segue tocando, o velho morre', async () => {
        const velho = await castComLegenda(RESGATE)
        const novo = await castComLegenda(RESGATE_2)

        expect(estado.sessoes[0].fechada).toBe(true)
        // O conserto ingênuo (revogar no stopActiveSession sem mudar a ordem)
        // mataria ESTES dois: os tokens do cast novo já existiam quando a
        // sessão anterior era encerrada.
        expect(await statusNoProxy(novo.url)).toBe(200)
        expect(await statusNoProxy(novo.subtitleUrl, 'GET')).toBe(200)
        // E o que foi entregue ao cast anterior não vale mais.
        expect(await statusNoProxy(velho.url)).toBe(404)
        expect(await statusNoProxy(velho.subtitleUrl, 'GET')).toBe(404)
    })

    it('fila de temporada para a mesma TV preserva as legendas dos episódios', async () => {
        const velho = await castComLegenda()

        const r = await invocar<{ success: boolean; count?: number; error?: string }>('cast:play-queue', {
            deviceId: CHROMECAST,
            items: [
                { url: 'http://provedor.exemplo/series/ep1.mp4', title: 'T1:E1', subtitleVtt: VTT },
                { url: 'http://provedor.exemplo/series/ep2.mp4', title: 'T1:E2', subtitleVtt: VTT },
            ],
        })
        expect(r.success, r.error).toBe(true)
        expect(r.count).toBe(2)
        expect(estado.sessoes[0].fechada).toBe(true)

        const episodios = estado.sessoes.at(-1)?.midias ?? []
        expect(episodios).toHaveLength(2)
        for (const episodio of episodios) {
            expect(await statusNoProxy(episodio.subtitleUrl, 'GET')).toBe(200)
        }
        expect(await statusNoProxy(velho.subtitleUrl, 'GET')).toBe(404)

        await invocar('cast:stop')
        for (const episodio of episodios) {
            expect(await statusNoProxy(episodio.subtitleUrl, 'GET')).toBe(404)
        }
    })

    it('pedido inválido não derruba o cast que está tocando', async () => {
        const midia = await castComLegenda()

        const r = await invocar('cast:play', { deviceId: CHROMECAST, url: 'ftp://nao-e-http' })
        expect(r.success).toBe(false)
        const fila = await invocar('cast:play-queue', { deviceId: CHROMECAST, items: [{ url: 'ftp://nao-e-http' }] })
        expect(fila).toEqual({ success: false, error: 'Fila vazia' })
        const semAparelho = await invocar('cast:play', { deviceId: 'nao-existe', url: RESGATE_2 })
        expect(semAparelho.success).toBe(false)

        expect(estado.sessoes).toHaveLength(1)
        expect(estado.sessoes[0].fechada).toBe(false)
        expect(cast.isCastSessionActive()).toBe(true)
        expect(await statusNoProxy(midia.url)).toBe(200)
        expect(await statusNoProxy(midia.subtitleUrl, 'GET')).toBe(200)
    })

    it('cast que a TV recusa não deixa os links dele órfãos', async () => {
        estado.recusarLoad = true
        const r = await invocar('cast:play', { deviceId: CHROMECAST, url: RESGATE, title: 'Filme', subtitleVtt: VTT })
        expect(r.success).toBe(false)

        const entregue = estado.sessoes.at(-1)?.midias[0]
        expect(entregue?.url).toContain('/dlna-proxy/')
        expect(estado.sessoes.at(-1)?.fechada).toBe(true)
        expect(await statusNoProxy(entregue?.url)).toBe(404)
        expect(await statusNoProxy(entregue?.subtitleUrl, 'GET')).toBe(404)
    })

    it('cast antigo que falha DEPOIS de um mais novo para a mesma TV não derruba o novo', async () => {
        // Duplo clique: o primeiro pedido fica esperando o LAUNCH (a TV
        // demora), o dono clica de novo e o segundo toca. Só então o primeiro
        // estoura — a revogação do erro dele é por host e mataria o novo.
        const tv: { recusarPrimeiro?: (erro: Error) => void } = {}
        estado.planoDoLoad.push(() => new Promise<void>((_ok, falha) => { tv.recusarPrimeiro = falha }))
        const primeiro = invocar('cast:play', { deviceId: CHROMECAST, url: RESGATE, title: 'Filme', subtitleVtt: VTT })
        await vi.waitFor(() => expect(tv.recusarPrimeiro).toBeTypeOf('function'))

        const novo = await castComLegenda(RESGATE_2)
        tv.recusarPrimeiro?.(new Error('LAUNCH timeout'))
        expect((await primeiro).success).toBe(false)

        expect(await statusNoProxy(novo.url)).toBe(200)
        expect(await statusNoProxy(novo.subtitleUrl, 'GET')).toBe(200)
    })

    it('fila que a TV recusa não deixa as legendas dela órfãs', async () => {
        estado.recusarLoad = true
        const r = await invocar('cast:play-queue', {
            deviceId: CHROMECAST,
            items: [{ url: 'http://provedor.exemplo/series/ep1.mp4', title: 'T1:E1', subtitleVtt: VTT }],
        })
        expect(r.success).toBe(false)

        const entregue = estado.sessoes.at(-1)?.midias[0]
        expect(estado.sessoes.at(-1)?.fechada).toBe(true)
        expect(await statusNoProxy(entregue?.subtitleUrl, 'GET')).toBe(404)
    })

    it('airplay:stop derruba o link do resgate', async () => {
        const r = await invocar('airplay:cast', { deviceId: AIRPLAY, url: RESGATE, title: 'Filme' })
        expect(r.success, r.error).toBe(true)
        const link = estado.linksAirplay.at(-1)
        expect(await statusNoProxy(link)).toBe(200)

        expect((await invocar('airplay:stop', { deviceId: AIRPLAY })).success).toBe(true)

        expect(airplay.isAirplaySessionActive()).toBe(false)
        expect(await statusNoProxy(link)).toBe(404)
    })

    it('airplay:stop com a Apple TV desligada revoga assim mesmo', async () => {
        await invocar('airplay:cast', { deviceId: AIRPLAY, url: RESGATE, title: 'Filme' })
        const link = estado.linksAirplay.at(-1)
        estado.mudos.add(APPLE_TV)

        const r = await invocar('airplay:stop', { deviceId: AIRPLAY })
        expect(r.success).toBe(false)

        expect(await statusNoProxy(link)).toBe(404)
    })

    it('o stop do AirPlay pelo controle do celular também revoga', async () => {
        await invocar('airplay:cast', { deviceId: AIRPLAY, url: RESGATE, title: 'Filme' })
        const link = estado.linksAirplay.at(-1)

        expect(airplay.airplayRemoteControl('stop')).toBe(true)

        // O comando roda em segundo plano: espera a CONDIÇÃO (o /stop saiu e a
        // sessão acabou), não um número de voltas.
        await vi.waitFor(() => expect(airplay.isAirplaySessionActive()).toBe(false))
        await vi.waitFor(async () => expect(await statusNoProxy(link)).toBe(404))
        expect(estado.pedidosAirplay).toContain(`${APPLE_TV} POST /stop`)
    })

    it('o stop do AirPlay pelo celular com a Apple TV muda revoga assim mesmo', async () => {
        await invocar('airplay:cast', { deviceId: AIRPLAY, url: RESGATE, title: 'Filme' })
        const link = estado.linksAirplay.at(-1)
        estado.mudos.add(APPLE_TV)

        expect(airplay.airplayRemoteControl('stop')).toBe(true)

        await vi.waitFor(async () => expect(await statusNoProxy(link)).toBe(404))
    })

    it('parar um aparelho não derruba o link de OUTRO aparelho', async () => {
        const midia = await castComLegenda()
        await invocar('airplay:cast', { deviceId: AIRPLAY, url: RESGATE_2, title: 'Outro' })
        const linkApple = estado.linksAirplay.at(-1)

        await invocar('cast:stop')

        expect(await statusNoProxy(midia.subtitleUrl, 'GET')).toBe(404)
        expect(await statusNoProxy(linkApple)).toBe(200)
    })
})
