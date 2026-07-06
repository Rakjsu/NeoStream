import { describe, it, expect, vi, beforeEach } from 'vitest'
import { castResolvedQueue } from './castQueue'

/** Stub window.ipcRenderer.invoke with a per-channel router. */
function mockIpc(handlers: Record<string, (payload?: unknown) => unknown>) {
    const invoke = vi.fn((channel: string, payload?: unknown) => {
        const h = handlers[channel]
        return Promise.resolve(h ? h(payload) : { success: false })
    })
    ;(globalThis as unknown as { window: { ipcRenderer: { invoke: typeof invoke } } }).window = {
        ipcRenderer: { invoke },
    }
    return invoke
}

describe('castResolvedQueue', () => {
    beforeEach(() => vi.restoreAllMocks())

    it('enfileira no primeiro dispositivo e devolve a contagem', async () => {
        const invoke = mockIpc({
            'cast:discover': () => ({ success: true, devices: [{ id: 'd1', name: 'Sala' }] }),
            'cast:play-queue': () => ({ success: true, count: 2 }),
        })
        const res = await castResolvedQueue([{ url: 'http://a', title: 'A' }, { url: 'http://b', title: 'B' }])
        expect(res).toEqual({ status: 'ok', count: 2, deviceName: 'Sala' })
        // A fila enviada só contém itens com URL.
        expect(invoke).toHaveBeenCalledWith('cast:play-queue', {
            deviceId: 'd1',
            items: [{ url: 'http://a', title: 'A' }, { url: 'http://b', title: 'B' }],
        })
    })

    it('sem dispositivo → no-device (antes de conferir a fila)', async () => {
        mockIpc({ 'cast:discover': () => ({ success: true, devices: [] }) })
        expect(await castResolvedQueue([])).toEqual({ status: 'no-device' })
    })

    it('com dispositivo mas sem URLs resolvidas → empty', async () => {
        mockIpc({ 'cast:discover': () => ({ success: true, devices: [{ id: 'd1', name: 'Sala' }] }) })
        expect(await castResolvedQueue([{ url: '', title: 'X' }])).toEqual({ status: 'empty' })
    })

    it('falha do play-queue → error com o nome do dispositivo', async () => {
        mockIpc({
            'cast:discover': () => ({ success: true, devices: [{ id: 'd1', name: 'Quarto' }] }),
            'cast:play-queue': () => ({ success: false }),
        })
        expect(await castResolvedQueue([{ url: 'http://a', title: 'A' }]))
            .toEqual({ status: 'error', deviceName: 'Quarto' })
    })
})
