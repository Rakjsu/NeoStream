import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🗂️ Escolher uma categoria não pode custar uma varredura do histórico POR CARD.
 *
 * "Continuar assistindo" (Filmes e Séries) e "Assistidos" (Filmes) são
 * pseudo-categorias: a grade inteira é filtrada por pertinência a uma lista que
 * mora no localStorage. As chamadas que montam essa lista —
 * `getMoviesInProgress()`, `getWatchedMovies()` e `getContinueWatching()` —
 * varrem o histórico inteiro a cada chamada (getItem + filter/forEach + map).
 * Quando elas ficam DENTRO do callback do `.filter()`, que roda uma vez por
 * item, escolher a categoria custa O(catálogo × histórico): medido com 500
 * cards e 500 entradas, Séries gastava 202 000 `getItem` e 438 ms de thread
 * principal numa única avaliação do filtro.
 *
 * O invariante travado aqui não é o diff, é o lugar: a leitura do histórico
 * vive no prelúdio do `useMemo` (uma vez por avaliação do filtro) e o callback
 * por item só consulta o resultado. Por isso cada caso afirma as DUAS pontas —
 * a chamada sumiu do laço E continua existindo antes dele —, senão o guarda
 * passaria a verde com a categoria simplesmente apagada.
 *
 * Guarda estrutural (lê o fonte) porque não há @testing-library/react no
 * repositório: VOD/Series não montam em teste. Molde: scrollContainerRef.test.ts.
 */
const PAGES = path.join(__dirname, '..', 'src', 'pages')

/** Fim de uma string/template literal que começa em `i`. */
function fimDaString(fonte: string, i: number): number {
    const aspas = fonte[i]
    let j = i + 1
    while (j < fonte.length) {
        if (fonte[j] === '\\') {
            j += 2
            continue
        }
        if (fonte[j] === aspas) return j + 1
        j++
    }
    return fonte.length
}

/**
 * Texto entre os parênteses de `marcador` (que termina em `(`), recortado por
 * balanceamento. Comentários e strings são pulados, então um parêntese solto
 * dentro de comentário não desalinha a conta.
 */
function argumento(fonte: string, marcador: string): string {
    const inicio = fonte.indexOf(marcador)
    if (inicio < 0) throw new Error(`marcador ausente no fonte: ${marcador}`)
    let i = inicio + marcador.length
    let nivel = 1
    while (i < fonte.length && nivel > 0) {
        const c = fonte[i]
        const prox = fonte[i + 1]
        if (c === '/' && prox === '/') {
            const fim = fonte.indexOf('\n', i)
            i = fim < 0 ? fonte.length : fim
            continue
        }
        if (c === '/' && prox === '*') {
            const fim = fonte.indexOf('*/', i + 2)
            i = fim < 0 ? fonte.length : fim + 2
            continue
        }
        if (c === "'" || c === '"' || c === '`') {
            i = fimDaString(fonte, i)
            continue
        }
        if (c === '(') nivel++
        else if (c === ')') nivel--
        i++
    }
    if (nivel !== 0) throw new Error(`parênteses desbalanceados a partir de: ${marcador}`)
    return fonte.slice(inicio + marcador.length, i - 1)
}

const CASOS = [
    {
        nome: 'Filmes',
        pagina: 'VOD.tsx',
        memo: 'const filteredStreams = useMemo(',
        laco: 'sortedStreams.filter(',
        chamadas: [
            'movieProgressService.getMoviesInProgress(',
            'movieProgressService.getWatchedMovies('
        ]
    },
    {
        nome: 'Séries',
        pagina: 'Series.tsx',
        memo: 'const filteredSeries = useMemo(',
        laco: 'sortedSeries.filter(',
        chamadas: ['watchProgressService.getContinueWatching(']
    }
]

describe('custo de escolher uma categoria: o histórico é lido uma vez, não por card', () => {
    it.each(CASOS)('$nome: o callback do filter não varre o histórico', (caso) => {
        const fonte = fs.readFileSync(path.join(PAGES, caso.pagina), 'utf-8')
        const corpoDoMemo = argumento(fonte, caso.memo)
        const inicioDoLaco = corpoDoMemo.indexOf(caso.laco)
        expect(inicioDoLaco, `${caso.laco} sumiu do memo`).toBeGreaterThanOrEqual(0)

        const porItem = argumento(corpoDoMemo, caso.laco)
        for (const chamada of caso.chamadas) {
            expect(porItem.includes(chamada), `${chamada} roda por item`).toBe(false)
        }
    })

    it.each(CASOS)('$nome: a leitura do histórico continua, fora do laço', (caso) => {
        const fonte = fs.readFileSync(path.join(PAGES, caso.pagina), 'utf-8')
        const corpoDoMemo = argumento(fonte, caso.memo)
        const preludio = corpoDoMemo.slice(0, corpoDoMemo.indexOf(caso.laco))
        for (const chamada of caso.chamadas) {
            expect(preludio.includes(chamada), `${chamada} não é lida antes do laço`).toBe(true)
        }
    })
})
