import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CastDeviceSelector } from './CastDeviceSelector'

/**
 * D096 — o botão "Buscar na rede" do seletor de cast só procurava TV DLNA.
 * O componente tirava `discoverDevices` apenas do useDLNA; do useAirPlay e do
 * useChromecast pegava só `devices` e `castToDevice`. O clique disparava
 * `dlna:discover` e mais nada — a Apple TV só aparecia na próxima volta de
 * 30 s do useAirPlay, e o Chromecast na de 10 s do useChromecast.
 *
 * A rede falsa daqui imita o main de verdade:
 * - `cast:discover` (castHandlers.ts) só CUTUCA o mDNS e devolve o mapa como
 *   ele está NAQUELE instante; quem responde ao cutucão entra no mapa depois;
 * - `airplay:discover` (airplayHandlers.ts) cutuca e espera antes de devolver;
 * - `dlna:discover` é a varredura SSDP, a mais lenta das três.
 *
 * Invariantes presos aqui:
 * 1. abrir o seletor faz UMA busca por protocolo (o componente não repete a
 *    busca de montagem que os hooks de AirPlay/Chromecast já fazem);
 * 2. o clique pede busca aos TRÊS protocolos;
 * 3. um aparelho que só responde DEPOIS do clique (TV ligada agora) entra na
 *    lista sem esperar os timers dos hooks — inclusive o Chromecast, que só
 *    chega ao mapa depois do cutucão e por isso precisa ser relido.
 * A espera é pela CONDIÇÃO (o aparelho na tela), com teto bem abaixo dos
 * 10 s / 30 s dos timers: só o clique explica o sucesso.
 */

/** Roteador de canais no window.ipcRenderer (os três hooks só usam invoke). */
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

/** Bem abaixo da volta de 10 s do useChromecast (e dos 30 s do useAirPlay). */
const TETO_MS = 4000

let root: Root | null = null
let container: HTMLDivElement | null = null
const timersDaRede: ReturnType<typeof setTimeout>[] = []

function depois<T>(ms: number, valor: () => T): Promise<T> {
    return new Promise(resolve => { timersDaRede.push(setTimeout(() => resolve(valor()), ms)) })
}

async function montar() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root!.render(<CastDeviceSelector {...propsBase} />) })
}

/** Espera a condição (nunca um número fixo de voltas); estoura com a mensagem. */
async function esperarAte(condicao: () => boolean, mensagem: () => string, tetoMs = TETO_MS) {
    const inicio = Date.now()
    while (!condicao()) {
        if (Date.now() - inicio > tetoMs) throw new Error(mensagem())
        await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    }
}

function nomesNaLista() {
    return Array.from(container!.querySelectorAll('button.device-item')).map(b => b.textContent ?? '')
}

function botaoBuscar() {
    const alvo = Array.from(container!.querySelectorAll('button'))
        .find(b => (b.textContent ?? '').includes('Buscar na rede'))
    if (!alvo) throw new Error('botão "Buscar na rede" não está na tela')
    return alvo as HTMLButtonElement
}

function chamadas(invoke: ReturnType<typeof mockIpc>, canal: string) {
    return invoke.mock.calls.filter(c => c[0] === canal).length
}

beforeEach(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    while (timersDaRede.length) clearTimeout(timersDaRede.pop())
    vi.restoreAllMocks()
})

describe('CastDeviceSelector — "Buscar na rede" cobre os três protocolos (D096)', () => {
    it('o clique procura Chromecast e AirPlay também, e quem respondeu depois entra na lista', async () => {
        // Até o clique a rede "não tem ninguém"; depois dele, a TV ligada
        // agora responde nos três protocolos — cada um no seu ritmo.
        let tvLigada = false
        let mapaDoCast: { id: string; name: string; host: string; model: string }[] = []
        const invoke = mockIpc({
            'dlna:get-devices': () => ({ success: false, devices: [] }),
            // SSDP: a varredura mais lenta das três.
            'dlna:discover': () => (tvLigada
                ? depois(150, () => ({ success: true, devices: [{ id: 'tv1', name: 'TV da Sala', host: '192.168.0.10' }] }))
                : { success: true, devices: [] }),
            // mDNS do Chromecast: devolve o mapa de AGORA; a resposta ao
            // cutucão só entra no mapa um pouco depois.
            'cast:discover': () => {
                const agora = [...mapaDoCast]
                if (tvLigada) {
                    void depois(30, () => {
                        mapaDoCast = [{ id: 'cc1', name: 'Sala (Chromecast)', host: '192.168.0.20', model: 'Chromecast' }]
                    })
                }
                return { success: true, devices: agora }
            },
            // mDNS do AirPlay: cutuca e espera antes de devolver.
            'airplay:discover': () => (tvLigada
                ? depois(50, () => ({ success: true, devices: [{ id: 'ap1', name: 'Apple TV do Quarto', host: '192.168.0.30' }] }))
                : { success: true, devices: [] }),
        })
        await montar()

        // Assenta a abertura: as buscas de montagem já foram e voltaram
        // vazias, e o botão saiu do estado "Buscando...".
        await esperarAte(
            () => chamadas(invoke, 'cast:discover') >= 1
                && chamadas(invoke, 'airplay:discover') >= 1
                && !botaoBuscar().disabled,
            () => 'a abertura do seletor não assentou',
        )
        expect(nomesNaLista()).toEqual([])
        // Abrir = uma busca por protocolo, sem repetir a dos hooks.
        expect({
            dlna: chamadas(invoke, 'dlna:discover'),
            cast: chamadas(invoke, 'cast:discover'),
            airplay: chamadas(invoke, 'airplay:discover'),
        }).toEqual({ dlna: 1, cast: 1, airplay: 1 })

        tvLigada = true
        await act(async () => { botaoBuscar().dispatchEvent(new MouseEvent('click', { bubbles: true })) })

        // O clique pediu uma busca a CADA protocolo, não só ao DLNA.
        expect(chamadas(invoke, 'dlna:discover')).toBe(2)
        expect(chamadas(invoke, 'cast:discover')).toBeGreaterThan(1)
        expect(chamadas(invoke, 'airplay:discover')).toBe(2)

        // E o que respondeu depois aparece sem esperar os timers de 10 s / 30 s.
        await esperarAte(
            () => ['TV da Sala', 'Sala (Chromecast)', 'Apple TV do Quarto']
                .every(nome => nomesNaLista().some(t => t.includes(nome))),
            () => `depois do clique a lista tem só: [${nomesNaLista().join(' | ')}]`,
        )
    }, 15000)
})
