import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔗 A ficha não pode buscar o catálogo por conta própria.
 *
 * O `ContentDetailModal` é montado dentro de `{selecionado && …}` em cinco
 * telas (VOD, Séries, Home, Favoritos, Ver depois), então FECHAR a ficha
 * desmonta o componente e zera o estado. Com os dois `invoke` dentro dele,
 * cada ficha com seção TMDB arrastava as duas listas inteiras do main pro
 * renderer — dezenas de milhares de itens, só pra remontar dois Maps iguais
 * aos da ficha anterior.
 *
 * O índice agora é cache de MÓDULO (`services/catalogTitleIndex`), e o
 * comportamento dele — uma busca por sessão, invalidação no refresh, catálogo
 * vazio não vira cache — é testado de verdade em
 * `src/services/catalogTitleIndex.test.ts`. Este guarda é o anti-revert: sem
 * `@testing-library/react` não dá pra montar o modal, então o que dá pra
 * cobrar é que ele não volte a falar com o IPC direto.
 *
 * `fonte.includes(...)` em vez de `toContain`: o modal tem ~2000 linhas e o
 * dump derrubaria o log.
 */
const MODAL = path.join(__dirname, '..', 'src', 'components', 'ContentDetailModal.tsx')

describe('índice do catálogo da ficha', () => {
    it('a ficha não chama os canais do catálogo direto', () => {
        const fonte = fs.readFileSync(MODAL, 'utf-8')
        expect(fonte.includes("invoke('streams:get-vod')")).toBe(false)
        expect(fonte.includes("invoke('streams:get-series')")).toBe(false)
    })

    it('a ficha consome o índice compartilhado', () => {
        expect(fs.readFileSync(MODAL, 'utf-8').includes('getCatalogTitleIndex')).toBe(true)
    })
})
