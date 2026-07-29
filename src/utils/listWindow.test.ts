import { describe, it, expect } from 'vitest'
import { computeListWindow, scrollTopForIndex, scrollTopToCenter } from './listWindow'

const ROW = 56

describe('computeListWindow', () => {
    it('monta uma fração da lista gigante (o overlay de zapping montava tudo)', () => {
        const win = computeListWindow({ itemCount: 12000, rowHeight: ROW, scrollTop: 0, viewportHeight: 600, overscan: 6 })

        expect(win.start).toBe(0)
        expect(win.end).toBeLessThan(30)
        expect(win.end - win.start).toBeGreaterThanOrEqual(11) // cabe a tela inteira
    })

    it('mantém a geometria da barra de rolagem (espaçadores + montados = tudo)', () => {
        const itemCount = 12000
        const win = computeListWindow({ itemCount, rowHeight: ROW, scrollTop: 4000, viewportHeight: 600 })

        const total = win.topSpacer + (win.end - win.start) * ROW + win.bottomSpacer
        expect(total).toBe(itemCount * ROW)
    })

    it('nunca esconde um item que está na área visível', () => {
        const itemCount = 5000
        const viewportHeight = 640
        for (const scrollTop of [0, 1, 55, 56, 999, 100000, 279000, itemCount * ROW - 640]) {
            const win = computeListWindow({ itemCount, rowHeight: ROW, scrollTop, viewportHeight })
            const firstVisible = Math.floor(scrollTop / ROW)
            const lastVisible = Math.min(itemCount - 1, Math.floor((scrollTop + viewportHeight - 1) / ROW))
            expect(win.start).toBeLessThanOrEqual(firstVisible)
            expect(win.end).toBeGreaterThan(lastVisible)
        }
    })

    it('lista curta cabe inteira na janela', () => {
        const win = computeListWindow({ itemCount: 7, rowHeight: ROW, scrollTop: 0, viewportHeight: 600 })
        expect(win).toEqual({ start: 0, end: 7, topSpacer: 0, bottomSpacer: 0 })
    })

    it('sem geometria medida renderiza TUDO (canal sumido é pior que lentidão)', () => {
        expect(computeListWindow({ itemCount: 900, rowHeight: 0, scrollTop: 0, viewportHeight: 600 }))
            .toEqual({ start: 0, end: 900, topSpacer: 0, bottomSpacer: 0 })
        expect(computeListWindow({ itemCount: 900, rowHeight: ROW, scrollTop: 0, viewportHeight: 0 }))
            .toEqual({ start: 0, end: 900, topSpacer: 0, bottomSpacer: 0 })
    })

    it('lista vazia não monta nada', () => {
        expect(computeListWindow({ itemCount: 0, rowHeight: ROW, scrollTop: 0, viewportHeight: 600 }))
            .toEqual({ start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 })
    })

    it('scroll além do fim ainda monta pelo menos um item', () => {
        const win = computeListWindow({ itemCount: 10, rowHeight: ROW, scrollTop: 99999, viewportHeight: 600 })
        expect(win.start).toBeLessThan(win.end)
        expect(win.end).toBeLessThanOrEqual(10)
    })
})

describe('scrollTopForIndex', () => {
    it('não mexe no scroll quando o item já está inteiro na tela', () => {
        expect(scrollTopForIndex({ index: 5, rowHeight: ROW, scrollTop: 200, viewportHeight: 600 })).toBe(200)
    })

    it('sobe o mínimo quando o item está acima da janela', () => {
        expect(scrollTopForIndex({ index: 2, rowHeight: ROW, scrollTop: 500, viewportHeight: 600 })).toBe(112)
    })

    it('desce o mínimo quando o item está abaixo da janela', () => {
        // item 20 ocupa 1120..1176; com viewport de 600 o topo vira 576.
        expect(scrollTopForIndex({ index: 20, rowHeight: ROW, scrollTop: 0, viewportHeight: 600 })).toBe(576)
    })

    it('item inexistente não move nada', () => {
        expect(scrollTopForIndex({ index: -1, rowHeight: ROW, scrollTop: 300, viewportHeight: 600 })).toBe(300)
    })
})

describe('scrollTopToCenter', () => {
    it('centraliza o canal atual ao abrir a lista', () => {
        expect(scrollTopToCenter({ index: 100, rowHeight: ROW, viewportHeight: 600 })).toBe(5600 - 272)
    })

    it('não passa do topo em canais do começo da lista', () => {
        expect(scrollTopToCenter({ index: 1, rowHeight: ROW, viewportHeight: 600 })).toBe(0)
    })
})
