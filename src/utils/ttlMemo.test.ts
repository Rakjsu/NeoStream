import { describe, it, expect, vi } from 'vitest'
import { createTtlMemo } from './ttlMemo'

describe('createTtlMemo', () => {
    it('não refaz o trabalho dentro do TTL', async () => {
        let clock = 1_000
        const memo = createTtlMemo<number>({ ttlMs: 5_000, now: () => clock })
        const load = vi.fn(async () => 42)

        expect(await memo.run('globo', load)).toBe(42)
        clock += 4_999
        expect(await memo.run('globo', load)).toBe(42)

        expect(load).toHaveBeenCalledTimes(1)
    })

    it('refaz depois do TTL', async () => {
        let clock = 0
        const memo = createTtlMemo<number>({ ttlMs: 1_000, now: () => clock })
        const load = vi.fn(async () => clock)

        await memo.run('globo', load)
        clock = 1_000
        expect(await memo.run('globo', load)).toBe(1_000)
        expect(load).toHaveBeenCalledTimes(2)
    })

    it('junta buscas concorrentes da mesma chave numa só (zapping rápido)', async () => {
        const memo = createTtlMemo<string>({ ttlMs: 60_000 })
        let resolve!: (value: string) => void
        const load = vi.fn(() => new Promise<string>(r => { resolve = r }))

        const a = memo.run('sbt', load)
        const b = memo.run('sbt', load)
        const c = memo.run('sbt', load)
        expect(load).toHaveBeenCalledTimes(1)

        resolve('programas')
        expect(await Promise.all([a, b, c])).toEqual(['programas', 'programas', 'programas'])
    })

    it('não guarda falha em cache (o próximo pedido tenta de novo)', async () => {
        const memo = createTtlMemo<number>({ ttlMs: 60_000 })
        const load = vi.fn()
            .mockRejectedValueOnce(new Error('rede caiu'))
            .mockResolvedValueOnce(7)

        await expect(memo.run('band', load)).rejects.toThrow('rede caiu')
        expect(await memo.run('band', load)).toBe(7)
        expect(load).toHaveBeenCalledTimes(2)
    })

    it('respeita o teto de entradas (zapar 6 mil canais não retém 6 mil guias)', async () => {
        const memo = createTtlMemo<number>({ ttlMs: 60_000, maxEntries: 3 })
        for (let i = 0; i < 10; i++) await memo.run(`canal-${i}`, async () => i)

        expect(memo.size()).toBe(3)
        expect(memo.peek('canal-0')).toBeUndefined()
        expect(memo.peek('canal-9')).toBe(9)
    })

    it('peek não dispara carga e ignora entrada vencida', async () => {
        let clock = 0
        const memo = createTtlMemo<number>({ ttlMs: 100, now: () => clock })
        const load = vi.fn(async () => 1)

        await memo.run('rec', load)
        expect(memo.peek('rec')).toBe(1)
        clock = 100
        expect(memo.peek('rec')).toBeUndefined()
        expect(load).toHaveBeenCalledTimes(1)
    })
})
