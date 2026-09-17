import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CastDeviceSelector } from './CastDeviceSelector'

/**
 * Escolher a TV deixava a tela MUDA: o unico efeito do estado `casting` era
 * apagar a lista (`.device-item.disabled` = opacity .5 + pointer-events none).
 * E a espera e longa por desenho — LAUNCH do Chromecast 15 s
 * (castClient.ts LAUNCH_TIMEOUT_MS), cada acao SOAP do DLNA 10 s
 * (dlnaHandlers.ts) — entao o app parecia travado.
 *
 * O invariante preso aqui: ENQUANTO a resposta do cast nao chega existe um
 * aviso de estado nomeando o aparelho escolhido; quando chega, o aviso some.
 * A espera e um promise pendurado (a janela real de 10-25 s), sem timer falso.
 */

/** Promise que o teste segura pendurada — o cast "em andamento". */
function pendurado<T>() {
    let resolver!: (valor: T) => void
    const promise = new Promise<T>(r => { resolver = r })
    return { promise, resolver }
}

/** Roteador de canais no window.ipcRenderer (os tres hooks so usam invoke). */
function mockIpc(handlers: Record<string, (payload?: unknown) => unknown>) {
    const invoke = vi.fn((channel: string, payload?: unknown) => {
        const h = handlers[channel]
        return Promise.resolve(h ? h(payload) : { success: false, devices: [] })
    })
    const fake = { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() }
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = fake
    return invoke
}

const propsBase = {
    videoUrl: 'http://exemplo/filme.mp4',
    videoTitle: 'Filme',
    onClose: () => { },
    onDeviceSelected: () => { },
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function montar() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root!.render(<CastDeviceSelector {...propsBase} />) })
    // A descoberta de Chromecast/AirPlay sai num setTimeout(0); o DLNA carrega
    // os manuais num queueMicrotask. Um tick real resolve os dois.
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

/** O aviso de estado, achado pela semantica (nao pela classe CSS). */
function aviso() {
    return container!.querySelector('[role="status"]')
}

function botoes() {
    return Array.from(container!.querySelectorAll('button.device-item')) as HTMLButtonElement[]
}

function botaoChamado(nome: string) {
    const alvo = botoes().find(b => b.textContent?.includes(nome))
    if (!alvo) throw new Error(`botao "${nome}" nao esta na lista: ${botoes().map(b => b.textContent).join(' | ')}`)
    return alvo
}

async function clicar(el: HTMLElement) {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

beforeEach(() => {
    // De proposito SEM silenciar console.error: um aviso de "not wrapped in
    // act(...)" do React sai por ali, e abafa-lo esconderia teste furado.
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
})

describe('CastDeviceSelector — aviso de "conectando"', () => {
    it('DLNA: enquanto o SOAP nao responde, a tela diz conectando e nomeia a TV', async () => {
        const cast = pendurado<{ success: boolean }>()
        mockIpc({
            'dlna:get-devices': () => ({ success: false, devices: [] }),
            'dlna:discover': () => ({ success: true, devices: [{ id: 'tv1', name: 'TV da Sala', host: '192.168.0.10' }] }),
            'airplay:discover': () => ({ success: true, devices: [] }),
            'cast:discover': () => ({ success: true, devices: [] }),
            'dlna:cast': () => cast.promise,
        })
        await montar()

        // Ocioso: nenhum aviso, e a lista clicavel.
        expect(aviso()).toBeNull()
        expect(botoes().length).toBe(1)
        expect(botoes()[0].disabled).toBe(false)

        await clicar(botaoChamado('TV da Sala'))

        // Esperando: o aviso existe, diz conectando E diz em qual aparelho.
        const texto = aviso()?.textContent ?? ''
        expect(aviso()).not.toBeNull()
        expect(texto.includes('Conectando')).toBe(true)
        expect(texto.includes('TV da Sala')).toBe(true)
        // O comportamento antigo (lista bloqueada) continua valendo.
        expect(botoes().every(b => b.disabled)).toBe(true)

        // Respondeu: o aviso some.
        await act(async () => { cast.resolver({ success: false }) })
        expect(aviso()).toBeNull()
    })

    it('Chromecast: o mesmo aviso cobre a espera de ate 15 s do LAUNCH', async () => {
        const play = pendurado<{ success: boolean }>()
        mockIpc({
            'dlna:get-devices': () => ({ success: false, devices: [] }),
            'dlna:discover': () => ({ success: true, devices: [] }),
            'airplay:discover': () => ({ success: true, devices: [] }),
            'cast:discover': () => ({ success: true, devices: [{ id: 'cc1', name: 'Sala (Chromecast)', host: '192.168.0.20', model: 'Chromecast' }] }),
            'cast:play': () => play.promise,
        })
        await montar()

        expect(aviso()).toBeNull()
        expect(botoes().length).toBe(1)

        await clicar(botaoChamado('Sala (Chromecast)'))

        const texto = aviso()?.textContent ?? ''
        expect(aviso()).not.toBeNull()
        expect(texto.includes('Conectando')).toBe(true)
        expect(texto.includes('Sala (Chromecast)')).toBe(true)
        expect(botoes().every(b => b.disabled)).toBe(true)

        await act(async () => { play.resolver({ success: false }) })
        expect(aviso()).toBeNull()
    })

    it('AirPlay: o terceiro caminho tambem avisa (a Apple TV era a que ficava de fora)', async () => {
        const cast = pendurado<{ success: boolean }>()
        mockIpc({
            'dlna:get-devices': () => ({ success: false, devices: [] }),
            'dlna:discover': () => ({ success: true, devices: [] }),
            'cast:discover': () => ({ success: true, devices: [] }),
            'airplay:discover': () => ({ success: true, devices: [{ id: 'ap1', name: 'Apple TV do Quarto', host: '192.168.0.30' }] }),
            'airplay:cast': () => cast.promise,
        })
        await montar()

        expect(aviso()).toBeNull()
        expect(botoes().length).toBe(1)

        await clicar(botaoChamado('Apple TV do Quarto'))

        const texto = aviso()?.textContent ?? ''
        expect(aviso()).not.toBeNull()
        expect(texto.includes('Conectando')).toBe(true)
        expect(texto.includes('Apple TV do Quarto')).toBe(true)
        expect(botoes().every(b => b.disabled)).toBe(true)

        await act(async () => { cast.resolver({ success: false }) })
        expect(aviso()).toBeNull()
    })
})
