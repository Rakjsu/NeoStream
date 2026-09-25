/**
 * 📡 O contrato do `cast:discover` que o "Buscar na rede" do seletor usa (D096).
 *
 * O handler NÃO espera respostas: cutuca o mDNS (`browser.update()`) e devolve
 * o mapa de aparelhos como ele está naquele instante. Quem responde ao cutucão
 * chega depois, pelo evento 'up', e só aparece na leitura SEGUINTE. É por isso
 * que o CastDeviceSelector relê o Chromecast quando a varredura DLNA termina —
 * e é isto que este teste prende: se o handler parar de cutucar, ou de devolver
 * o mapa vivo, o botão volta a não achar o Chromecast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Manipulador = (event: unknown, ...args: unknown[]) => unknown

const estado = vi.hoisted(() => ({
    handlers: new Map<string, Manipulador>(),
    ouvintesDoBrowser: new Map<string, (service: unknown) => void>(),
    cutucoes: 0,
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: Manipulador) => { estado.handlers.set(canal, fn) },
        on: () => undefined,
    },
}))
vi.mock('bonjour-service', () => ({
    Bonjour: class {
        find() {
            return {
                on: (evento: string, fn: (service: unknown) => void) => { estado.ouvintesDoBrowser.set(evento, fn) },
                update: () => { estado.cutucoes++ },
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
    registerCastSubtitleVtt: async () => 'http://192.168.0.2/legenda.vtt',
}))

type Resposta = { success: boolean; devices: { id: string; name: string; host: string; model: string }[] }

const descobrir = async () =>
    await (estado.handlers.get('cast:discover') as Manipulador)(null) as Resposta

describe('cast:discover — cutuca o mDNS e devolve o mapa vivo', () => {
    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.ouvintesDoBrowser.clear()
        estado.cutucoes = 0
        const mod = await import('./castHandlers')
        mod.setupCastHandlers()
    })

    it('cada chamada cutuca o mDNS; quem responde depois aparece na leitura seguinte', async () => {
        const primeira = await descobrir()
        expect(estado.cutucoes).toBe(1)
        expect(primeira).toEqual({ success: true, devices: [] })

        // A TV responde ao cutucão DEPOIS que o handler já devolveu.
        estado.ouvintesDoBrowser.get('up')?.({
            fqdn: 'sala._googlecast._tcp.local',
            name: 'Chromecast-sala',
            addresses: ['192.168.0.42'],
            txt: { fn: 'TV da Sala', md: 'Chromecast Ultra' },
        })

        const segunda = await descobrir()
        expect(estado.cutucoes).toBe(2)
        expect(segunda).toEqual({
            success: true,
            devices: [{ id: 'sala._googlecast._tcp.local', name: 'TV da Sala', host: '192.168.0.42', model: 'Chromecast Ultra' }],
        })
    })
})
