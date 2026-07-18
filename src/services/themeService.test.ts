import { describe, it, expect, beforeEach } from 'vitest'
import {
    ACCENT_PRESETS,
    BACKGROUND_PRESETS,
    DEFAULT_THEME,
    cssVariablesFor,
    parseStoredTheme,
    themeService
} from './themeService'
import type { Theme } from './themeService'

const HEX_RE = /^#[0-9a-f]{6}$/

function hexToRgbString(hex: string): string {
    const n = parseInt(hex.slice(1), 16)
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    // reset singleton state back to defaults
    themeService.setTheme({ ...DEFAULT_THEME })
    localStorage.clear()
})

describe('accent preset table integrity', () => {
    it('has exactly 6 presets with unique ids and colors', () => {
        expect(ACCENT_PRESETS).toHaveLength(6)
        const ids = ACCENT_PRESETS.map(p => p.id)
        expect(new Set(ids).size).toBe(6)
        const accents = ACCENT_PRESETS.map(p => p.accent)
        expect(new Set(accents).size).toBe(6)
    })

    it('every preset has valid lowercase hex colors', () => {
        for (const p of ACCENT_PRESETS) {
            expect(p.accent).toMatch(HEX_RE)
            expect(p.dark).toMatch(HEX_RE)
            expect(p.light).toMatch(HEX_RE)
            expect(p.gradTo).toMatch(HEX_RE)
        }
    })

    it('rgb triplets match their hex counterparts', () => {
        for (const p of ACCENT_PRESETS) {
            expect(p.rgb).toBe(hexToRgbString(p.accent))
            expect(p.gradToRgb).toBe(hexToRgbString(p.gradTo))
        }
    })

    it('"roxo" mirrors the classic palette exactly', () => {
        const roxo = ACCENT_PRESETS.find(p => p.id === 'roxo')!
        expect(roxo.accent).toBe('#a855f7')
        expect(roxo.gradTo).toBe('#ec4899')
        expect(roxo.light).toBe('#c4b5fd')
    })

    it('background presets: default mirrors classic, amoled is pure black', () => {
        expect(BACKGROUND_PRESETS.map(b => b.id)).toEqual(['default', 'amoled'])
        const def = BACKGROUND_PRESETS[0]
        expect(def.deep).toBe('#0f0f1a')
        expect(def.panel).toBe('#1a1a2e')
        const amoled = BACKGROUND_PRESETS[1]
        expect(amoled.deep).toBe('#000000')
        expect(amoled.panel).toBe('#0a0a0f')
    })
})

describe('cssVariablesFor', () => {
    it('default theme produces the classic values', () => {
        const vars = cssVariablesFor(DEFAULT_THEME)
        expect(vars['--ns-accent']).toBe('#a855f7')
        expect(vars['--ns-accent-grad-to']).toBe('#ec4899')
        expect(vars['--ns-accent-rgb']).toBe('168, 85, 247')
        expect(vars['--ns-accent-soft']).toBe('rgba(168, 85, 247, 0.15)')
        expect(vars['--ns-bg-deep']).toBe('#0f0f1a')
        expect(vars['--ns-bg-panel']).toBe('#1a1a2e')
    })

    it('amoled + azul switches background and accent variables', () => {
        const vars = cssVariablesFor({ ...DEFAULT_THEME, background: 'amoled', accent: 'azul' })
        expect(vars['--ns-bg-deep']).toBe('#000000')
        expect(vars['--ns-bg-panel']).toBe('#0a0a0f')
        expect(vars['--ns-accent']).toBe('#3b82f6')
        expect(vars['--ns-accent-glow']).toBe('rgba(59, 130, 246, 0.4)')
    })
})

describe('parseStoredTheme', () => {
    it('returns the default theme for null/garbage input', () => {
        expect(parseStoredTheme(null)).toEqual(DEFAULT_THEME)
        expect(parseStoredTheme('not json {{{')).toEqual(DEFAULT_THEME)
    })

    it('falls back per-field on unknown values', () => {
        expect(parseStoredTheme(JSON.stringify({ background: 'neon', accent: 'verde' })))
            .toEqual({ ...DEFAULT_THEME, accent: 'verde' })
        expect(parseStoredTheme(JSON.stringify({ background: 'amoled', accent: 'cyan' })))
            .toEqual({ ...DEFAULT_THEME, background: 'amoled' })
    })
})

