/**
 * 📺 Filme que acabou na TV DLNA tem que encerrar a sessão NO MAIN (D197).
 *
 * `castSession` só voltava a null em dois pontos: o `dlna:stop` e o `stop` do
 * controle pelo celular. O CastControls do renderer percebia o fim (4 polls
 * STOPPED/NO_MEDIA ou 6 falhas) e chamava `onSessionEnded` — que só faz
 * `setSession(null)` na UI. No main a sessão vivia pra sempre:
 *  - `isDlnaSessionActive()` seguia true e o `dlnaRemoteControl` engolia os
 *    comandos do celular (play/pausa/seek iam pra uma TV parada);
 *  - o laço de 2 s do controle web seguia mandando SOAP pra TV desligada;
 *  - o remux de ffmpeg e os tokens do proxy seguiam valendo.
 *
 * O teste roda os HANDLERS DE VERDADE (mesmo molde de
 * `segundoCastDlnaNaoParaOPrimeiro.test.ts`: só `electron`, `http`,
 * `node-fetch`, o logger, a política de certificado, o caminho do ffmpeg e o
 * `child_process` são falsos) e cobra pelo que o renderer e o controle web
 * consomem: `dlna:get-status` responde "No active cast session",
 * `getDlnaStatusSnapshot()` devolve null, `isDlnaSessionActive()` cai pra
 * false, `dlnaRemoteControl` devolve false (o celular volta a mandar no
 * player local), o token do proxy dá 404 e o ffmpeg morre.
 *
 * O CONTRATO com o renderer: o CastControls desmonta quando desiste e para de
 * consultar, então o main tem que concluir o fim NA MESMA consulta em que o
 * renderer desiste — nem depois (a sessão sobraria sem ninguém perguntando),
 * nem antes (o mini-remoto sumiria no meio de um seek). As constantes do
 * renderer são lidas do próprio CastControls.tsx: se alguém mudar a
 * tolerância de lá, este teste cobra o main junto.
 *
 * O relógio é um `vi.spyOn(Date,'now')` — nada de fake timers: a resposta
 * falsa do SOAP chega num `setTimeout(0)` e tem que continuar chegando. Pra
 * simular TV lenta, `rede.segurar` retém as respostas de uma ação até o
 * teste soltá-las (o estado da TV vale o do instante do pedido).
 *
 * Guardas contra corrigir demais, todas abaixo:
 *  - STOPPED/NO_MEDIA ou SOAP falhando logo depois do cast (TV carregando)
 *    não encerra;
 *  - STOPPED logo depois de play/pausa/seek (TV reposicionando) não encerra —
 *    nem vindo do app, nem vindo do celular;
 *  - STOPPED isolado entre PLAYINGs não encerra;
 *  - falha curta de SOAP (TV ocupada) não encerra;
 *  - dois consultores ao mesmo tempo (mini-remoto + celular) não cortam a
 *    tolerância pela metade: a janela é de relógio, não de número de polls;
 *  - resposta atrasada da sessão velha não derruba o cast novo pra mesma TV.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
    DLNA_CARENCIA_APOS_COMANDO_MS,
    DLNA_PARADA_PARA_ENCERRAR_MS,
    DLNA_SILENCIO_PARA_ENCERRAR_MS,
    novoRelogioDoFimDlna,
    registrarObservacaoDlna,
} from './dlnaFimDaSessao'

/** Porta fixa do "servidor" de proxy falso (o real pede 0 ao SO). */
const PORTA_DO_PROXY = 48124

