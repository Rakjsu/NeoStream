import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CastDeviceSelector } from './CastDeviceSelector'

/**
 * "Adicionar TV" com um IP onde ninguém responde (D199).
 *
 * O main sonda a descrição UPnP naquele IP; quando nenhuma sonda responde ele
 * ainda salva a TV (pode só estar desligada), mas marca `unverified: true`.
 * A tela tratava a resposta como um booleano: voltava pra lista em silêncio,
 * igual a uma TV que respondeu — e o IP digitado errado só aparecia na hora
 * do cast falhar. O invariante preso aqui: sem verificação, a lista mostra um
 * aviso nomeando o IP; com verificação, nada de aviso.
 */

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

const IP = '192.168.0.77'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function montar() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root!.render(<CastDeviceSelector {...propsBase} />) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

async function clicar(el: Element) {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

/** Digita num input controlado do React (o setter nativo + evento input). */
async function digitar(input: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
        setter.call(input, valor)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function el<T extends Element>(seletor: string): T {
    const achado = container!.querySelector(seletor)
    if (!achado) throw new Error(`nao achei ${seletor} na tela`)
    return achado as T
}

/** Espera a CONDICAO (o cadastro e o recarregamento da lista são assíncronos). */
async function esperar(condicao: () => boolean, rotulo: string) {
    for (let tentativa = 0; tentativa < 200; tentativa++) {
        if (condicao()) return
        await act(async () => { await new Promise(r => setTimeout(r, 1)) })
    }
    throw new Error(`nunca aconteceu: ${rotulo}`)
}

async function cadastrarPelaTela(respostaDoMain: Record<string, unknown>) {
    let cadastrou = false
    const tv = { id: `manual-${IP}-9197`, name: `TV (${IP})`, host: IP, port: 9197, location: `http://${IP}:9197/dmr` }
    const invoke = mockIpc({
        'dlna:get-devices': () => ({ success: true, devices: cadastrou ? [{ ...tv, source: 'manual', online: true }] : [] }),
        'dlna:discover': () => ({ success: true, devices: [] }),
        'airplay:discover': () => ({ success: true, devices: [] }),
        'cast:discover': () => ({ success: true, devices: [] }),
        'dlna:add-device': () => { cadastrou = true; return { success: true, device: tv, ...respostaDoMain } },
    })
    await montar()

    await clicar(el('button.add-device-btn'))
    await digitar(el<HTMLInputElement>('input[placeholder="192.168.1.100"]'), IP)
    await clicar(el('button.submit-btn'))

    // Voltou pra lista, com a TV nova nela.
    await esperar(() => container!.querySelector('button.add-device-btn') !== null
        && (container!.textContent ?? '').includes(`TV (${IP})`), 'voltar pra lista com a TV nova')
    expect(invoke.mock.calls.some(([canal]) => canal === 'dlna:add-device')).toBe(true)
}

function avisoDeErro(): string | null {
    return container!.querySelector('.cast-error')?.textContent ?? null
}

beforeEach(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
})

describe('CastDeviceSelector — TV adicionada por IP que não respondeu (D199)', () => {
    it('ninguém respondeu no IP: a TV entra na lista, mas a tela avisa nomeando o IP', async () => {
        await cadastrarPelaTela({ unverified: true })

        const aviso = avisoDeErro()
        expect(aviso, 'voltou pra lista em silêncio, como se a TV tivesse respondido').not.toBeNull()
        expect(aviso!.includes(IP)).toBe(true)
        expect(aviso!.includes('não respondeu')).toBe(true)
    })

    it('guarda: a TV respondeu — volta pra lista sem aviso nenhum', async () => {
        await cadastrarPelaTela({})

        expect(avisoDeErro()).toBeNull()
    })

    it('enquanto o main sonda o IP, o "Adicionar TV" fica ocupado: clique repetido não cadastra de novo', async () => {
        let responder: (resposta: unknown) => void = () => { }
        const invoke = mockIpc({
            'dlna:get-devices': () => ({ success: true, devices: [] }),
            'dlna:discover': () => ({ success: true, devices: [] }),
            'airplay:discover': () => ({ success: true, devices: [] }),
            'cast:discover': () => ({ success: true, devices: [] }),
            // O main ainda está sondando: a resposta só vem quando o teste mandar.
            'dlna:add-device': () => new Promise(resolve => { responder = resolve }),
        })
        await montar()

        await clicar(el('button.add-device-btn'))
        await digitar(el<HTMLInputElement>('input[placeholder="192.168.1.100"]'), IP)
        const botao = el<HTMLButtonElement>('button.submit-btn')
        expect(botao.disabled).toBe(false)

        await clicar(botao)
        await clicar(botao)
        await clicar(botao)

        const cadastros = () => invoke.mock.calls.filter(([canal]) => canal === 'dlna:add-device').length
        expect(cadastros(), 'cada clique durante a espera disparou outro cadastro').toBe(1)
        expect(el<HTMLButtonElement>('button.submit-btn').disabled).toBe(true)

        // O main respondeu que não salvou: o botão volta a aceitar clique.
        await act(async () => { responder({ success: false, error: 'falhou' }) })
        await esperar(() => !el<HTMLButtonElement>('button.submit-btn').disabled, 'o botão voltar a aceitar clique')
        expect(cadastros()).toBe(1)
    })
})
