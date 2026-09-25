/**
 * 📺 Mandar um segundo vídeo pra OUTRA TV DLNA tem que encerrar a primeira.
 *
 * O `dlna:cast` montava a sessão nova e sobrescrevia o estado do módulo
 * (`castSession = {...}`) sem nenhum encerramento: a TV anterior continuava
 * tocando, o remux de ffmpeg da sessão velha continuava vivo e os tokens do
 * proxy daquele aparelho continuavam valendo. Resultado prático: duas TVs
 * tocando ao mesmo tempo e DUAS conexões abertas no provedor — que é
 * exatamente o que derruba o plano de conexão única.
 *
 * O caminho do Chromecast já acerta isso (`cast:play` chama
 * `stopActiveSession()` antes de montar a nova). Aqui o teste roda os
 * handlers DE VERDADE (só `electron`, `http`, `node-fetch`, o logger, a
 * política de certificado e o caminho do ffmpeg são falsos) e cobra o efeito
 * na rede: o Stop tem que sair pra TV velha ANTES do SetAVTransportURI da
 * nova, e o token de proxy da velha tem que morrer.
 *
 * O `http` falso registra cada SOAP que sai (ação, destino e prazo) e captura
 * o handler do servidor de proxy, então dá pra bater na rota local como a TV
 * bateria e ver o 404 do token revogado. Nada disso lê o fonte.
 *
 * Quatro guardas contra corrigir demais, todas testadas abaixo:
 *  - trocar de conteúdo na MESMA TV não manda Stop (piscaria a tela à toa);
 *  - TV velha desligada não pode segurar nem derrubar o cast novo;
 *  - TV NOVA inalcançável não pode derrubar a sessão velha (o encerramento só
 *    acontece depois de a TV nova responder a descrição);
 *  - `dlna:stop` e o `stop` do controle pelo celular, que passaram a chamar a
 *    mesma função extraída, continuam encerrando tudo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Porta fixa do "servidor" de proxy falso (o real pede 0 ao SO). */
const PORTA_DO_PROXY = 48123

/** Um SOAP que saiu, com o relógio lógico de quando saiu e de quando voltou. */
interface ChamadaSoap {
    url: string
    acao: string
    timeout?: number
    corpo: string
    /** Ordem em que o pedido foi ESCRITO no socket. */
    enviadoEm: number
    /** Ordem em que a TV RESPONDEU (-1 = ainda em voo / calou). */
    respondidoEm: number
}

const rede = vi.hoisted(() => ({
    /** Relógio lógico: cada envio e cada resposta pega o próximo número. */
    relogio: 0,
    /** Todo SOAP que saiu, na ordem. */
    soap: [] as {
        url: string; acao: string; timeout?: number; corpo: string
        enviadoEm: number; respondidoEm: number
    }[],
    /** Hosts que não respondem (TV desligada / Wi-Fi caído). */
    mudas: new Set<string>(),
    /** Hosts cuja descrição UPnP não pode ser buscada (TV nova fora do ar). */
    semDescricao: new Set<string>(),
    /** Handler do proxy local, capturado do createServer. */
    proxy: null as ((req: unknown, res: unknown) => unknown) | null,
    /** ffmpeg de remux falsos criados pela rota /dlna-transcode/. */
    remuxes: [] as { morto: boolean; sinal: string | null }[],
}))

