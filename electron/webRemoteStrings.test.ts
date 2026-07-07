import { describe, it, expect } from 'vitest'
import { STRINGS } from './webRemoteStrings'

describe('webRemoteStrings (dicionário do controle web)', () => {
    it('os 3 idiomas têm exatamente as mesmas chaves', () => {
        const pt = Object.keys(STRINGS.pt).sort()
        expect(Object.keys(STRINGS.en).sort()).toEqual(pt)
        expect(Object.keys(STRINGS.es).sort()).toEqual(pt)
    })

    it('nenhum valor vazio ou com crase (quebraria o template literal)', () => {
        for (const lang of ['pt', 'en', 'es'] as const) {
            for (const [key, value] of Object.entries(STRINGS[lang])) {
                expect(value.length, `${lang}.${key}`).toBeGreaterThan(0)
                expect(value.includes('`'), `${lang}.${key}`).toBe(false)
            }
        }
    })
})
