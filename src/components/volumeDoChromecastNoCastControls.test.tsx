import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CastControls } from './CastControls'
import { languageService } from '../services/languageService'

/**
 * 🔊 O slider de volume do Chromecast na tela (D200).
 *
 * O CastControls só desenha o slider quando o status traz `volume !== null`.
 * Com Chromecast o main só conhecia o volume que o PRÓPRIO app mandava, e o
 * único jeito de mandar era esse mesmo slider: o bloco nunca aparecia. Agora o
 * `cast:get-status` traz o volume que a TV anuncia (0..1); aqui se prende a
 * outra metade do caminho — o adaptador `chromecastControls` converte para a
 * escala do slider (0..100) e o CastControls desenha e devolve o nível.
 */

function mockIpc(handlers: Record<string, (payload?: unknown) => unknown>) {
    const invoke = vi.fn((channel: string, payload?: unknown) => {
        const h = handlers[channel]
        return Promise.resolve(h ? h(payload) : { success: true })
    })
    const fake = { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() }
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = fake
    return invoke
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function montar() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(
            <CastControls deviceId="chromecast" deviceName="TV da Sala" deviceType="chromecast" onSessionEnded={() => { }} />,
        )
    })
}

const sliderDeVolume = () =>
    container!.querySelector<HTMLInputElement>(`input[aria-label="${languageService.t('cast', 'tvVolume')}"]`)

/** Espera a CONDIÇÃO (o primeiro poll do status é assíncrono). */
async function esperar(condicao: () => boolean, rotulo: string) {
    for (let tentativa = 0; tentativa < 200; tentativa++) {
        if (condicao()) return
        await act(async () => { await new Promise(r => setTimeout(r, 1)) })
    }
    throw new Error(`nunca aconteceu: ${rotulo}`)
}

/** Move um input controlado do React (o setter nativo + evento input). */
async function mover(input: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
        setter.call(input, valor)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

const statusDaTv = (volume: number | null) => ({
    success: true, active: true, playing: true, mediaState: 'PLAYING',
    currentTime: 10, duration: 100, volume, deviceName: 'TV da Sala',
    queue: [], currentItemId: null, meta: { title: 'Filme' },
    subtitleAvailable: false, subtitleEnabled: true, audioTracks: [], activeAudioTrackId: null,
})

afterEach(async () => {
    await act(async () => { root?.unmount() })
    container?.remove()
    root = null
    container = null
})

describe('slider de volume do Chromecast no CastControls (D200)', () => {
    it('aparece com o volume que a TV anunciou, sem ninguém ter mexido nele', async () => {
        mockIpc({ 'cast:get-status': () => statusDaTv(0.35) })
        await montar()
        await esperar(() => sliderDeVolume() !== null, 'slider de volume desenhado')
        expect(sliderDeVolume()!.value).toBe('35')
    })

    it('mexer no slider manda o nível 0..1 para a TV', async () => {
        const invoke = mockIpc({ 'cast:get-status': () => statusDaTv(0.35) })
        await montar()
        await esperar(() => sliderDeVolume() !== null, 'slider de volume desenhado')
        await mover(sliderDeVolume()!, '50')
        await esperar(
            () => invoke.mock.calls.some(([canal]) => canal === 'cast:set-volume'),
            'cast:set-volume enviado',
        )
        expect(invoke).toHaveBeenCalledWith('cast:set-volume', { level: 0.5 })
    })

    it('sem volume anunciado (aparelho de volume fixo) o slider fica escondido', async () => {
        const invoke = mockIpc({ 'cast:get-status': () => statusDaTv(null) })
        await montar()
        await esperar(
            () => invoke.mock.calls.some(([canal]) => canal === 'cast:get-status') && container!.textContent!.includes('Filme'),
            'primeiro status na tela',
        )
        expect(sliderDeVolume()).toBeNull()
    })
})
