import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// app.getPath('userData') → pasta temporária NOVA por teste (evita bleed do
// catalog.db entre testes e entre execuções do runner).
const state = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => state.dir } }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { cachedCatalogFetch, invalidatePlaylistCache, isFresh, CATALOG_CACHE_TTL_MS, closeCatalogStore, catalogMemoryKeys } from './catalogCache'

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
        await cachedCatalogFetch(a, 'live', vi.fn().mockResolvedValue(['canais-A']))
        await cachedCatalogFetch(b, 'live', vi.fn().mockResolvedValue(['canais-B']))
        expect((await cachedCatalogFetch(a, 'live', vi.fn())).data).toEqual(['canais-A'])
        expect((await cachedCatalogFetch(b, 'live', vi.fn())).data).toEqual(['canais-B'])
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
        await cachedCatalogFetch(id, 'live', vi.fn().mockResolvedValue(['velho']))
        invalidatePlaylistCache(id)
        const fetcher = vi.fn().mockResolvedValue(['novo'])
        expect(await cachedCatalogFetch(id, 'live', fetcher)).toEqual({ data: ['novo'], fromCache: false })
        expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('id de playlist com caracteres estranhos vira chave estável (roundtrip via disco)', async () => {
        const id = `..\\/etc?passwd ${freshId()}`
        await cachedCatalogFetch(id, 'live', vi.fn().mockResolvedValue(['ok']))
        await flushWrite()
        closeCatalogStore()

        vi.resetModules()
        const reloaded = await import('./catalogCache')
        expect(await reloaded.cachedCatalogFetch(id, 'live', vi.fn().mockRejectedValue(new Error('offline'))))
            .toEqual({ data: ['ok'], fromCache: true })
        reloaded.closeCatalogStore()
    })

    // 🔒 Regressão (auditoria R1 — H2): provedor com conta expirada/domínio
    // estacionado responde 200 com objeto ou HTML, e o cliente só rejeita
    // status != 200. Gravar isso envenenava o cache por 15 min (sobrevivendo a
    // restart) e o `.filter()` do renderer estourava DENTRO do render,
    // derrubando Home/Filmes/Séries/TV pro ErrorBoundary.
    it('resposta NÃO-lista do provedor não vira cache — serve o cache bom anterior', async () => {
        const id = freshId()
        await cachedCatalogFetch(id, 'vod', vi.fn().mockResolvedValue([{ stream_id: 1 }]))

        // Conta expirou: 200 com objeto no lugar da lista.
        const lixo = await cachedCatalogFetch(id, 'vod', vi.fn().mockResolvedValue({ user_info: { auth: 0 } }), true)
        expect(lixo.fromCache).toBe(true)
        expect(lixo.data).toEqual([{ stream_id: 1 }])

        // E o lixo NÃO foi persistido: uma leitura seguinte continua com o bom.
        const depois = await cachedCatalogFetch(id, 'vod', vi.fn().mockRejectedValue(new Error('offline')), true)
        expect(depois.data).toEqual([{ stream_id: 1 }])
    })

    it('resposta não-lista SEM cache anterior propaga erro (não injeta lixo no state)', async () => {
        await expect(cachedCatalogFetch(freshId(), 'series', vi.fn().mockResolvedValue('<html>login</html>')))
            .rejects.toThrow(/esperava lista/)
    })

    it('lista vazia é resposta legítima e continua sendo cacheada', async () => {
        const id = freshId()
        const r = await cachedCatalogFetch(id, 'live-categories', vi.fn().mockResolvedValue([]))
        expect(r.data).toEqual([])
        const cache = await cachedCatalogFetch(id, 'live-categories', vi.fn().mockRejectedValue(new Error('x')), true)
        expect(cache.data).toEqual([])
    })

    // 🚀 R5: dois consumidores simultâneos com o cache vencido (Ctrl+K dispara
    // os seis kinds num Promise.all enquanto a Home monta) baixavam, parseavam
    // e regravavam a MESMA lista duas vezes.
    describe('dedupe de requisições em voo', () => {
        it('duas chamadas concorrentes ao mesmo kind = UM fetch', async () => {
            const id = freshId()
            let liberar!: (value: unknown) => void
            const fetcher = vi.fn(() => new Promise(resolve => { liberar = resolve }))

            const a = cachedCatalogFetch(id, 'vod', fetcher)
            const b = cachedCatalogFetch(id, 'vod', fetcher)
            expect(fetcher).toHaveBeenCalledTimes(1)

            liberar([{ stream_id: 7 }])
            expect(await a).toEqual({ data: [{ stream_id: 7 }], fromCache: false })
            expect(await b).toEqual({ data: [{ stream_id: 7 }], fromCache: false })
            expect(fetcher).toHaveBeenCalledTimes(1)
        })

        it('kinds diferentes não se atropelam', async () => {
            const id = freshId()
            const vod = vi.fn().mockResolvedValue(['filmes'])
            const live = vi.fn().mockResolvedValue(['canais'])
            const [a, b] = await Promise.all([
                cachedCatalogFetch(id, 'vod', vod),
                cachedCatalogFetch(id, 'live', live),
            ])
            expect(a.data).toEqual(['filmes'])
            expect(b.data).toEqual(['canais'])
        })

        it('a entrada em voo sai no fim — a busca seguinte não fica presa na anterior', async () => {
            const id = freshId()
            const primeiro = vi.fn().mockRejectedValue(new Error('caiu'))
            await expect(cachedCatalogFetch(id, 'series', primeiro)).rejects.toThrow('caiu')

            const segundo = vi.fn().mockResolvedValue(['ok'])
            expect((await cachedCatalogFetch(id, 'series', segundo)).data).toEqual(['ok'])
            expect(segundo).toHaveBeenCalledTimes(1)
        })
    })

    // 🚀 R5: a camada de memória só guardava e nunca soltava — quem alternava
    // entre duas contas ficava com duas listas de 50 mil itens (≈34 MB cada)
    // presas no main até fechar o app.
    describe('poda: a memória só guarda a playlist residente', () => {
        it('trocar de playlist solta as chaves da anterior', async () => {
            const a = freshId()
            const b = freshId()
            await cachedCatalogFetch(a, 'vod', vi.fn().mockResolvedValue(['filmes-A']))
            await cachedCatalogFetch(a, 'live', vi.fn().mockResolvedValue(['canais-A']))
            await flushWrite()
            expect(catalogMemoryKeys()).toHaveLength(2)

            await cachedCatalogFetch(b, 'vod', vi.fn().mockResolvedValue(['filmes-B']))
            expect(catalogMemoryKeys()).toEqual([`${b}-vod`])
        })

        it('nunca passa dos seis kinds da playlist ativa', async () => {
            const id = freshId()
            for (const kind of ['live', 'vod', 'series', 'live-categories', 'vod-categories', 'series-categories'] as const) {
                await cachedCatalogFetch(id, kind, vi.fn().mockResolvedValue([kind]))
            }
            await flushWrite()
            expect(catalogMemoryKeys()).toHaveLength(6)
        })

        it('podar a memória não perde dado: o catalog.db devolve a playlist antiga', async () => {
            const a = freshId()
            const b = freshId()
            await cachedCatalogFetch(a, 'vod', vi.fn().mockResolvedValue(['filmes-A']))
            await flushWrite()
            await cachedCatalogFetch(b, 'vod', vi.fn().mockResolvedValue(['filmes-B']))
            expect(catalogMemoryKeys()).toEqual([`${b}-vod`])

            // Provedor fora do ar: sem o disco isto viraria erro/lista vazia.
            const voltou = await cachedCatalogFetch(a, 'vod', vi.fn().mockRejectedValue(new Error('offline')))
            expect(voltou).toEqual({ data: ['filmes-A'], fromCache: true })
        })

        // 🛡️ O despejo NUNCA pode ser a única cópia: enquanto a gravação em
        // disco não termina, a entrada fica na memória mesmo sendo de outra
        // playlist — senão o SWR não teria o que servir se o provedor cair.
        it('entrada com gravação em voo não é despejada', async () => {
            const a = freshId()
            const b = freshId()
            await cachedCatalogFetch(a, 'vod', vi.fn().mockResolvedValue(['filmes-A']))
            // SEM flushWrite: a escrita no catalog.db ainda não rodou.
            await cachedCatalogFetch(b, 'vod', vi.fn().mockResolvedValue(['filmes-B']))
            expect(catalogMemoryKeys()).toContain(`${a}-vod`)

            const voltou = await cachedCatalogFetch(a, 'vod', vi.fn().mockRejectedValue(new Error('offline')))
            expect(voltou).toEqual({ data: ['filmes-A'], fromCache: true })
        })
    })
})