describe('persistence round-trip', () => {
    it('setTheme persists to localStorage under neostream_theme', () => {
        themeService.setTheme({ background: 'amoled', accent: 'rosa' })
        const stored = JSON.parse(localStorage.getItem('neostream_theme')!) as Theme
        expect(stored).toEqual({ ...DEFAULT_THEME, background: 'amoled', accent: 'rosa' })
        expect(parseStoredTheme(localStorage.getItem('neostream_theme'))).toEqual(stored)
    })

    it('partial setTheme keeps the other field', () => {
        themeService.setTheme({ accent: 'laranja' })
        expect(themeService.getTheme()).toEqual({ ...DEFAULT_THEME, accent: 'laranja' })
        themeService.setTheme({ background: 'amoled' })
        expect(themeService.getTheme()).toEqual({ ...DEFAULT_THEME, background: 'amoled', accent: 'laranja' })
    })
})

describe('a11y do tema (contraste, animações, escala)', () => {
    it('parseStoredTheme valida os campos novos e ignora lixo', () => {
        expect(parseStoredTheme(JSON.stringify({ contrast: true, reducedMotion: true, scale: 125 })))
            .toEqual({ ...DEFAULT_THEME, contrast: true, reducedMotion: true, scale: 125 })
        expect(parseStoredTheme(JSON.stringify({ scale: 300 })).scale).toBe(100)
        expect(parseStoredTheme(JSON.stringify({ contrast: 'yes' })).contrast).toBe(false)
    })

    it('contraste força fundo preto e a escala vira --ns-ui-scale', () => {
        const vars = cssVariablesFor({ ...DEFAULT_THEME, contrast: true, scale: 110 })
        expect(vars['--ns-bg-deep']).toBe('#000000')
        expect(vars['--ns-ui-scale']).toBe('1.1')
        expect(cssVariablesFor(DEFAULT_THEME)['--ns-ui-scale']).toBe('1')
    })

    it('apply() estampa data-contrast e data-motion no <html>', () => {
        themeService.setTheme({ contrast: true, reducedMotion: true })
        const root = document.documentElement
        expect(root.getAttribute('data-contrast')).toBe('1')
        expect(root.getAttribute('data-motion')).toBe('reduced')
        themeService.setTheme({ contrast: false, reducedMotion: false })
        expect(root.getAttribute('data-contrast')).toBe('0')
        expect(root.getAttribute('data-motion')).toBe('normal')
    })
})

describe('CSS variable application', () => {
    it('apply() sets --ns-* variables and data-theme on <html>', () => {
        themeService.setTheme({ background: 'amoled', accent: 'verde' })
        const root = document.documentElement
        expect(root.style.getPropertyValue('--ns-accent')).toBe('#22c55e')
        expect(root.style.getPropertyValue('--ns-bg-deep')).toBe('#000000')
        expect(root.getAttribute('data-theme')).toBe('amoled-verde')
    })

    it('switching back to default restores the classic values', () => {
        themeService.setTheme({ background: 'amoled', accent: 'azul' })
        themeService.setTheme({ ...DEFAULT_THEME })
        const root = document.documentElement
        expect(root.style.getPropertyValue('--ns-accent')).toBe('#a855f7')
        expect(root.style.getPropertyValue('--ns-bg-deep')).toBe('#0f0f1a')
        expect(root.getAttribute('data-theme')).toBe('default-roxo')
    })

    it('notifies subscribers on change', () => {
        let calls = 0
        const unsub = themeService.subscribe(() => { calls += 1 })
        themeService.setTheme({ accent: 'vermelho' })
        expect(calls).toBe(1)
        unsub()
        themeService.setTheme({ accent: 'roxo' })
        expect(calls).toBe(1)
    })
})
