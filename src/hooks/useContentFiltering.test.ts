import { describe, it, expect } from 'vitest'
import { isCategoryNameBlocked } from './useContentFiltering'

describe('isCategoryNameBlocked', () => {
    it('blocks adult-keyword categories in PT and EN, case-insensitively', () => {
        expect(isCategoryNameBlocked('Adultos')).toBe(true)
        expect(isCategoryNameBlocked('XXX Premium')).toBe(true)
        expect(isCategoryNameBlocked('Filmes +18')).toBe(true)
        expect(isCategoryNameBlocked('CANAIS 18+')).toBe(true)
        expect(isCategoryNameBlocked('Erotic Movies')).toBe(true)
        expect(isCategoryNameBlocked('Conteúdo Erótico')).toBe(true)
    })

    it('blocks horror categories (kids/parental policy)', () => {
        expect(isCategoryNameBlocked('Terror')).toBe(true)
        expect(isCategoryNameBlocked('Horror Classics')).toBe(true)
    })

    it('allows regular categories', () => {
        expect(isCategoryNameBlocked('Filmes')).toBe(false)
        expect(isCategoryNameBlocked('Infantil')).toBe(false)
        expect(isCategoryNameBlocked('Documentários')).toBe(false)
        expect(isCategoryNameBlocked('Ação')).toBe(false)
    })
})
