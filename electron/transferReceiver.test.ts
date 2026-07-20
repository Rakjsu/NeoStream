import { describe, it, expect } from 'vitest'
import { parseTransferQuery, sanitizeTransferName } from './transferReceiver'

describe('transferReceiver (item 12 — download do celular pro PC)', () => {
    it('sanitizeTransferName derruba caminho e caracteres proibidos', () => {
        expect(sanitizeTransferName('../../evil/passwd.mp4')).toBe('passwd.mp4')
        expect(sanitizeTransferName('C:\\Users\\x\\filme.mp4')).toBe('filme.mp4')
        expect(sanitizeTransferName('a<b>c:d.mp4')).toBe('a_b_c_d.mp4')
        expect(sanitizeTransferName('nome.mp4...')).toBe('nome.mp4')
    })

    it('parseTransferQuery aceita a query completa', () => {
        const parsed = parseTransferQuery('/transfer?pin=1234&kind=movie&name=Filme%20X.mp4&title=Filme%20X')
        expect(parsed).toEqual({ pin: '1234', kind: 'movie', name: 'Filme X.mp4', title: 'Filme X' })
    })

    it('título ausente cai pro nome sem extensão', () => {
        const parsed = parseTransferQuery('/transfer?pin=1&kind=episode&name=Ep1.mkv')
        expect(parsed?.title).toBe('Ep1')
        expect(parsed?.kind).toBe('episode')
    })

    it('rejeita kind desconhecido, nome vazio e nome sem extensão', () => {
        expect(parseTransferQuery('/transfer?pin=1&kind=live&name=a.mp4')).toBeNull()
        expect(parseTransferQuery('/transfer?pin=1&kind=movie&name=')).toBeNull()
        expect(parseTransferQuery('/transfer?pin=1&kind=movie&name=semextensao')).toBeNull()
    })

    it('path traversal no nome vira só o basename', () => {
        const parsed = parseTransferQuery('/transfer?pin=1&kind=movie&name=..%2F..%2Fetc%2Fx.mp4')
        expect(parsed?.name).toBe('x.mp4')
    })
})
