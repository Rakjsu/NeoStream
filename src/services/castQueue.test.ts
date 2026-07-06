import { describe, it, expect, vi, beforeEach } from 'vitest'
import { castResolvedQueue, buildSeasonTailQueue } from './castQueue'

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

describe('buildSeasonTailQueue', () => {
    beforeEach(() => vi.restoreAllMocks())

    const seasonInfo = {
        success: true,
        info: {
            episodes: {
                '2': [
                    { id: 201, episode_num: 1, title: 'Serie S02E01 - Abertura', container_extension: 'mkv' },
                    { id: 202, episode_num: 2, title: 'Serie S02E02 - Meio' },
                    { id: 203, episode_num: 3, title: 'Serie S02E03 - Final' },
                ],
            },
        },
    }

    it('monta a fila do episódio atual em diante, com meta por item', async () => {
        mockIpc({
            'series:get-info': () => seasonInfo,
            'streams:get-series-url': (p) => {
                const { streamId } = p as { streamId: number }
                return { success: true, url: `http://x/${streamId}.mp4` }
            },
        })
        const queue = await buildSeasonTailQueue('55', 2, 2)
        expect(queue).toHaveLength(2)
        expect(queue[0].url).toBe('http://x/202.mp4')
        expect(queue[0].title).toBe('T2:E2 · Meio')
        expect(queue[0].meta).toEqual({ contentId: '55', contentType: 'series', season: 2, episode: 2, title: 'Meio' })
        expect(queue[1].meta?.episode).toBe(3)
    })

    it('episódio sem URL resolvida é pulado (fila continua com o resto)', async () => {
        mockIpc({
            'series:get-info': () => seasonInfo,
            'streams:get-series-url': (p) => {
                const { streamId } = p as { streamId: number }
                return streamId === 202
                    ? { success: false }
                    : { success: true, url: `http://x/${streamId}.mp4` }
            },
        })
        const queue = await buildSeasonTailQueue('55', 2, 1)
        expect(queue.map(i => i.meta?.episode)).toEqual([1, 3])
    })

    it('série/temporada irresolúvel → lista vazia (caller cai no cast único)', async () => {
        mockIpc({ 'series:get-info': () => ({ success: false }) })
        expect(await buildSeasonTailQueue('55', 2, 1)).toEqual([])
    })
})
