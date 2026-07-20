import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// app.getPath('userData') → pasta temporária NOVA por teste (evita bleed do
// catalog.db entre testes e entre execuções do runner).
const state = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => state.dir } }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { cachedCatalogFetch, invalidatePlaylistCache, isFresh, CATALOG_CACHE_TTL_MS, closeCatalogStore } from './catalogCache'

const cacheDir = () => path.join(state.dir, 'catalog-cache')
// A escrita no catalog.db sai do caminho da resposta via setImmediate.
const flushWrite = () => new Promise(resolve => setImmediate(resolve))

let seq = 0
/** Ids únicos por teste — legibilidade dos asserts. */
function freshId(): string {
    return `pl_test_${++seq}`
}

describe('isFresh (janela SWR de 15 min)', () => {
    it('fresco estritamente dentro do TTL; velho a partir do limite', () => {
        expect(isFresh(1000, 1000 + CATALOG_CACHE_TTL_MS - 1)).toBe(true)
        expect(isFresh(1000, 1000 + CATALOG_CACHE_TTL_MS)).toBe(false)
        expect(isFresh(1000, 500, 100)).toBe(true) // relógio pra trás não derruba o cache
    })
})

describe('cachedCatalogFetch (stale-while-revalidate por playlist+kind, backend SQLite)', () => {
    beforeEach(() => {
        closeCatalogStore()
        state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-catcache-'))
    })
    afterEach(() => {
        vi.restoreAllMocks()
        closeCatalogStore()
        // Best-effort: um módulo resetado no teste pode segurar o handle do DB.
        try {
            fs.rmSync(state.dir, { recursive: true, force: true })
        } catch { /* dir temporário fica pro SO limpar */ }
    })

    it('cache fresco serve sem rede; vencido busca de novo', async () => {
        const id = freshId()
        const fetcher = vi.fn().mockResolvedValue([{ stream_id: 1 }])
        let now = 1_000_000
        vi.spyOn(Date, 'now').mockImplementation(() => now)

        const first = await cachedCatalogFetch(id, 'live', fetcher)
        expect(first).toEqual({ data: [{ stream_id: 1 }], fromCache: false })

        now += CATALOG_CACHE_TTL_MS - 1
        const second = await cachedCatalogFetch(id, 'live', fetcher)
        expect(second.fromCache).toBe(true)
        expect(fetcher).toHaveBeenCalledTimes(1)

        now += 2 // passa do TTL
        fetcher.mockResolvedValue([{ stream_id: 2 }])
        const third = await cachedCatalogFetch(id, 'live', fetcher)
        expect(third).toEqual({ data: [{ stream_id: 2 }], fromCache: false })
        expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('forceRefresh ignora o frescor mas ainda cai no stale se o provedor falhar', async () => {
        const id = freshId()
        const fetcher = vi.fn().mockResolvedValue(['v1'])
        await cachedCatalogFetch(id, 'vod', fetcher)

        const refreshed = await cachedCatalogFetch(id, 'vod', vi.fn().mockResolvedValue(['v2']), true)
        expect(refreshed).toEqual({ data: ['v2'], fromCache: false })

        // Provedor fora do ar no refresh → resiliência: serve o que tinha.
        const stale = await cachedCatalogFetch(id, 'vod', vi.fn().mockRejectedValue(new Error('offline')), true)
        expect(stale).toEqual({ data: ['v2'], fromCache: true })
    })

    it('sem cache nenhum, a falha do provedor propaga', async () => {
        await expect(cachedCatalogFetch(freshId(), 'series', vi.fn().mockRejectedValue(new Error('http 512'))))
            .rejects.toThrow('http 512')
    })

    it('playlists não se misturam (mesmo kind, ids diferentes)', async () => {
        const a = freshId()
        const b = freshId()
        await cachedCatalogFetch(a, 'live', vi.fn().mockResolvedValue('canais-A'))
        await cachedCatalogFetch(b, 'live', vi.fn().mockResolvedValue('canais-B'))
        expect((await cachedCatalogFetch(a, 'live', vi.fn())).data).toBe('canais-A')
        expect((await cachedCatalogFetch(b, 'live', vi.fn())).data).toBe('canais-B')
    })

    it('persiste no catalog.db e um "novo processo" (módulo novo) lê do disco', async () => {
        const id = freshId()
        await cachedCatalogFetch(id, 'live-categories', vi.fn().mockResolvedValue([{ category_id: '10' }]))
        await flushWrite()
        closeCatalogStore() // solta o catalog.db pro "novo processo" abrir

        // Módulo recarregado = memória vazia → obriga a via do disco.
        vi.resetModules()
        const reloaded = await import('./catalogCache')
        const result = await reloaded.cachedCatalogFetch(id, 'live-categories', vi.fn().mockRejectedValue(new Error('offline')))
        expect(result).toEqual({ data: [{ category_id: '10' }], fromCache: true })
        reloaded.closeCatalogStore()
    })

    it('migra o JSON legado pro catalog.db e a pasta vira o backup do rollback', async () => {
        const id = freshId()
        fs.mkdirSync(cacheDir(), { recursive: true })
        fs.writeFileSync(
            path.join(cacheDir(), `${id}-live.json`),
            JSON.stringify({ fetchedAt: Date.now(), data: 'migrado' }),
            'utf-8',
        )
        const result = await cachedCatalogFetch(id, 'live', vi.fn().mockRejectedValue(new Error('offline')))
        expect(result).toEqual({ data: 'migrado', fromCache: true })
        expect(fs.existsSync(cacheDir())).toBe(false)
        expect(fs.existsSync(`${cacheDir()}-backup`)).toBe(true)
    })

    it('JSON legado corrompido é pulado na migração (busca de novo)', async () => {
        const id = freshId()
        fs.mkdirSync(cacheDir(), { recursive: true })
        fs.writeFileSync(path.join(cacheDir(), `${id}-vod.json`), 'não-é-json', 'utf-8')

        vi.resetModules()
        const reloaded = await import('./catalogCache')
        const fetcher = vi.fn().mockResolvedValue(['recuperado'])
        expect(await reloaded.cachedCatalogFetch(id, 'vod', fetcher)).toEqual({ data: ['recuperado'], fromCache: false })
        reloaded.closeCatalogStore()
    })

    it('invalidatePlaylistCache derruba os seis kinds da playlist', async () => {
        const id = freshId()
        await cachedCatalogFetch(id, 'live', vi.fn().mockResolvedValue('velho'))
        invalidatePlaylistCache(id)
        const fetcher = vi.fn().mockResolvedValue('novo')
        expect(await cachedCatalogFetch(id, 'live', fetcher)).toEqual({ data: 'novo', fromCache: false })
        expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('id de playlist com caracteres estranhos vira chave estável (roundtrip via disco)', async () => {
        const id = `..\\/etc?passwd ${freshId()}`
        await cachedCatalogFetch(id, 'live', vi.fn().mockResolvedValue('ok'))
        await flushWrite()
        closeCatalogStore()

        vi.resetModules()
        const reloaded = await import('./catalogCache')
        expect(await reloaded.cachedCatalogFetch(id, 'live', vi.fn().mockRejectedValue(new Error('offline'))))
            .toEqual({ data: 'ok', fromCache: true })
        reloaded.closeCatalogStore()
    })
})
