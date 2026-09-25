/**
 * 📺 A falha do `dlna:cast` tem que sair com um CÓDIGO estável (#D098).
 *
 * O main redigia em PT-BR os textos que explicam a falha pra uma pessoa (TV
 * recusou o stream com UPnP 704; tempo esgotado) e a tela exibia o texto cru
 * — em português para quem usa o app em inglês ou espanhol. O conserto: o
 * `dlna:cast` devolve `{ success:false, code, error }`, a tela traduz o
 * `code` (src/services/falhaDoCastDlna.ts) e o `error` continua como está,
 * como reserva para quem não conhece o código.
 *
 * Roda o handler DE VERDADE: só `electron`, `http`, `node-fetch`, o logger, a
 * política de certificado e o caminho do ffmpeg são falsos. A "TV" responde
 * o SOAP com a falha 704 de verdade, ou cala até o prazo do pedido estourar.
 * Nada disso lê o fonte.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rede = vi.hoisted(() => ({
    /** O que a TV faz com cada SOAP: responde a falha 704, ou cala. */
    tv: 'recusa704' as 'recusa704' | 'muda',
    /** Ações SOAP que saíram, na ordem. */
    acoes: [] as string[],
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

// Sem ffmpeg: todo stream remoto segue pelo proxy direto (sem remux).
vi.mock('./ffmpegPath', () => ({ resolveFfmpegPath: () => null }))

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
        if (/\/(dmr|description\.xml|DeviceDescription\.xml|rootDesc\.xml)$/.test(String(url))) {
            return { ok: true, status: 200, text: async () => DESCRICAO }
        }
        const cabecalhos: Record<string, string> = { 'content-type': 'video/mp4', 'content-length': '12345' }
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
        statusCode = 500
    }

    function request(opcoes: { headers?: Record<string, string | number> }, aoResponder: (resposta: unknown) => void) {
        const pedido = new EventEmitter() as InstanceType<typeof EventEmitter> & {
            end: (corpo?: Buffer) => void
            destroy: () => void
        }
        const acao = String(opcoes.headers?.SOAPAction ?? '').split('#')[1]?.replace(/"$/, '') ?? ''
        pedido.end = () => {
            rede.acoes.push(acao)
            setTimeout(() => {
                if (rede.tv === 'muda') {
                    // É o que o http real faz quando o prazo do pedido estoura.
                    pedido.emit('timeout')
                    return
                }
                const resposta = new RespostaFalsa()
                aoResponder(resposta)
                resposta.emit('data', Buffer.from(
                    '<s:Envelope><s:Body><s:Fault><detail><UPnPError>' +
                    '<errorCode>704</errorCode><errorDescription>Local restrictions</errorDescription>' +
                    '</UPnPError></detail></s:Fault></s:Body></s:Envelope>',
                    'utf8'
                ))
                resposta.emit('end')
            }, 0)
        }
        pedido.destroy = () => undefined
        return pedido
    }

    function createServer() {
        const servidor = new EventEmitter() as InstanceType<typeof EventEmitter> & {
            listen: (porta: number, host: string, pronto: () => void) => unknown
            address: () => { port: number }
            close: () => void
        }
        servidor.listen = (_porta: number, _host: string, pronto: () => void) => {
            pronto()
            return servidor
        }
        servidor.address = () => ({ port: 48124 })
        servidor.close = () => undefined
        return servidor
    }

    return { default: { request, createServer }, request, createServer }
})

type RespostaDoCast = { success: boolean; code?: string; error?: string }

const invocar = (canal: string, carga?: unknown) => {
    const handler = ipc.handlers.get(canal)
    if (!handler) throw new Error(`handler ${canal} não registrado`)
    return handler(null, carga) as Promise<RespostaDoCast>
}

async function cadastrarTv(ip: string): Promise<string> {
    const resultado = await invocar('dlna:add-device', { name: 'TV da Sala', ip }) as unknown as
        { success: boolean; device?: { id: string } }
    expect(resultado.success, 'cadastro da TV falhou').toBe(true)
    return resultado.device?.id ?? `manual-${ip}-9197`
}

const TEXTO_PT_HLS = 'A TV recusou este stream HLS (erro 704). Tente um filme/série (MP4) ou reproduza localmente.'
const TEXTO_PT_FORMATO = 'A TV recusou o formato deste vídeo (erro 704). O container pode não ser suportado pela TV (ex.: MKV) — tente outra versão do conteúdo.'
const TEXTO_PT_TEMPO = 'Tempo esgotado — verifique se a TV está ligada, na mesma rede e com DLNA habilitado.'

describe('dlna:cast devolve um código estável junto do texto (#D098)', () => {
    let tv: string

    beforeEach(async () => {
        vi.resetModules()
        ipc.handlers.clear()
        rede.tv = 'recusa704'
        rede.acoes.length = 0
        const modulo = await import('./dlnaHandlers')
        modulo.setupDLNAHandlers()
        tv = await cadastrarTv('192.168.0.10')
    })

    it('TV recusa um HLS com 704: code hls-refused-704, e o texto de hoje fica de reserva', async () => {
        const r = await invocar('dlna:cast', { deviceId: tv, url: 'http://provedor.exemplo/series/ep1.m3u8', title: 'Ep 1' })

        expect(rede.acoes.includes('SetAVTransportURI')).toBe(true)
        expect(r.success).toBe(false)
        expect(r.code).toBe('hls-refused-704')
        expect(r.error).toBe(TEXTO_PT_HLS)
    })

    it('TV recusa o formato com 704: code format-refused-704', async () => {
        const r = await invocar('dlna:cast', { deviceId: tv, url: 'http://provedor.exemplo/filmes/a.mkv', title: 'A' })

        expect(r.success).toBe(false)
        expect(r.code).toBe('format-refused-704')
        expect(r.error).toBe(TEXTO_PT_FORMATO)
    })

    it('TV cala até o prazo estourar: code timeout', async () => {
        rede.tv = 'muda'
        const r = await invocar('dlna:cast', { deviceId: tv, url: 'http://provedor.exemplo/filmes/a.mp4', title: 'A' })

        expect(r.success).toBe(false)
        expect(r.code).toBe('timeout')
        expect(r.error).toBe(TEXTO_PT_TEMPO)
    })

    it('aparelho que não existe: code device-not-found, sem nenhum SOAP', async () => {
        const r = await invocar('dlna:cast', { deviceId: 'manual-10.0.0.99-9197', url: 'http://provedor.exemplo/filmes/a.mp4', title: 'A' })

        expect(r.success).toBe(false)
        expect(r.code).toBe('device-not-found')
        expect(typeof r.error).toBe('string')
        expect(rede.acoes).toEqual([])
    })
})
