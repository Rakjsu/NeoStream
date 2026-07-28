import { describe, it, expect, vi } from 'vitest'
import {
    declaredLengthExceeds,
    readTextWithLimit,
    readResponseTextWithLimit,
    ResponseTooLargeError,
} from './httpLimits'

/**
 * 🔒 XMLTV e M3U eram lidos com `.text()`, sem teto: um provedor hostil
 * responde alguns GB e derruba o processo principal por memória (e o probe de
 * XMLTV roda no boot, então vira ciclo de crash).
 */

/** Stream falso com `destroy` observável, como o body do node-fetch. */
function fakeBody(chunks: (Uint8Array | string)[]) {
    const destroy = vi.fn()
    return {
        destroy,
        async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) yield chunk
        },
    }
}

describe('declaredLengthExceeds', () => {
    it('corta pelo Content-Length antes de ler um byte', () => {
        expect(declaredLengthExceeds('999999999', 100)).toBe(true)
        expect(declaredLengthExceeds(50, 100)).toBe(false)
        expect(declaredLengthExceeds(null, 100)).toBe(false)
        expect(declaredLengthExceeds('desconhecido', 100)).toBe(false)
    })
})

describe('readTextWithLimit', () => {
    it('corpo dentro do teto é lido inteiro', async () => {
        const body = fakeBody([new TextEncoder().encode('<tv>'), new TextEncoder().encode('</tv>')])
        await expect(readTextWithLimit(body, 1024)).resolves.toBe('<tv></tv>')
        expect(body.destroy).not.toHaveBeenCalled()
    })

    it('🔒 corpo acima do teto aborta e derruba a conexão', async () => {
        const body = fakeBody([new Uint8Array(64), new Uint8Array(64), new Uint8Array(64)])
        await expect(readTextWithLimit(body, 100)).rejects.toBeInstanceOf(ResponseTooLargeError)
        expect(body.destroy).toHaveBeenCalled()
    })

    it('🔒 para de consumir no chunk que estoura (não lê o resto)', async () => {
        let produced = 0
        const body = {
            destroy: vi.fn(),
            async *[Symbol.asyncIterator]() {
                while (true) { produced++; yield new Uint8Array(1024) }
            },
        }
        await expect(readTextWithLimit(body, 4096)).rejects.toBeInstanceOf(ResponseTooLargeError)
        expect(produced).toBeLessThanOrEqual(5)
    })

    it('multibyte partido entre chunks não corrompe o texto', async () => {
        const full = new TextEncoder().encode('programação')
        const body = fakeBody([full.slice(0, 5), full.slice(5)])
        await expect(readTextWithLimit(body, 1024)).resolves.toBe('programação')
    })

    it('corpo ausente vira string vazia', async () => {
        await expect(readTextWithLimit(null, 1024)).resolves.toBe('')
    })
})

describe('readResponseTextWithLimit', () => {
    const headers = (value: string | null) => ({ get: (name: string) => (name === 'content-length' ? value : null) })

    it('🔒 Content-Length gigante é recusado sem ler o corpo', async () => {
        const body = fakeBody([new Uint8Array(8)])
        await expect(readResponseTextWithLimit({ headers: headers('50000000000'), body }, 1024))
            .rejects.toBeInstanceOf(ResponseTooLargeError)
        expect(body.destroy).toHaveBeenCalled()
    })

    it('🔒 provedor que mente no Content-Length ainda é cortado no fio', async () => {
        const body = fakeBody([new Uint8Array(2048)])
        await expect(readResponseTextWithLimit({ headers: headers('10'), body }, 1024))
            .rejects.toBeInstanceOf(ResponseTooLargeError)
    })

    it('resposta normal passa', async () => {
        const body = fakeBody(['#EXTM3U\n'])
        await expect(readResponseTextWithLimit({ headers: headers('8'), body }, 1024)).resolves.toBe('#EXTM3U\n')
    })
})
