import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔎 As três grades filtram o nome pela MESMA regra.
 *
 * Filmes e Séries usam `fuzzyIncludes` (sem acento, pontuação achatada, tokens
 * em qualquer ordem). A TV ao vivo ficou com `name.toLowerCase().includes(...)`
 * literal — então "sao" não achava "SÃO PAULO" na grade, enquanto o Ctrl+K
 * (`searchRank.normalizeForSearch`) e o overlay de zapping do player
 * (`ChannelZapOverlay.normalizeName`) achavam. Três superfícies de busca do
 * mesmo canal, duas respostas diferentes.
 *
 * O que este guarda fixa é QUAL regra cada página usa — o comportamento do
 * fuzzy em si (acento, pontuação, ordem dos tokens) já é testado em
 * `src/utils/catalogFuzzy.test.ts`, e reencená-lo aqui seria redundância.
 *
 * Guarda estrutural porque o repositório não tem `@testing-library/react`: as
 * páginas não montam em teste. Molde de `electron/scrollContainerRef.test.ts`.
 * As asserções olham UMA linha extraída, nunca o arquivo inteiro (um
 * `toContain` sobre `LiveTV.tsx` despeja 120 KB no log quando falha).
 */
const PAGES = path.join(__dirname, '..', 'src', 'pages')

const linhaDaBusca = (arquivo: string): string => {
    const fonte = fs.readFileSync(path.join(PAGES, arquivo), 'utf-8')
    return fonte.split('\n').find(linha => linha.includes('const matchesSearch =')) ?? ''
}

describe('busca das grades: uma regra só', () => {
    it.each(['LiveTV.tsx', 'VOD.tsx', 'Series.tsx'])('%s filtra o nome com fuzzyIncludes', (arquivo) => {
        const linha = linhaDaBusca(arquivo)
        expect(linha.includes('fuzzyIncludes('), `${arquivo}: ${linha.trim() || '(nenhuma linha de busca)'}`).toBe(true)
        expect(linha.includes('.toLowerCase().includes('), `${arquivo} voltou ao includes literal`).toBe(false)
    })

    it('a TV ao vivo usa o fuzzy compartilhado, não uma cópia local', () => {
        const fonte = fs.readFileSync(path.join(PAGES, 'LiveTV.tsx'), 'utf-8')
        const importa = /import\s*\{[^}]*\bfuzzyIncludes\b[^}]*\}\s*from\s*'\.\.\/utils\/catalogFilter'/.test(fonte)
        expect(importa).toBe(true)
    })
})