const ipc = vi.hoisted(() => ({
    handlers: new Map<string, (evento: unknown, carga?: unknown) => unknown>(),
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: (evento: unknown, carga?: unknown) => unknown) => {
            ipc.handlers.set(canal, fn)
        },
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

// Há "ffmpeg": só o .mkv passa pelo remux (needsRemux), o .mp4 segue no proxy.
vi.mock('./ffmpegPath', () => ({ resolveFfmpegPath: () => 'C:/falso/ffmpeg.exe' }))

// ffmpeg falso: o remux de verdade nunca roda, mas o processo entra no
// `activeTranscodes` igual — é ele que o encerramento tem que matar.
vi.mock('child_process', async () => {
    const { EventEmitter } = await import('node:events')
    function spawn() {
        const registro = { morto: false, sinal: null as string | null }
        rede.remuxes.push(registro)
        const processo = new EventEmitter() as InstanceType<typeof EventEmitter> & {
            stdout: { pipe: () => void; on: () => void }
            stderr: InstanceType<typeof EventEmitter>
            kill: (sinal?: string) => void
        }
        processo.stdout = { pipe: () => undefined, on: () => undefined }
        processo.stderr = new EventEmitter()
        processo.kill = (sinal?: string) => {
            registro.morto = true
            registro.sinal = sinal ?? null
        }
        return processo
    }
    return { default: { spawn }, spawn }
})

/** Descrição UPnP de uma TV, com os dois serviços que o cast procura. */
const DESCRICAO = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0"><device>
  <friendlyName>TV</friendlyName>
  <manufacturer>Samsung Electronics</manufacturer>
  <modelName>UN50TU8000</modelName>
  <serviceList>
    <service>
      <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
      <controlURL>/AVTransport/control</controlURL>
    </service>
    <service>
      <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
      <controlURL>/RenderingControl/control</controlURL>
    </service>
  </serviceList>
</device></root>`

vi.mock('node-fetch', () => ({
    default: async (url: string) => {
        const alvo = String(url)
        if (/\/(dmr|description\.xml|DeviceDescription\.xml|rootDesc\.xml)$/.test(alvo)) {
            const host = new URL(alvo).hostname
            if (rede.semDescricao.has(host)) throw new Error('connect EHOSTUNREACH')
            return { ok: true, status: 200, text: async () => DESCRICAO }
        }
        // Upstream do provedor (a sonda HEAD do proxy).
        const cabecalhos: Record<string, string> = {
            'content-type': 'video/mp4',
            'content-length': '12345',
        }
        return {
            ok: true,
            status: 200,
            headers: { get: (nome: string) => cabecalhos[nome.toLowerCase()] ?? null },
            body: { destroy: () => undefined },
            text: async () => '',
        }
    },
}))

vi.mock('http', async () => {
    const { EventEmitter } = await import('node:events')

    class RespostaFalsa extends EventEmitter {
        statusCode = 200
    }

    interface OpcoesDoPedido {
        hostname: string
        port?: number | string
        path: string
        timeout?: number
        headers?: Record<string, string | number>
    }

    function request(opcoes: OpcoesDoPedido, aoResponder: (resposta: unknown) => void) {
        const pedido = new EventEmitter() as InstanceType<typeof EventEmitter> & {
            end: (corpo?: Buffer) => void
            destroy: () => void
        }
        const url = `http://${opcoes.hostname}:${opcoes.port || 80}${opcoes.path}`
        const acao = String(opcoes.headers?.SOAPAction ?? '').split('#')[1]?.replace(/"$/, '') ?? ''

        pedido.end = (corpo?: Buffer) => {
            const registro = {
                url,
                acao,
                timeout: opcoes.timeout,
                corpo: corpo ? corpo.toString('utf8') : '',
                enviadoEm: ++rede.relogio,
                respondidoEm: -1,
            }
            rede.soap.push(registro)
            // A resposta chega num turno DEPOIS, como na rede de verdade: é o
            // que separa "esperei a TV velha confirmar" de "mandei e segui".
            setTimeout(() => {
                if (rede.mudas.has(opcoes.hostname)) {
                    // É o que o http real faz quando o deadline do pedido estoura.
                    pedido.emit('timeout')
                    return
                }
                const resposta = new RespostaFalsa()
                aoResponder(resposta)
                resposta.emit('data', Buffer.from(
                    `<s:Envelope><u:${acao}Response xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><CurrentTransportState>PLAYING</CurrentTransportState></u:${acao}Response></s:Envelope>`,
                    'utf8'
                ))
                registro.respondidoEm = ++rede.relogio
                resposta.emit('end')
            }, 0)
        }
        pedido.destroy = () => undefined
        return pedido
    }

    function createServer(handler: (req: unknown, res: unknown) => unknown) {
        const servidor = new EventEmitter() as InstanceType<typeof EventEmitter> & {
            listen: (porta: number, host: string, pronto: () => void) => unknown
            address: () => { port: number }
            close: () => void
        }
        rede.proxy = handler
        servidor.listen = (_porta: number, _host: string, pronto: () => void) => {
            pronto()
            return servidor
        }
        servidor.address = () => ({ port: PORTA_DO_PROXY })
        servidor.close = () => undefined
        return servidor
    }

    return { default: { request, createServer }, request, createServer }
})

