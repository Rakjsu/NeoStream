import { describe, it, expect, vi } from 'vitest'
import { fetchWithRetry, isTransientHttpStatus } from './fetchRetry'

const ok = { ok: true, status: 200 }
const bad502 = { ok: false, status: 502 }
const notFound = { ok: false, status: 404 }

describe('isTransientHttpStatus', () => {
    it('5xx e 429 são transientes; 4xx comuns não', () => {
        expect(isTransientHttpStatus(500)).toBe(true)
        expect(isTransientHttpStatus(502)).toBe(true)
        expect(isTransientHttpStatus(429)).toBe(true)
        expect(isTransientHttpStatus(404)).toBe(false)
        expect(isTransientHttpStatus(403)).toBe(false)
        expect(isTransientHttpStatus(200)).toBe(false)
    })
})

describe('fetchWithRetry', () => {
    it('sucesso de primeira não re-tenta', async () => {
        const doFetch = vi.fn(async () => ok)
        expect(await fetchWithRetry(doFetch, { backoffMs: 1 })).toBe(ok)
        expect(doFetch).toHaveBeenCalledTimes(1)
    })

    it('erro de rede na 1ª tentativa → re-tenta e devolve o sucesso', async () => {
        const doFetch = vi.fn()
            .mockRejectedValueOnce(new Error('ECONNRESET'))
            .mockResolvedValueOnce(ok)
        expect(await fetchWithRetry(doFetch, { backoffMs: 1 })).toBe(ok)
        expect(doFetch).toHaveBeenCalledTimes(2)
    })

    it('502 transiente → re-tenta; segunda resposta vale mesmo se ainda 502', async () => {
        const doFetch = vi.fn()
            .mockResolvedValueOnce(bad502)
            .mockResolvedValueOnce(bad502)
        // Esgotou as tentativas: devolve a última resposta (o caller decide).
        expect(await fetchWithRetry(doFetch, { backoffMs: 1 })).toBe(bad502)
        expect(doFetch).toHaveBeenCalledTimes(2)
    })

    it('404 permanente NÃO re-tenta (retry não ajudaria)', async () => {
        const doFetch = vi.fn(async () => notFound)
        expect(await fetchWithRetry(doFetch, { backoffMs: 1 })).toBe(notFound)
        expect(doFetch).toHaveBeenCalledTimes(1)
    })

    it('falha de rede nas duas tentativas → lança o último erro', async () => {
        const doFetch = vi.fn(async () => { throw new Error('timeout') })
        await expect(fetchWithRetry(doFetch, { backoffMs: 1 })).rejects.toThrow('timeout')
        expect(doFetch).toHaveBeenCalledTimes(2)
    })

    it('cada tentativa invoca a factory de novo (signals de timeout novos)', async () => {
        let calls = 0
        const doFetch = async () => {
            calls++
            if (calls === 1) throw new Error('abort')
            return ok
        }
        await fetchWithRetry(doFetch, { backoffMs: 1 })
        expect(calls).toBe(2)
    })
})
