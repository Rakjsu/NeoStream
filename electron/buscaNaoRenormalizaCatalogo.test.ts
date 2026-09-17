import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔎 A busca global não re-normaliza o catálogo inteiro a cada busca.
 *
 * `scoreMatch` normaliza (NFD + strip de acentos + toLowerCase) a query E o
 * nome dentro da própria função. Como `rankItems` chamava `scoreMatch` por
 * item, cada busca do Ctrl+K pagava DUAS normalizações por título — a mesma
 * query dezenas de milhares de vezes, e todo nome do catálogo do zero, nas
 * três seções (filmes, séries, canais).
 *
 * O conserto tem duas pontas. A primeira — `rankItems` normaliza a query uma
 * vez e aceita o nome já pronto — é medida de verdade em
 * `src/utils/searchRank.test.ts`, contando chamadas de `String#normalize`.
 *
 * Esta aqui é a SEGUNDA: o `GlobalSearch` precisa guardar o nome normalizado
 * no cache de sessão e repassá-lo. Sem ela o parâmetro novo fica opcional e
 * sem ninguém usando — o ganho existiria só no teste. O `GlobalSearch` fala
 * IPC em três canais na montagem, então aqui o guarda é estrutural.
 */
const RAIZ = path.join(__dirname, '..')

function ler(rel: string): string {
    return fs.readFileSync(path.join(RAIZ, rel), 'utf-8').split('\r\n').join('\n')
}

/** Recorta um trecho entre duas âncoras, falhando FECHADO se alguma sumir. */
function trecho(fonte: string, de: string, ate: string, oQue: string): string {
    const i = fonte.indexOf(de)
    expect(i, `não achei \`${de}\` (${oQue})`).toBeGreaterThan(-1)
    const j = fonte.indexOf(ate, i)
    expect(j, `não achei o fim de ${oQue}`).toBeGreaterThan(i)
    return fonte.slice(i, j)
}

describe('busca global: o nome normalizado vem pronto do cache', () => {
    it('o item do cache de sessão carrega o nome normalizado', () => {
        const fonte = ler('src/components/GlobalSearch.tsx')
        const tipo = trecho(fonte, 'interface SearchItem {', '\n}', 'a interface SearchItem')
        // Obrigatório, não opcional: é isto que faz o `tsc` recusar um
        // construtor novo de SearchItem que esqueça de preencher o campo.
        expect(/\n\s*normalizedName: string;/.test(tipo)).toBe(true)
    })

    it('ele é calculado UMA vez, onde o cache é montado', () => {
        const fonte = ler('src/components/GlobalSearch.tsx')
        const mapa = trecho(fonte, 'function mapItems', '\n}', 'o mapItems')
        expect(mapa.includes('normalizedName: normalizeForSearch(')).toBe(true)
    })

    it('e a busca o REPASSA para o rankItems', () => {
        // Sem este repasse o campo seria só peso morto: `rankItems` voltaria a
        // normalizar cada nome do catálogo por busca.
        const fonte = ler('src/components/GlobalSearch.tsx')
        const busca = trecho(fonte, 'function matchItems', '\n}', 'o matchItems')
        expect(/rankItems\([^)]*normalizedName/.test(busca)).toBe(true)
    })
})
