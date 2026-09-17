import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * ⏯️ A fileira "Continuar assistindo" ordena FILME e SÉRIE na mesma lista.
 *
 * A chave da série é `lastWatchedAt` — epoch em ms (~1,7e12). A chave do filme
 * era `currentTime` — os SEGUNDOS já vistos (0–10.000). Comparar os dois tem
 * duas consequências: toda série em andamento vence todo filme em andamento,
 * sempre; e entre filmes a ordem vira "quem está mais perto do fim" em vez de
 * "quem foi visto por último". A MESMA lista ordenada alimenta o "Retomar ao
 * abrir" (`items[0]`), então o app oferecia retomar a série mais antiga.
 *
 * Não existe @testing-library/react no repositório, então o guarda é
 * estrutural — mas não é reencenação do diff: ele RECORTA do `Home.tsx` os dois
 * literais `items.push({...})` e o comparador de `items.sort(...)`, compila os
 * três com `new Function` (mesma técnica de `electron/webRemotePage.test.ts`) e
 * roda a ordenação de verdade com dados sintéticos. Fica vermelho tanto se o
 * carimbo sumir do literal quanto se o comparador voltar a misturar unidades —
 * as duas metades do defeito — e fica verde para qualquer outra forma de
 * carimbar a data, porque ele mede a ORDEM, não o texto do código.
 *
 * Preço de não ter render em teste: se um dia essa lógica sair da Home para um
 * helper, o recorte falha com "não achei ... em Home.tsx" e o guarda deve ser
 * reescrito como teste de unidade do helper (mais barato).
 */
const HOME = path.join(__dirname, '..', 'src', 'pages', 'Home.tsx')
const fonte = fs.readFileSync(HOME, 'utf-8').replace(/\r\n/g, '\n')

const iSeries = fonte.indexOf('const seriesProgress = watchProgressService.getContinueWatching();')
const iFilmes = fonte.indexOf('const moviesInProgress = movieProgressService.getMoviesInProgress();')
const iSort = iFilmes < 0 ? -1 : fonte.indexOf('items.sort(', iFilmes)

/** Recorta o argumento entre parênteses balanceados a partir de `abre`. */
function argumentoDe(origem: number, abre: string, rotulo: string): string {
    const ini = fonte.indexOf(abre, origem)
    expect(ini, `não achei \`${abre}\` (${rotulo}) em Home.tsx`).toBeGreaterThan(-1)
    let i = ini + abre.length - 1
    let nivel = 0
    for (; i < fonte.length; i++) {
        if (fonte[i] === '(') nivel++
        else if (fonte[i] === ')') {
            nivel--
            if (nivel === 0) break
        }
    }
    expect(i, `parênteses não fecharam em ${rotulo}`).toBeLessThan(fonte.length)
    return fonte.slice(ini + abre.length, i)
}

type Item = Record<string, unknown>

/**
 * Compila um `items.push({...})` do fonte numa fábrica. O literal só enxerga os
 * nomes em `params`; se ele passar a usar outra variável do efeito (o item
 * D055, por exemplo, quer ler `updatedSeries` aqui), o erro sai explicando o
 * que acrescentar em vez de um ReferenceError cru.
 */
function fabricaDoLiteral(origem: number, rotulo: string, params: string[]) {
    const bruto = new Function(...params, `return (${argumentoDe(origem, 'items.push(', rotulo)});`)
    return (...args: unknown[]): Item => {
        try {
            return bruto(...args) as Item
        } catch (erro) {
            throw new Error(
                `O ${rotulo} passou a depender de algo fora de {${params.join(', ')}}: ` +
                `${(erro as Error).message}. Acrescente o valor falso correspondente neste guarda.`,
                { cause: erro }
            )
        }
    }
}

describe('Continuar assistindo: filme e série na mesma régua de tempo', () => {
    it('os três pedaços ainda moram na Home (senão o guarda não mede nada)', () => {
        expect(iSeries).toBeGreaterThan(-1)
        expect(iFilmes).toBeGreaterThan(iSeries)
        expect(iSort).toBeGreaterThan(iFilmes)
    })

    const montaSerie = fabricaDoLiteral(iSeries, 'literal da série', ['seriesId', 'seriesData', 'progress'])
    const montaFilme = fabricaDoLiteral(iFilmes, 'literal do filme', ['movieId', 'movieData', 'progress'])
    const comparador = new Function(
        `return (${argumentoDe(iSort, 'items.sort(', 'comparador do sort')});`
    )() as (a: Item, b: Item) => number

    const AGORA = 1_760_000_000_000
    const DIA = 86_400_000

    it('o filme parado agora vem ANTES da série vista há meses', () => {
        const serie = montaSerie(
            '7',
            { name: 'Série de meses atrás', cover: '' },
            { seriesId: '7', lastWatchedSeason: 1, lastWatchedEpisode: 3, lastWatchedAt: AGORA - 120 * DIA }
        )
        // Um minuto de filme: `currentTime` = 60 contra o epoch da série.
        const filme = montaFilme(
            '42',
            { name: 'Filme de agora', cover: '', stream_icon: '' },
            { currentTime: 60, duration: 7200, progress: 1, watchedAt: AGORA }
        )

        const lista = [serie, filme]
        lista.sort(comparador)
        expect(lista[0].name).toBe('Filme de agora')
    })

    it('entre filmes ganha o mais recente, não o que está mais perto do fim', () => {
        const comecadoHoje = montaFilme(
            '1',
            { name: 'Começado hoje', cover: '', stream_icon: '' },
            { currentTime: 60, duration: 7200, progress: 1, watchedAt: AGORA }
        )
        const quaseNoFim = montaFilme(
            '2',
            { name: 'Visto mês passado', cover: '', stream_icon: '' },
            { currentTime: 6000, duration: 7200, progress: 83, watchedAt: AGORA - 30 * DIA }
        )

        const lista = [quaseNoFim, comecadoHoje]
        lista.sort(comparador)
        expect(lista[0].name).toBe('Começado hoje')
    })

    it('entre séries a ordem continua sendo a mais recente', () => {
        const antiga = montaSerie('1', { name: 'Série antiga', cover: '' }, { lastWatchedAt: AGORA - 40 * DIA })
        const nova = montaSerie('2', { name: 'Série de ontem', cover: '' }, { lastWatchedAt: AGORA - DIA })

        const lista = [antiga, nova]
        lista.sort(comparador)
        expect(lista[0].name).toBe('Série de ontem')
    })

    it('o "Retomar ao abrir" continua saindo do topo da MESMA lista ordenada', () => {
        // Se alguém desacoplar os dois, a retomada volta a oferecer outro item.
        expect(fonte.includes('setResumeOffer(items[0])')).toBe(true)
        expect(fonte.indexOf('setResumeOffer(items[0])')).toBeGreaterThan(iSort)
    })
})