const rede = vi.hoisted(() => ({
    /** CurrentTransportState que cada TV responde (padrão PLAYING). */
    estado: new Map<string, string>(),
    /** Hosts que não respondem (TV desligada / Wi-Fi caído). */
    mudas: new Set<string>(),
    /** Todo SOAP que saiu: "host Ação". */
    soap: [] as string[],
    /** Corpo de cada SOAP, na mesma ordem. */
    corpos: [] as string[],
    /** Ações cuja resposta fica retida até o teste soltar (TV lenta). */
    segurar: new Set<string>(),
    /** Respostas retidas, na ordem dos pedidos. */
    fila: [] as { acao: string; entregar: () => void }[],
    /** Handler do proxy local, capturado do createServer. */
    proxy: null as ((req: unknown, res: unknown) => unknown) | null,
    /** ffmpeg de remux falsos criados pela rota /dlna-transcode/. */
    remuxes: [] as { morto: boolean }[],
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

vi.mock('./ffmpegPath', () => ({ resolveFfmpegPath: () => 'C:/falso/ffmpeg.exe' }))

vi.mock('child_process', async () => {
    const { EventEmitter } = await import('node:events')
    function spawn() {
        const registro = { morto: false }
        rede.remuxes.push(registro)
        const processo = new EventEmitter() as InstanceType<typeof EventEmitter> & {
            stdout: { pipe: () => void; on: () => void }
            stderr: InstanceType<typeof EventEmitter>
            kill: () => void
        }
        processo.stdout = { pipe: () => undefined, on: () => undefined }
        processo.stderr = new EventEmitter()
        processo.kill = () => { registro.morto = true }
        return processo
    }
    return { default: { spawn }, spawn }
})

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
            return { ok: true, status: 200, text: async () => DESCRICAO }
        }
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
        headers?: Record<string, string | number>
    }

    function request(opcoes: OpcoesDoPedido, aoResponder: (resposta: unknown) => void) {
        const pedido = new EventEmitter() as InstanceType<typeof EventEmitter> & {
            end: (corpo?: Buffer) => void
            destroy: () => void
        }
        const acao = String(opcoes.headers?.SOAPAction ?? '').split('#')[1]?.replace(/"$/, '') ?? ''

        pedido.end = (corpo?: Buffer) => {
            rede.soap.push(`${opcoes.hostname} ${acao}`)
            rede.corpos.push(corpo ? corpo.toString('utf8') : '')
            // A TV responde o estado do instante do PEDIDO, mesmo que a
            // resposta fique retida e chegue depois.
            const muda = rede.mudas.has(opcoes.hostname)
            const estado = rede.estado.get(opcoes.hostname) ?? 'PLAYING'
            const entregar = () => {
                if (muda) {
                    pedido.emit('timeout')
                    return
                }
                const resposta = new RespostaFalsa()
                aoResponder(resposta)
                resposta.emit('data', Buffer.from(
                    `<s:Envelope><u:${acao}Response xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">` +
                    `<CurrentTransportState>${estado}</CurrentTransportState>` +
                    `<RelTime>00:10:00</RelTime><TrackDuration>01:30:00</TrackDuration>` +
                    `<CurrentVolume>20</CurrentVolume>` +
                    `</u:${acao}Response></s:Envelope>`,
                    'utf8'
                ))
                resposta.emit('end')
            }
            if (rede.segurar.has(acao)) rede.fila.push({ acao, entregar })
            else setTimeout(entregar, 0)
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

// ---- O contrato: a tolerância do CastControls, lida da fonte dele ----------

const FONTE_DO_CAST_CONTROLS = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'CastControls.tsx'), 'utf-8')

function constanteDoRenderer(nome: string): number {
    const achado = FONTE_DO_CAST_CONTROLS.match(new RegExp(`const ${nome} = (\\d+);`))
    if (!achado) throw new Error(`CastControls.tsx não tem mais ${nome}: o contrato com o main mudou`)
    return Number(achado[1])
}

/** O CastControls consulta a cada POLL_MS... */
const POLL_MS = constanteDoRenderer('POLL_INTERVAL_MS')
/** ...ignora STOPPED/falha por este tempo depois do cast e de cada comando... */
const CARENCIA_MS = constanteDoRenderer('COMMAND_GRACE_MS')
/** ...e desiste na N-ésima consulta STOPPED/NO_MEDIA, ou na N-ésima falha. */
const POLLS_PARADOS_PRO_RENDERER_DESISTIR = constanteDoRenderer('STOPPED_POLLS_TO_END')
const FALHAS_PRO_RENDERER_DESISTIR = constanteDoRenderer('FAILED_POLLS_TO_END')

type RespostaDoStatus = { success: boolean; error?: string; state?: string }

const invocar = <T = { success: boolean; error?: string }>(canal: string, carga?: unknown) => {
    const handler = ipc.handlers.get(canal)
    if (!handler) throw new Error(`handler ${canal} não registrado`)
    return handler(null, carga) as Promise<T>
}

const TV = '192.168.0.10'
const OUTRA_TV = '192.168.0.11'
const FILME = 'http://provedor.exemplo/filmes/a.mp4'
const FILME_MKV = 'http://provedor.exemplo/filmes/a.mkv'

let agora = 1_800_000_000_000
let relogio: MockInstance<() => number>
type ModuloDlna = typeof import('./dlnaHandlers')
let modulo: ModuloDlna

async function cadastrarTv(ip: string): Promise<string> {
    const resultado = await invocar<{ success: boolean; device?: { id: string } }>(
        'dlna:add-device', { name: `TV ${ip}`, ip })
    expect(resultado.success, `cadastro da TV ${ip} falhou`).toBe(true)
    return resultado.device?.id ?? `manual-${ip}-9197`
}

/** A URL entregue à TV no último SetAVTransportURI. */
function urlEntregueAgora(): string {
    const envio = [...rede.corpos].reverse().find(corpo => corpo.includes('SetAVTransportURI'))
    const bruta = envio?.match(/<CurrentURI>([^<]*)<\/CurrentURI>/)?.[1] ?? ''
    return bruta.replace(/&amp;/g, '&')
}

async function castar(ip: string, url = FILME): Promise<string> {
    const id = await cadastrarTv(ip)
    const resultado = await invocar('dlna:cast', { deviceId: id, url, title: 'Filme' })
    expect(resultado.success, `cast falhou: ${resultado.error}`).toBe(true)
    return id
}

/** Avança o relógio e faz uma consulta do mini-remoto do desktop. */
async function pollDoApp(avancoMs = POLL_MS): Promise<RespostaDoStatus> {
    agora += avancoMs
    return invocar<RespostaDoStatus>('dlna:get-status')
}

/** Solta as respostas retidas (só das ações dadas, ou todas). */
function soltar(acoes?: string[]): void {
    const saem = rede.fila.filter(item => !acoes || acoes.includes(item.acao))
    rede.fila = rede.fila.filter(item => !saem.includes(item))
    for (const item of saem) item.entregar()
}

const CONSULTA_DE_STATUS = ['GetTransportInfo', 'GetPositionInfo']

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
    await rede.proxy?.({ method: metodo, url: `${alvo.pathname}${alvo.search}`, headers: {} }, resposta)
    return status
}

/**
 * Consulta a cada POLL_MS como o CastControls, a partir de uma carência
 * aberta em `carenciaDesde` (cast ou comando): dentro dela nada pode encerrar;
 * fora dela o main encerra exatamente na `limite`-ésima consulta — a mesma em
 * que o renderer desiste. Devolve a resposta dessa última consulta.
 */
async function consultarAteORendererDesistir(carenciaDesde: number, limite: number): Promise<RespostaDoStatus> {
    let foraDaCarencia = 0
    let ultima: RespostaDoStatus = { success: true }
    while (foraDaCarencia < limite) {
        ultima = await pollDoApp()
        if (agora - carenciaDesde < CARENCIA_MS) {
            expect(modulo.isDlnaSessionActive(), 'derrubou a sessão na carência').toBe(true)
            continue
        }
        foraDaCarencia++
        if (foraDaCarencia < limite) {
            expect(modulo.isDlnaSessionActive(), `encerrou na ${foraDaCarencia}ª consulta, antes do renderer`).toBe(true)
        }
    }
    return ultima
}

/** Espera a CONDIÇÃO (o comando do celular é disparado sem await). */
async function esperar(condicao: () => boolean, rotulo: string): Promise<void> {
    for (let tentativa = 0; tentativa < 200; tentativa++) {
        if (condicao()) return
        await new Promise(resolve => setTimeout(resolve, 1))
    }
    throw new Error(`nunca aconteceu: ${rotulo}`)
}

describe('sessão DLNA que acabou na TV morre no main (D197)', () => {
    beforeEach(async () => {
        vi.resetModules()
        ipc.handlers.clear()
        rede.estado.clear()
        rede.mudas.clear()
        rede.soap.length = 0
        rede.corpos.length = 0
        rede.segurar.clear()
        rede.fila = []
        rede.proxy = null
        rede.remuxes.length = 0
        agora = 1_800_000_000_000
        relogio = vi.spyOn(Date, 'now').mockImplementation(() => agora)
        modulo = await import('./dlnaHandlers')
        modulo.setupDLNAHandlers()
    })

    afterEach(() => {
        relogio.mockRestore()
    })

    it('o filme acabou (STOPPED) — o main encerra na consulta em que o renderer desiste, revoga o token e mata o remux', async () => {
        await castar(TV, FILME_MKV)
        // Remux: a TV pede o stream e o ffmpeg nasce.
        const urlDoRemux = urlEntregueAgora()
        expect(urlDoRemux.includes('/dlna-transcode/'), 'o .mkv tinha que ir pelo remux').toBe(true)
        expect(await pedirAoProxy(urlDoRemux, 'GET')).toBe(200)
        expect(rede.remuxes).toHaveLength(1)

        // Assiste o filme inteiro (passa a carência) tocando.
        for (let t = 0; t < CARENCIA_MS + POLL_MS; t += POLL_MS) {
            expect((await pollDoApp()).state).toBe('PLAYING')
        }
        // Acabou: a TV volta pra STOPPED e fica.
        rede.estado.set(TV, 'STOPPED')
        for (let i = 1; i < POLLS_PARADOS_PRO_RENDERER_DESISTIR; i++) {
            expect((await pollDoApp()).success, `encerrou na ${i}ª consulta parada, antes do renderer`).toBe(true)
        }
        const ultima = await pollDoApp()

        expect(modulo.isDlnaSessionActive(), 'a sessão ficou viva no main depois do filme acabar').toBe(false)
        expect(ultima.success).toBe(false)
        expect(ultima.error ?? '').toMatch(/no active cast session/i)
        expect(await pedirAoProxy(urlDoRemux, 'GET'), 'o token do proxy seguiu valendo').toBe(404)
        expect(rede.remuxes[0].morto, 'o ffmpeg do remux seguiu puxando o stream').toBe(true)
        // Não manda Stop: a TV já está parada.
        expect(rede.soap.filter(passo => passo.endsWith(' Stop'))).toHaveLength(0)
    })

    it('NO_MEDIA_PRESENT também encerra, e o celular deixa de ser sequestrado', async () => {
        await castar(TV)
        agora += CARENCIA_MS + 1
        rede.estado.set(TV, 'NO_MEDIA_PRESENT')

        // Só o celular consultando (o laço de 2 s do controle web).
        let ultima: Awaited<ReturnType<ModuloDlna['getDlnaStatusSnapshot']>> = null
        for (let i = 0; i < POLLS_PARADOS_PRO_RENDERER_DESISTIR; i++) {
            agora += POLL_MS
            ultima = await modulo.getDlnaStatusSnapshot()
        }

        expect(modulo.isDlnaSessionActive(), 'o controle web ficaria consultando a TV parada pra sempre').toBe(false)
        // A consulta que encerrou já não entrega o estado de uma sessão morta.
        expect(ultima, 'o celular recebeu o status de uma sessão que acabou de morrer').toBeNull()
        rede.soap.length = 0
        expect(modulo.dlnaRemoteControl('togglePlay'), 'o play/pausa do celular foi engolido pela sessão morta').toBe(false)
        expect(rede.soap, 'mandou SOAP pra uma TV sem sessão').toHaveLength(0)
    })

    it('TV desligada (SOAP mudo) encerra na falha em que o renderer desiste', async () => {
        await castar(TV)
        agora += CARENCIA_MS + 1
        rede.mudas.add(TV)

        for (let i = 1; i < FALHAS_PRO_RENDERER_DESISTIR; i++) await pollDoApp()
        expect(modulo.isDlnaSessionActive(), 'encerrou antes do renderer desistir').toBe(true)
        const ultima = await pollDoApp()

        expect(modulo.isDlnaSessionActive(), 'a sessão da TV desligada ficou viva').toBe(false)
        expect(ultima.success).toBe(false)
        // A próxima consulta já responde "sem sessão" sem tocar na rede.
        rede.soap.length = 0
        const depois = await pollDoApp()
        expect(depois.error ?? '').toMatch(/no active cast session/i)
        expect(rede.soap).toHaveLength(0)
    })

    it('TV entrando em standby (prazos estourados e recusas na hora, fora de ordem) encerra junto com o renderer', async () => {
        await castar(TV)
        agora += CARENCIA_MS + 1
        rede.mudas.add(TV)

        // As duas primeiras consultas ficam penduradas até estourar o prazo...
        for (const acao of CONSULTA_DE_STATUS) rede.segurar.add(acao)
        const lentas = [pollDoApp(), pollDoApp()]
        await esperar(() => rede.fila.length === 4, 'consultas penduradas')
        rede.segurar.clear()

        // ...as seguintes são recusadas na hora, e as penduradas só chegam no
        // fim: a última resposta que o renderer conta é a da consulta MAIS
        // ANTIGA.
        for (let i = 2; i < FALHAS_PRO_RENDERER_DESISTIR; i++) await pollDoApp()
        soltar()
        await Promise.all(lentas)

        expect(modulo.isDlnaSessionActive(), 'o renderer desistiu e a sessão ficou viva no main').toBe(false)
    })

    it('resposta lenta no começo da rajada de STOPPED não atrasa o fim', async () => {
        await castar(TV)
        agora += CARENCIA_MS + 1
        rede.estado.set(TV, 'STOPPED')

        for (const acao of CONSULTA_DE_STATUS) rede.segurar.add(acao)
        const lenta = pollDoApp()
        await esperar(() => rede.fila.length === 2, 'consulta pendurada')
        rede.segurar.clear()
        await pollDoApp()
        soltar()
        await lenta
        for (let i = 2; i < POLLS_PARADOS_PRO_RENDERER_DESISTIR; i++) await pollDoApp()

        expect(modulo.isDlnaSessionActive(), 'o renderer desistiu e a sessão ficou viva no main').toBe(false)
    })

    const logoDepoisDoCast: [string, () => void, () => number][] = [
        ['STOPPED/NO_MEDIA (TV carregando)', () => rede.estado.set(TV, 'NO_MEDIA_PRESENT'), () => POLLS_PARADOS_PRO_RENDERER_DESISTIR],
        ['SOAP falhando (TV ocupada carregando)', () => rede.mudas.add(TV), () => FALHAS_PRO_RENDERER_DESISTIR],
    ]

    it.each(logoDepoisDoCast)('%s logo depois do cast: nada encerra na carência, e o fim sai junto com o renderer', async (_nome, preparar, limite) => {
        await castar(TV)
        const castEm = agora
        preparar()
        await consultarAteORendererDesistir(castEm, limite())
        expect(modulo.isDlnaSessionActive(), 'a carência do cast segurou a sessão além do renderer').toBe(false)
    })

    const comandos: [string, () => Promise<void>][] = [
        ['pausa do app', async () => { expect((await invocar('dlna:pause')).success).toBe(true) }],
        ['play do app', async () => { expect((await invocar('dlna:resume')).success).toBe(true) }],
        ['seek do app', async () => { expect((await invocar('dlna:seek', { seconds: 600 })).success).toBe(true) }],
        ['play/pausa do celular', async () => {
            const antes = rede.soap.length
            expect(modulo.dlnaRemoteControl('togglePlay')).toBe(true)
            await esperar(() => rede.soap.slice(antes).some(passo => / (Pause|Play)$/.test(passo)), 'play/pausa do celular')
        }],
        ['seek do celular', async () => {
            const antes = rede.soap.length
            expect(modulo.dlnaRemoteControl('seek', 30)).toBe(true)
            await esperar(() => rede.soap.slice(antes).some(passo => passo.endsWith(' Seek')), 'seek do celular')
        }],
    ]

    it.each(comandos)('STOPPED depois de %s (TV reposicionando) só encerra quando a carência acaba', async (_nome, comandar) => {
        await castar(TV)
        agora += CARENCIA_MS + 1
        expect((await pollDoApp()).state).toBe('PLAYING')

        const comandoEm = agora
        await comandar()
        rede.estado.set(TV, 'STOPPED')

        const ultima = await consultarAteORendererDesistir(comandoEm, POLLS_PARADOS_PRO_RENDERER_DESISTIR)
        expect(ultima.error ?? '', 'a carência do comando segurou a sessão além do renderer').toMatch(/no active cast session/i)
    })

    it('STOPPED isolado entre PLAYINGs e falha curta de SOAP não encerram', async () => {
        await castar(TV)
        agora += CARENCIA_MS + 1

        for (let rodada = 0; rodada < 4; rodada++) {
            rede.estado.set(TV, 'STOPPED')
            await pollDoApp()
            await pollDoApp()
            rede.estado.set(TV, 'PLAYING')
            await pollDoApp()
        }
        expect(modulo.isDlnaSessionActive(), 'STOPPED intercalado derrubou a sessão').toBe(true)

        for (let rodada = 0; rodada < 3; rodada++) {
            rede.mudas.add(TV)
            await pollDoApp()
            await pollDoApp()
            await pollDoApp()
            rede.mudas.delete(TV)
            await pollDoApp()
        }
        expect(modulo.isDlnaSessionActive(), 'falha curta de SOAP derrubou a sessão').toBe(true)
    })

    it('app e celular consultando juntos não cortam a tolerância pela metade', async () => {
        await castar(TV)
        agora += CARENCIA_MS + 1
        rede.estado.set(TV, 'STOPPED')

        // Oito observações em 3,5 s: contar consultas encerraria aqui.
        for (let i = 0; i < 4; i++) {
            await pollDoApp(i === 0 ? 0 : 500)
            agora += 500
            await modulo.getDlnaStatusSnapshot()
        }
        expect(modulo.isDlnaSessionActive(), 'encerrou por número de consultas, não por tempo').toBe(true)

        for (let i = 0; i < 4 && modulo.isDlnaSessionActive(); i++) await pollDoApp()
        expect(modulo.isDlnaSessionActive()).toBe(false)
    })

    it('um cast novo depois do fim automático começa limpo (carência nova)', async () => {
        await castar(TV)
        agora += CARENCIA_MS + 1
        rede.estado.set(TV, 'STOPPED')
        for (let i = 0; i < POLLS_PARADOS_PRO_RENDERER_DESISTIR; i++) await pollDoApp()
        expect(modulo.isDlnaSessionActive()).toBe(false)

        // A outra TV também diz STOPPED enquanto carrega: não pode herdar a
        // rajada da sessão velha e morrer na primeira consulta.
        rede.estado.set(OUTRA_TV, 'STOPPED')
        await castar(OUTRA_TV)
        const status = await pollDoApp()
        expect(status.success, `a sessão nova morreu na largada: ${status.error}`).toBe(true)
        expect(modulo.isDlnaSessionActive()).toBe(true)
    })

    it('resposta atrasada da sessão velha não derruba o cast novo pra MESMA TV', async () => {
        const id = await castar(TV)
        agora += CARENCIA_MS + 1
        rede.estado.set(TV, 'STOPPED')
        await pollDoApp()

        // A consulta que fecharia a janela da sessão velha fica pendurada...
        for (const acao of CONSULTA_DE_STATUS) rede.segurar.add(acao)
        const atrasada = pollDoApp(POLLS_PARADOS_PRO_RENDERER_DESISTIR * POLL_MS)
        await esperar(() => rede.fila.length === 2, 'consulta pendurada')
        rede.segurar.clear()

        // ...o dono manda o filme de novo pra mesma TV, e ela demora pra aceitar.
        rede.segurar.add('SetAVTransportURI')
        const recast = invocar('dlna:cast', { deviceId: id, url: FILME_MKV, title: 'Filme' })
        await esperar(() => rede.fila.some(item => item.acao === 'SetAVTransportURI'), 'cast novo carregando')
        const urlNova = urlEntregueAgora()

        // A resposta velha chega no meio do carregamento.
        soltar(CONSULTA_DE_STATUS)
        await atrasada
        rede.segurar.clear()
        soltar()

        expect((await recast).success).toBe(true)
        expect(modulo.isDlnaSessionActive()).toBe(true)
        expect(await pedirAoProxy(urlNova, 'GET'), 'a resposta velha revogou o token do cast novo').toBe(200)
    })
})

describe('janelas do fim automático (dlnaFimDaSessao, puro)', () => {
    const COMANDO = 1_000_000
    const FORA = COMANDO + DLNA_CARENCIA_APOS_COMANDO_MS
    const parada = { tipo: 'estado', estado: 'STOPPED' } as const
    const falha = { tipo: 'falha' } as const

    it('as janelas do main cabem na tolerância do renderer', () => {
        expect(DLNA_CARENCIA_APOS_COMANDO_MS, 'carência diferente da do CastControls').toBe(CARENCIA_MS)
        expect(DLNA_PARADA_PARA_ENCERRAR_MS).toBeLessThanOrEqual((POLLS_PARADOS_PRO_RENDERER_DESISTIR - 1) * POLL_MS)
        expect(DLNA_SILENCIO_PARA_ENCERRAR_MS).toBeLessThanOrEqual((FALHAS_PRO_RENDERER_DESISTIR - 1) * POLL_MS)
    })

    it('a carência vale até o último milissegundo', () => {
        const dentro = registrarObservacaoDlna(novoRelogioDoFimDlna(COMANDO), parada, FORA - 1).relogio
        expect(registrarObservacaoDlna(dentro, parada, FORA - 1 + DLNA_PARADA_PARA_ENCERRAR_MS).encerrar).toBeNull()
        const fora = registrarObservacaoDlna(novoRelogioDoFimDlna(COMANDO), parada, FORA).relogio
        expect(registrarObservacaoDlna(fora, parada, FORA + DLNA_PARADA_PARA_ENCERRAR_MS).encerrar).toBe('parada')
    })

    it('a parada fecha exatamente na janela, nem 1 ms antes', () => {
        const aberta = registrarObservacaoDlna(novoRelogioDoFimDlna(COMANDO), parada, FORA).relogio
        expect(registrarObservacaoDlna(aberta, parada, FORA + DLNA_PARADA_PARA_ENCERRAR_MS - 1).encerrar).toBeNull()
        expect(registrarObservacaoDlna(aberta, parada, FORA + DLNA_PARADA_PARA_ENCERRAR_MS).encerrar).toBe('parada')
    })

    it('o silêncio fecha exatamente na janela, nem 1 ms antes', () => {
        const aberta = registrarObservacaoDlna(novoRelogioDoFimDlna(COMANDO), falha, FORA).relogio
        expect(registrarObservacaoDlna(aberta, falha, FORA + DLNA_SILENCIO_PARA_ENCERRAR_MS - 1).encerrar).toBeNull()
        expect(registrarObservacaoDlna(aberta, falha, FORA + DLNA_SILENCIO_PARA_ENCERRAR_MS).encerrar).toBe('silencio')
    })
})
