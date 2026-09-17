import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * ⭐ Favoritos é UMA categoria, falada por TRÊS telas.
 *
 * O botão do menu (`CategoryMenu.tsx:716`), o filtro da TV ao vivo
 * (`LiveTV.tsx:567`) e agora o seletor do guia (`EpgGuide.tsx`) comparam o
 * mesmo texto cru `'FAVORITES'`. Renomear o sentinela num lado e esquecer o
 * outro não quebra tipo nenhum: a tela só para de achar canal, em silêncio.
 * Por isso o guarda é estrutural.
 *
 * As asserções comparam BOOLEANOS, nunca o arquivo inteiro: um `toContain`
 * sobre `LiveTV.tsx` despeja 120 KB de fonte no log quando falha — mesmo
 * motivo de `scrollContainerRef.test.ts:31-35` extrair a linha antes de
 * asseverar.
 */
const SRC = path.join(__dirname, '..', 'src')
const leia = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf-8')

describe('⭐ favoritos no guia', () => {
    const sentinela = /export const FAVORITES_CATEGORY = '([A-Z_]+)'/
        .exec(leia('utils', 'epgGuide.ts'))?.[1]

    it('o sentinela é exportado de utils/epgGuide.ts', () => {
        expect(sentinela).toBe('FAVORITES')
    })

    it('o guia oferece a opção ⭐ no seletor de categorias', () => {
        expect(leia('pages', 'EpgGuide.tsx').includes('<option value={FAVORITES_CATEGORY}>')).toBe(true)
    })

    it('⭐ continua escondida no perfil infantil', () => {
        expect(/\{!isKidsProfile[^}]*&&[\s\S]{0,200}?<option value=\{FAVORITES_CATEGORY\}/
            .test(leia('pages', 'EpgGuide.tsx'))).toBe(true)
    })

    it('guia, TV ao vivo e menu de categorias falam o MESMO sentinela', () => {
        expect(leia('pages', 'LiveTV.tsx').includes(`selectedCategory === '${sentinela}'`)).toBe(true)
        expect(leia('components', 'CategoryMenu.tsx').includes(`onSelectCategory('${sentinela}')`)).toBe(true)
    })
})