type RespostaDoCast = { success: boolean; error?: string }

const invocar = (canal: string, carga?: unknown) => {
    const handler = ipc.handlers.get(canal)
    if (!handler) throw new Error(`handler ${canal} não registrado`)
    return handler(null, carga) as Promise<RespostaDoCast>
}

/** Cadastra uma TV manual e devolve o id que o cast usa. */
async function cadastrarTv(nome: string, ip: string): Promise<string> {
    const resultado = await invocar('dlna:add-device', { name: nome, ip }) as unknown as
        { success: boolean; device?: { id: string } }
    expect(resultado.success, `cadastro da ${nome} falhou`).toBe(true)
    return resultado.device?.id ?? `manual-${ip}-9197`
}

/** Só as ações SOAP, na ordem, com o host de destino. */
function trilha(): string[] {
    return rede.soap.map(chamada => `${new URL(chamada.url).hostname} ${chamada.acao}`)
}

/** O primeiro SOAP daquela ação para aquele host. */
function acharSoap(host: string, acao: string): ChamadaSoap | undefined {
    return rede.soap.find(chamada =>
        chamada.acao === acao && new URL(chamada.url).hostname === host)
}

/** A URL que foi entregue à TV no último SetAVTransportURI. */
function ultimaUrlEntregue(): string {
    const envio = [...rede.soap].reverse().find(chamada => chamada.acao === 'SetAVTransportURI')
    const bruta = envio?.corpo.match(/<CurrentURI>([^<]*)<\/CurrentURI>/)?.[1] ?? ''
    return bruta.replace(/&amp;/g, '&')
}

/** Bate na rota do proxy local como a TV bateria, e devolve o status. */
async function pedirAoProxy(urlDoProxy: string, metodo: 'HEAD' | 'GET' = 'HEAD'): Promise<number> {
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
    // Sem cabeçalho Host: é como o renderer DLNA antigo chega (e o guarda
    // de rebinding libera a ausência de propósito).
    await rede.proxy?.({ method: metodo, url: `${alvo.pathname}${alvo.search}`, headers: {} }, resposta)
    return status
}

const TV_SALA = '192.168.0.10'
const TV_QUARTO = '192.168.0.11'
const FILME_A = 'http://provedor.exemplo/filmes/a.mp4'
const FILME_B = 'http://provedor.exemplo/filmes/b.mp4'
/** Container que o `needsRemux` manda pro ffmpeg em vez do proxy direto. */
const FILME_MKV = 'http://provedor.exemplo/filmes/a.mkv'

type ModuloDlna = typeof import('./dlnaHandlers')
let modulo: ModuloDlna

