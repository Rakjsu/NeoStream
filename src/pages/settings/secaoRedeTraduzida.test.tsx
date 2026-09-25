import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NetworkSection } from './NetworkSection'
import { languageService } from '../../services/languageService'
import en from '../../locales/ui/en.json'
import pt from '../../locales/ui/pt.json'
import es from '../../locales/ui/es.json'

/**
 * D100 — a secao Rede das Configuracoes era a unica com o cabecalho cravado
 * em portugues ("Rede e certificados" + a frase do TLS/CORS), e o painel
 * "Controlar outro NeoStream" ignorava o idioma de ponta a ponta: o botao
 * Conectar/Desconectar, os dois erros de conexao, o "Transmitindo: ..." e a
 * dica dos seis botoes de transporte (que mostrava o id cru da acao,
 * "togglePlay", em qualquer idioma — e era o unico nome daqueles botoes, que
 * so tem emoji por dentro).
 *
 * O teste e comportamental: monta a secao de verdade com o app em INGLES,
 * dirige o painel com um WebSocket falso (sem rede) e le o que apareceu na
 * tela. Os textos esperados vem do en.json — nada de string repetida aqui.
 */

type Handler = ((ev: unknown) => void) | null

/** WebSocket falso: guarda a instancia pra o teste disparar open/message/error. */
class WebSocketFalso {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    static instancias: WebSocketFalso[] = []
    /** Endereco que faz o construtor lancar, como o WebSocket real com URL invalida. */
    static urlQueLanca = 'ws://endereco invalido/'
    readyState = 0
    onopen: Handler = null
    onmessage: Handler = null
    onerror: Handler = null
    onclose: Handler = null
    enviados: string[] = []
    url: string
    constructor(url: string) {
        if (url.startsWith(WebSocketFalso.urlQueLanca)) throw new SyntaxError('invalid url')
        this.url = url
        WebSocketFalso.instancias.push(this)
    }
    send(dado: string) { this.enviados.push(dado) }
    close() { this.readyState = 3; this.onclose?.({}) }
}

const ipcFalso = {
    invoke: vi.fn(async () => ({ success: false })),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
}

const WebSocketOriginal = globalThis.WebSocket
let root: Root | null = null
let container: HTMLDivElement | null = null

/** en.json entra por import dinamico: trocar o idioma nao e sincrono. */
async function idiomaIngles() {
    languageService.setLanguage('en')
    await vi.waitFor(() => {
        expect(languageService.t('network', 'peerTitle')).toBe(en.network.peerTitle)
    })
}

beforeAll(async () => {
    ; (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await idiomaIngles()
})

afterAll(() => {
    languageService.setLanguage('pt')
})

beforeEach(async () => {
    WebSocketFalso.instancias = []
        ; (window as unknown as { ipcRenderer: unknown }).ipcRenderer = ipcFalso
        ; (globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocketFalso
    await idiomaIngles()
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
        ; (globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocketOriginal
})

async function montar() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root!.render(<NetworkSection />) })
    return container
}

