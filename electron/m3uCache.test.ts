import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    cachedM3uDocument,
    resetM3uDocumentCache,
    m3uDocumentCacheState,
    M3U_DOC_TTL_MS,
    M3U_FORCE_REFRESH_WINDOW_MS,
} from './m3uCache'
import type { M3uChannel } from './m3uProtocol'

const URL_A = 'http://provedor-a.exemplo/lista.m3u'
const URL_B = 'http://provedor-b.exemplo/lista.m3u'

/** Canais suficientes pra exercitar o classify (live / vod / série). */
function channels(marca: string): M3uChannel[] {
    return [
        { name: `Globo ${marca}`, url: 'http://x/1.ts', group: 'ABERTOS' },
        { name: `Duna ${marca}`, url: 'http://x/2.mp4', group: 'FILMES | Ficção' },
        { name: `Fundação ${marca} S01E01`, url: 'http://x/3.mp4', group: 'SÉRIES | Ficção' },
    ]
}

/** Download controlável: resolve só quando o teste mandar. */
function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

describe('cachedM3uDocument (documento M3U residente no main)', () => {
    beforeEach(() => resetM3uDocumentCache())

    it('baixa uma vez e reusa dentro do TTL — abrir 30 fichas de série = 1 download', async () => {
        const download = vi.fn(async () => channels('A'))
        let now = 1_000_000

        const first = await cachedM3uDocument(URL_A, download, { now })
        for (let i = 0; i < 29; i++) {
            now += 10_000 // ~5 min de navegação
            const again = await cachedM3uDocument(URL_A, download, { now })
            expect(again).toBe(first) // MESMO objeto: nada de reparse
        }
        expect(download).toHaveBeenCalledTimes(1)
    })

    it('classifica uma vez por documento (live/vod/series prontos)', async () => {
        const doc = await cachedM3uDocument(URL_A, async () => channels('A'), { now: 1 })
        expect(doc.classified.live.map(c => c.name)).toEqual(['Globo A'])
        expect(doc.classified.vod.map(c => c.name)).toEqual(['Duna A'])
        expect(doc.classified.series.map(c => c.name)).toEqual(['Fundação A S01E01'])
        // A segunda leitura devolve a MESMA classificação (não recalcula).
        const again = await cachedM3uDocument(URL_A, async () => channels('A'), { now: 2 })
        expect(again.classified).toBe(doc.classified)
    })

    it('vencido o TTL, busca de novo', async () => {
        const download = vi.fn(async () => channels('A'))
        await cachedM3uDocument(URL_A, download, { now: 1_000_000 })
        await cachedM3uDocument(URL_A, download, { now: 1_000_000 + M3U_DOC_TTL_MS - 1 })
        expect(download).toHaveBeenCalledTimes(1)
        await cachedM3uDocument(URL_A, download, { now: 1_000_000 + M3U_DOC_TTL_MS })
        expect(download).toHaveBeenCalledTimes(2)
    })

    it('dedupe em voo: N leituras concorrentes = 1 download', async () => {
        const gate = deferred<M3uChannel[]>()
        const download = vi.fn(() => gate.promise)

        const pedidos = Array.from({ length: 6 }, () => cachedM3uDocument(URL_A, download, { now: 1 }))
        expect(download).toHaveBeenCalledTimes(1)

        gate.resolve(channels('A'))
        const docs = await Promise.all(pedidos)
        expect(download).toHaveBeenCalledTimes(1)
        for (const doc of docs) expect(doc).toBe(docs[0])
    })

    it('forceRefresh entra na carona de um download em voo em vez de abrir outro', async () => {
        const gate = deferred<M3uChannel[]>()
        const download = vi.fn(() => gate.promise)

        const normal = cachedM3uDocument(URL_A, download, { now: 1 })
        const forcado = cachedM3uDocument(URL_A, download, { now: 1, forceRefresh: true })
        gate.resolve(channels('A'))
        expect(await normal).toBe(await forcado)
        expect(download).toHaveBeenCalledTimes(1)
    })

    it('forceRefresh sequencial dentro da janela reusa; fora dela vai na rede', async () => {
        const download = vi.fn(async () => channels('A'))
        await cachedM3uDocument(URL_A, download, { now: 1_000_000, forceRefresh: true })
        // Home pede séries e DEPOIS filmes: os dois são o mesmo refresh.
        await cachedM3uDocument(URL_A, download, {
            now: 1_000_000 + M3U_FORCE_REFRESH_WINDOW_MS - 1,
            forceRefresh: true,
        })
        expect(download).toHaveBeenCalledTimes(1)

        await cachedM3uDocument(URL_A, download, {
            now: 1_000_000 + M3U_FORCE_REFRESH_WINDOW_MS,
            forceRefresh: true,
        })
        expect(download).toHaveBeenCalledTimes(2)
    })

    it('uma URL residente: trocar de playlist devolve a lista anterior', async () => {
        await cachedM3uDocument(URL_A, async () => channels('A'), { now: 1 })
        expect(m3uDocumentCacheState().url).toBe(URL_A)

        await cachedM3uDocument(URL_B, async () => channels('B'), { now: 2 })
        expect(m3uDocumentCacheState().url).toBe(URL_B)

        // Voltar pra A não pode servir o documento de B.
        const voltou = await cachedM3uDocument(URL_A, async () => channels('A'), { now: 3 })
        expect(voltou.classified.live.map(c => c.name)).toEqual(['Globo A'])
    })

    it('download que falha não vira residente e não trava as próximas tentativas', async () => {
        const download = vi.fn()
            .mockRejectedValueOnce(new Error('provedor fora do ar'))
            .mockResolvedValueOnce(channels('A'))

        await expect(cachedM3uDocument(URL_A, download, { now: 1 })).rejects.toThrow('provedor fora do ar')
        expect(m3uDocumentCacheState().url).toBeNull()

        const doc = await cachedM3uDocument(URL_A, download, { now: 2 })
        expect(doc.channels).toHaveLength(3)
        expect(download).toHaveBeenCalledTimes(2)
    })

    it('resetM3uDocumentCache solta o documento (logout / playlist removida)', async () => {
        const download = vi.fn(async () => channels('A'))
        await cachedM3uDocument(URL_A, download, { now: 1 })
        resetM3uDocumentCache()
        expect(m3uDocumentCacheState()).toEqual({ url: null, channels: 0, fetchedAt: null })

        await cachedM3uDocument(URL_A, download, { now: 2 })
        expect(download).toHaveBeenCalledTimes(2)
    })
})
