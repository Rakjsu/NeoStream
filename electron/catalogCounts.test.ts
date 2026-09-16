import { describe, it, expect } from 'vitest'
import { contagensDoCatalogo } from './catalogCounts'

const ok = (n: number) => ({ success: true, data: Array.from({ length: n }, (_, i) => ({ id: i })) })

describe('contagensDoCatalogo', () => {
    it('conta o que cada catálogo devolveu', () => {
        expect(contagensDoCatalogo(ok(1200), ok(4300), ok(180))).toEqual({
            success: true,
            counts: { live: 1200, vod: 4300, series: 180 }
        })
    })

    it('lista vazia de verdade é zero com sucesso — é o M3U da fase 1', () => {
        // Uma lista M3U só de canais tem vod e series legitimamente vazios.
        expect(contagensDoCatalogo(ok(90), ok(0), ok(0))).toEqual({
            success: true,
            counts: { live: 90, vod: 0, series: 0 }
        })
    })

    it('uma falha derruba a resposta inteira, em vez de virar zero', () => {
        // O defeito que este módulo fecha: zero com success:true é gravado pela
        // Home como verdade, e a tela passa a dizer que o catálogo está vazio.
        const r = contagensDoCatalogo(ok(1200), { success: false, error: 'Not authenticated' }, ok(180))
        expect(r).toEqual({ success: false, error: 'Not authenticated' })
    })

    it('falha sem mensagem ainda assim não vira contagem', () => {
        expect(contagensDoCatalogo({ success: false }, ok(1), ok(1))).toMatchObject({ success: false })
    })

    it('resposta com data que não é lista conta zero, não quebra', () => {
        expect(contagensDoCatalogo({ success: true, data: undefined }, ok(2), { success: true, data: 'x' }))
            .toEqual({ success: true, counts: { live: 0, vod: 2, series: 0 } })
    })
})
