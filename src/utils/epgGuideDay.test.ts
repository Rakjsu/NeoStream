import { describe, expect, it } from 'vitest'
import {
    categoryHue,
    HALF_HOUR_MS,
    listGuideDays,
    WINDOW_HALF_HOURS,
    windowForDay,
} from './epgGuide'

// Terça 2026-07-14 15:00 local (determinístico o suficiente pros ranges).
const NOW = new Date(2026, 6, 14, 15, 0, 0, 0).getTime()

describe('categoryHue', () => {
    it('é determinística, fica em 0–359 e separa categorias comuns', () => {
        expect(categoryHue('esportes')).toBe(categoryHue('esportes'))
        for (const key of ['esportes', 'filmes', 'noticias', 'infantil', '42']) {
            const hue = categoryHue(key)
            expect(hue).toBeGreaterThanOrEqual(0)
            expect(hue).toBeLessThan(360)
        }
        expect(categoryHue('esportes')).not.toBe(categoryHue('filmes'))
    })
})

describe('windowForDay (salto por dia)', () => {
    it('ancora no lattice de 30min e mantém o tamanho da janela', () => {
        const target = new Date(2026, 6, 15, 8, 10, 0, 0).getTime() // 08:10 → 08:00
        const win = windowForDay(target, NOW)
        expect(win.start % HALF_HOUR_MS).toBe(0)
        expect(win.end - win.start).toBe(WINDOW_HALF_HOURS * HALF_HOUR_MS)
        expect(win.start).toBeLessThanOrEqual(target)
        expect(target - win.start).toBeLessThan(HALF_HOUR_MS)
    })

    it('clampa dias fora do alcance do provedor', () => {
        const farFuture = NOW + 10 * 24 * 60 * 60 * 1000
        const win = windowForDay(farFuture, NOW)
        expect(win.start).toBeLessThanOrEqual(NOW + 36 * 60 * 60 * 1000)
        const farPast = NOW - 10 * 24 * 60 * 60 * 1000
        expect(windowForDay(farPast, NOW).start).toBeGreaterThanOrEqual(NOW - 12 * 60 * 60 * 1000)
    })
})

describe('listGuideDays', () => {
    it('inclui hoje e amanhã às 08:00, em ordem, tudo dentro do alcance', () => {
        const days = listGuideDays(NOW)
        expect(days.length).toBeGreaterThanOrEqual(2)
        const today8 = new Date(2026, 6, 14, 8, 0, 0, 0).getTime()
        const tomorrow8 = new Date(2026, 6, 15, 8, 0, 0, 0).getTime()
        expect(days).toContain(today8)
        expect(days).toContain(tomorrow8)
        expect([...days].sort((a, b) => a - b)).toEqual(days)
        for (const day of days) {
            expect(day).toBeGreaterThanOrEqual(NOW - 12 * 60 * 60 * 1000)
            expect(day).toBeLessThanOrEqual(NOW + 36 * 60 * 60 * 1000)
        }
    })
})