describe('segundo cast DLNA encerra o primeiro', () => {
    beforeEach(async () => {
        vi.resetModules()
        ipc.handlers.clear()
        rede.relogio = 0
        rede.soap.length = 0
        rede.mudas.clear()
        rede.semDescricao.clear()
        rede.remuxes.length = 0
        rede.proxy = null
        modulo = await import('./dlnaHandlers')
        modulo.setupDLNAHandlers()
    })

    it('cast na segunda TV manda Stop na primeira ANTES de carregar a nova', async () => {
        const sala = await cadastrarTv('TV da Sala', TV_SALA)
        const quarto = await cadastrarTv('TV do Quarto', TV_QUARTO)

        expect((await invocar('dlna:cast', { deviceId: sala, url: FILME_A, title: 'A' })).success).toBe(true)
        rede.soap.length = 0

        expect((await invocar('dlna:cast', { deviceId: quarto, url: FILME_B, title: 'B' })).success).toBe(true)

        const passos = trilha()
        const stopNaSala = passos.indexOf(`${TV_SALA} Stop`)
        const cargaNoQuarto = passos.indexOf(`${TV_QUARTO} SetAVTransportURI`)

        expect(stopNaSala, `a TV da sala nunca recebeu Stop: ${passos.join(' | ')}`).toBeGreaterThanOrEqual(0)
        expect(cargaNoQuarto).toBeGreaterThanOrEqual(0)
        expect(stopNaSala, 'o Stop da TV velha tem que sair antes da nova começar').toBeLessThan(cargaNoQuarto)
        // E a TV nova não pode levar um Stop no meio do próprio carregamento.
        expect(passos.filter(passo => passo === `${TV_QUARTO} Stop`)).toHaveLength(0)

        // Mais que a ordem de envio: a TV velha tem que ter CONFIRMADO o Stop
        // antes de a nova receber o stream. Mandar o Stop e seguir em frente
        // deixa as duas tocando na janela entre o envio e a resposta — que é
        // justamente a segunda conexão no provedor que o item quer fechar.
        const stop = acharSoap(TV_SALA, 'Stop')
        const carga = acharSoap(TV_QUARTO, 'SetAVTransportURI')
        expect(stop?.respondidoEm, 'a TV da sala nunca respondeu ao Stop').toBeGreaterThan(0)
        expect(
            stop?.respondidoEm ?? Number.POSITIVE_INFINITY,
            'o cast novo não esperou a TV velha confirmar que parou'
        ).toBeLessThan(carga?.enviadoEm ?? 0)
    })

    it('o token de proxy da primeira TV morre quando a segunda começa', async () => {
        const sala = await cadastrarTv('TV da Sala', TV_SALA)
        const quarto = await cadastrarTv('TV do Quarto', TV_QUARTO)

        await invocar('dlna:cast', { deviceId: sala, url: FILME_A, title: 'A' })
        const urlDaSala = ultimaUrlEntregue()
        expect(urlDaSala.includes('/dlna-proxy/'), 'o cast tinha que passar pelo proxy local').toBe(true)
        expect(await pedirAoProxy(urlDaSala), 'token da sessão viva tem que valer').toBe(200)

        await invocar('dlna:cast', { deviceId: quarto, url: FILME_B, title: 'B' })

        expect(
            await pedirAoProxy(urlDaSala),
            'o token da TV velha continuou valendo: a conexão no provedor segue aberta'
        ).toBe(404)
        // E o token NOVO não pode ter sido varrido junto com o velho.
        expect(
            await pedirAoProxy(ultimaUrlEntregue()),
            'o encerramento levou o token do cast novo junto'
        ).toBe(200)
        expect(modulo.isDlnaSessionActive(), 'a sessão nova tem que ficar registrada').toBe(true)
    })

    it('o remux de ffmpeg da primeira TV morre quando a segunda começa', async () => {
        const sala = await cadastrarTv('TV da Sala', TV_SALA)
        const quarto = await cadastrarTv('TV do Quarto', TV_QUARTO)

        await invocar('dlna:cast', { deviceId: sala, url: FILME_MKV, title: 'A' })
        const urlDoRemux = ultimaUrlEntregue()
        expect(urlDoRemux.includes('/dlna-transcode/'), 'o .mkv tinha que ir pelo remux').toBe(true)

        // A TV pede o stream: é aqui que o ffmpeg nasce.
        expect(await pedirAoProxy(urlDoRemux, 'GET')).toBe(200)
        expect(rede.remuxes, 'nenhum ffmpeg foi criado').toHaveLength(1)
        expect(rede.remuxes[0].morto).toBe(false)

        await invocar('dlna:cast', { deviceId: quarto, url: FILME_B, title: 'B' })

        expect(
            rede.remuxes[0].morto,
            'o ffmpeg da TV velha continuou puxando o stream: é a 2ª conexão no provedor'
        ).toBe(true)
        expect(rede.remuxes[0].sinal).toBe('SIGKILL')
        expect(await pedirAoProxy(urlDoRemux, 'GET'), 'o token do remux velho continuou valendo').toBe(404)
    })

    it('TV velha desligada não segura o cast novo (Stop com prazo curto)', async () => {
        const sala = await cadastrarTv('TV da Sala', TV_SALA)
        const quarto = await cadastrarTv('TV do Quarto', TV_QUARTO)

        await invocar('dlna:cast', { deviceId: sala, url: FILME_A, title: 'A' })
        rede.soap.length = 0
        // Tiraram a TV da tomada depois do cast: ela não responde mais nada.
        rede.mudas.add(TV_SALA)

        const resultado = await invocar('dlna:cast', { deviceId: quarto, url: FILME_B, title: 'B' })

        expect(resultado.success, `cast novo morreu por causa da TV velha: ${resultado.error}`).toBe(true)
        expect(trilha()).toContain(`${TV_QUARTO} SetAVTransportURI`)

        const tentativaDeStop = rede.soap.find(
            chamada => chamada.acao === 'Stop' && new URL(chamada.url).hostname === TV_SALA
        )
        expect(tentativaDeStop, 'nem tentou parar a TV velha').toBeDefined()
        expect(
            tentativaDeStop?.timeout ?? Number.POSITIVE_INFINITY,
            'o Stop da TV velha não pode esperar os 10 s do SOAP normal'
        ).toBeLessThanOrEqual(2000)
    })

    it('trocar de conteúdo na MESMA TV não manda Stop (não pisca a tela)', async () => {
        const sala = await cadastrarTv('TV da Sala', TV_SALA)

        await invocar('dlna:cast', { deviceId: sala, url: FILME_A, title: 'A' })
        rede.soap.length = 0

        expect((await invocar('dlna:cast', { deviceId: sala, url: FILME_B, title: 'B' })).success).toBe(true)

        expect(trilha().filter(passo => passo.endsWith('Stop'))).toHaveLength(0)
        expect(trilha()).toContain(`${TV_SALA} SetAVTransportURI`)
        expect(await pedirAoProxy(ultimaUrlEntregue()), 'o token do conteúdo novo tem que valer').toBe(200)
    })

    it('TV NOVA inalcançável não derruba o que já estava tocando', async () => {
        const sala = await cadastrarTv('TV da Sala', TV_SALA)
        const quarto = await cadastrarTv('TV do Quarto', TV_QUARTO)

        await invocar('dlna:cast', { deviceId: sala, url: FILME_A, title: 'A' })
        const urlDaSala = ultimaUrlEntregue()
        rede.soap.length = 0
        // A TV do quarto está fora do ar: nem a descrição UPnP responde.
        rede.semDescricao.add(TV_QUARTO)

        const resultado = await invocar('dlna:cast', { deviceId: quarto, url: FILME_B, title: 'B' })
        expect(resultado.success, 'cast numa TV fora do ar não pode dar certo').toBe(false)

        expect(trilha().filter(passo => passo.endsWith('Stop')), 'parou a TV da sala por nada').toHaveLength(0)
        expect(modulo.isDlnaSessionActive(), 'perdeu a sessão da sala sem ganhar a do quarto').toBe(true)
        expect(await pedirAoProxy(urlDaSala), 'revogou o token de quem ainda está tocando').toBe(200)
    })

    it('dlna:stop continua encerrando sessão e tokens depois da extração', async () => {
        const sala = await cadastrarTv('TV da Sala', TV_SALA)
        await invocar('dlna:cast', { deviceId: sala, url: FILME_A, title: 'A' })
        const urlDaSala = ultimaUrlEntregue()

        expect((await invocar('dlna:stop', { deviceId: sala })).success).toBe(true)

        expect(trilha()).toContain(`${TV_SALA} Stop`)
        expect(modulo.isDlnaSessionActive(), 'o dlna:stop deixou a sessão viva').toBe(false)
        expect(await pedirAoProxy(urlDaSala), 'o dlna:stop deixou o token valendo').toBe(404)
    })

    it('o stop do controle pelo celular continua encerrando sessão e tokens', async () => {
        const sala = await cadastrarTv('TV da Sala', TV_SALA)
        await invocar('dlna:cast', { deviceId: sala, url: FILME_A, title: 'A' })
        const urlDaSala = ultimaUrlEntregue()

        expect(modulo.dlnaRemoteControl('stop')).toBe(true)
        // O comando do controle é disparado sem await; deixa o SOAP ir e voltar.
        await new Promise(resolve => setTimeout(resolve, 5))

        expect(trilha()).toContain(`${TV_SALA} Stop`)
        expect(modulo.isDlnaSessionActive(), 'o controle deixou a sessão viva').toBe(false)
        expect(await pedirAoProxy(urlDaSala), 'o controle deixou o token valendo').toBe(404)
    })
})
