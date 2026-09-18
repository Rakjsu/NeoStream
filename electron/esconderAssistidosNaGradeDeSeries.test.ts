import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🙈 "Esconder assistidos" na grade de Séries — a ponta da PÁGINA.
 *
 * Duas regras, as duas quebradas pelo mesmo trecho:
 *
 * 1. Quem decide se a série está assistida é o serviço. `Series.tsx` fazia a
 *    conta por fora, como "todo episódio REGISTRADO está completo" — e
 *    registro só existe pro episódio que foi ABERTO, então ver o 1º de dez
 *    dava 1 de 1 e a série inteira sumia da grade. O denominador certo (o
 *    total do provedor) vive em `watchProgressService`, que já o usa no selo ✓
 *    e na categoria 🏆; o comportamento está em
 *    `src/services/watchProgressService.test.ts`.
 *
 * 2. A categoria dos assistidos é poupada do filtro. 🏆 "Concluídas" É a lista
 *    de séries concluídas: se o 🙈 também as removesse, ela abriria vazia
 *    sempre que o botão estivesse ligado — e o botão é um flag só
 *    (`neostream_hide_watched`), compartilhado com a grade de Filmes, que já
 *    poupa a sua categoria (`selectedCategory !== 'WATCHED'`).
 *
 * Guarda estrutural porque o repositório não tem `@testing-library/react` e
 * estas páginas arrastam o player inteiro — não montam em teste. Molde de
 * `electron/buscaDaTvAoVivo.test.ts`. As asserções olham UMA linha extraída ou
 * usam `.includes(...)`, nunca `toContain` sobre o arquivo (um `Series.tsx`
 * despejado são 1900+ linhas de log).
 */
const PAGES = path.join(__dirname, '..', 'src', 'pages')

const fonteDa = (arquivo: string): string =>
    fs.readFileSync(path.join(PAGES, arquivo), 'utf-8').split('\r\n').join('\n')

describe('esconder assistidos: a grade pergunta ao serviço', () => {
    const series = fonteDa('Series.tsx')

    it('o conjunto escondido vem de watchProgressService.getCompletedSeriesIds()', () => {
        expect(series.includes('watchProgressService.getCompletedSeriesIds()')).toBe(true)
    })

    it('a grade não refaz "todo episódio registrado está completo" por fora', () => {
        expect(series.includes('entry.completed === entry.total')).toBe(false)
    })
})

describe('esconder assistidos: a categoria dos assistidos é poupada', () => {
    const CATEGORIA_DOS_ASSISTIDOS: Array<[string, string]> = [
        ['Series.tsx', "selectedCategory !== 'COMPLETED'"],
        ['VOD.tsx', "selectedCategory !== 'WATCHED'"]
    ]

    it.each(CATEGORIA_DOS_ASSISTIDOS)('%s: toda linha que esconde por assistido poupa %s', (arquivo, guarda) => {
        const linhas = fonteDa(arquivo)
            .split('\n')
            .filter(linha => linha.includes('hideWatched &&'))

        expect(linhas.length).toBeGreaterThan(0)
        for (const linha of linhas) {
            // O `hideWatched` vem PRIMEIRO na condição: qualquer coisa antes
            // dele (um `false &&`, um flag novo) desliga o botão inteiro sem
            // que nenhuma outra asserção daqui perceba.
            expect(linha.trim().startsWith('if (hideWatched &&')).toBe(true)
            expect(linha.trim()).toContain(guarda)
        }
    })

    it('Series.tsx: o conjunto escondido é de fato aplicado à grade', () => {
        expect(fonteDa('Series.tsx').includes('watchedSeriesIds.has(String(s.series_id))')).toBe(true)
    })
})