/** Digita num input controlado do React (setter nativo + evento input). */
async function digitar(input: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
        setter.call(input, valor)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function painelPeer(c: HTMLElement) {
    const endereco = c.querySelector('input[placeholder="192.168.0.20:8974"]') as HTMLInputElement | null
    const pin = c.querySelector('input[placeholder="PIN"]') as HTMLInputElement | null
    if (!endereco || !pin) throw new Error('painel "Controlar outro NeoStream" nao esta na tela')
    const botao = endereco.parentElement!.querySelector('button') as HTMLButtonElement
    return { endereco, pin, botao }
}

/** Preenche endereco + PIN e clica Conectar; devolve o socket falso criado. */
async function conectar(c: HTMLElement, endereco = '192.168.0.20:8974') {
    const painel = painelPeer(c)
    await digitar(painel.endereco, endereco)
    await digitar(painel.pin, '1234')
    await act(async () => { painel.botao.click() })
}

async function conectarEAbrir(c: HTMLElement) {
    await conectar(c)
    await vi.waitFor(() => expect(WebSocketFalso.instancias.length).toBe(1))
    const ws = WebSocketFalso.instancias[0]
    await act(async () => { ws.readyState = 1; ws.onopen?.({}) })
    return ws
}

const texto = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('D100 — secao Rede no idioma do app', () => {
    it('o cabecalho da secao sai em ingles', async () => {
        const c = await montar()
        const cabecalho = c.querySelector('.section-header')
        expect(texto(cabecalho?.querySelector('h2'))).toBe(en.network.title)
        expect(texto(cabecalho?.querySelector('p'))).toBe(en.network.desc)
        expect(texto(c).includes('Rede e certificados')).toBe(false)
        expect(texto(c).includes('Controle de compatibilidade')).toBe(false)
    })

    it('o botao Conectar/Desconectar sai em ingles', async () => {
        const c = await montar()
        expect(texto(painelPeer(c).botao)).toBe(en.network.peerConnect)
        await conectarEAbrir(c)
        await vi.waitFor(() => expect(texto(painelPeer(c).botao)).toBe(en.network.devicesDisconnect))
    })

    it('o erro de conexao recusada sai em ingles', async () => {
        const c = await montar()
        await conectar(c)
        await vi.waitFor(() => expect(WebSocketFalso.instancias.length).toBe(1))
        await act(async () => { WebSocketFalso.instancias[0].onerror?.({}) })

        await vi.waitFor(() => expect(texto(c).includes(en.network.peerConnectError)).toBe(true))
        expect(texto(c).includes(en.network.peerInvalidAddress)).toBe(false)
        expect(texto(c).includes('Não conectou')).toBe(false)
    })

    it('o erro de endereco invalido sai em ingles', async () => {
        const c = await montar()
        await conectar(c, 'endereco invalido')

        await vi.waitFor(() => expect(texto(c).includes(en.network.peerInvalidAddress)).toBe(true))
        expect(texto(c).includes(en.network.peerConnectError)).toBe(false)
        expect(texto(c).includes('Endereço inválido')).toBe(false)
    })

    it('trocar o idioma com o erro na tela troca a frase junto', async () => {
        const c = await montar()
        await conectar(c)
        await vi.waitFor(() => expect(WebSocketFalso.instancias.length).toBe(1))
        await act(async () => { WebSocketFalso.instancias[0].onerror?.({}) })
        await vi.waitFor(() => expect(texto(c).includes(en.network.peerConnectError)).toBe(true))

        // pt vem no pacote: a troca notifica a tela na hora.
        await act(async () => { languageService.setLanguage('pt') })
        await vi.waitFor(() => expect(texto(c).includes(pt.network.peerConnectError)).toBe(true))
        expect(texto(c).includes(en.network.peerConnectError)).toBe(false)
    })

    it('o status "transmitindo" sai em ingles', async () => {
        const c = await montar()
        const ws = await conectarEAbrir(c)
        await act(async () => {
            ws.onmessage?.({ data: JSON.stringify({ type: 'state', casting: true, castTitle: 'Filme $& X', title: '', playing: false }) })
        })

        const esperado = `${en.cast.casting}: Filme $& X`
        await vi.waitFor(() => expect(texto(c).includes(esperado)).toBe(true))
        expect(texto(c).includes('Transmitindo')).toBe(false)
    })

    it('cada botao de transporte tem nome no idioma e manda o id do protocolo', async () => {
        const c = await montar()
        const ws = await conectarEAbrir(c)

        // Os seis botoes so tem emoji por dentro: o nome deles e o aria-label
        // (e o title), e tem que vir do idioma — nunca o id cru. E cada nome
        // tem que estar no botao CERTO: clicar nele manda a acao dele.
        const pares = [
            ['peerPrevious', 'previous'],
            ['peerPlayPause', 'togglePlay'],
            ['peerStop', 'stop'],
            ['peerNext', 'next'],
            ['peerVolumeDown', 'volumeDown'],
            ['peerVolumeUp', 'volumeUp'],
        ] as const
        for (const [chave, acao] of pares) {
            const nome = en.network[chave]
            const botao = c.querySelector(`button[aria-label="${nome}"]`) as HTMLButtonElement | null
            expect(botao, `botao "${nome}"`).not.toBeNull()
            expect(botao!.title).toBe(nome)
            ws.enviados = []
            await act(async () => { botao!.click() })
            expect(ws.enviados).toEqual([JSON.stringify({ action: acao })])
        }
        const nomes = Array.from(c.querySelectorAll('button[aria-label]')).map(b => b.getAttribute('aria-label'))
        expect(nomes.includes('togglePlay')).toBe(false)
    })

    it('as chaves novas existem nos tres idiomas e o ingles nao e copia do portugues', () => {
        const chaves = [
            'title', 'desc', 'peerConnect', 'peerConnectError', 'peerInvalidAddress',
            'peerPrevious', 'peerPlayPause', 'peerStop', 'peerNext', 'peerVolumeDown', 'peerVolumeUp',
        ] as const
        for (const chave of chaves) {
            for (const dicionario of [pt, en, es]) {
                expect(typeof dicionario.network[chave], chave).toBe('string')
            }
            expect(en.network[chave]).not.toBe(pt.network[chave])
        }
    })
})
