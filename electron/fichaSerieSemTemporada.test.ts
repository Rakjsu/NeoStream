import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 📺 A ficha da série não pode ficar em branco quando o provedor diz "deu certo".
 *
 * `series:get-info` devolve `{ success: true, info: { episodes: {} } }` em três
 * caminhos reais: M3U cujo `series_id` não casou — os ids são **posicionais**,
 * numerados sobre uma lista ordenada por nome, então uma série nova no meio
 * desloca todo mundo e o id guardado em Favoritos / Assistir Depois / continuar
 * assistindo cai no vazio —, Stalker sem temporadas, e painel Xtream que manda
 * erro com HTTP 200.
 *
 * Sem guarda, o efeito gravava o `seriesInfo`, apagava o `loading` e deixava o
 * `loadError` em false — e nenhuma das três condições de render casa: a lista
 * pede `seasons.length > 0`, o aviso com "Tentar de novo" pede `loadError`. A
 * coluna de 320px, com borda e fundo próprios, ficava vazia para sempre.
 *
 * O guarda é estrutural porque o repositório não monta React em teste (não há
 * `@testing-library/react` nem um único `.test.tsx`); mesmo molde do
 * `electron/scrollContainerRef.test.ts`.
 */
const MODAL = path.join(__dirname, '..', 'src', 'components', 'ContentDetailModal.tsx')

const fonte = fs.readFileSync(MODAL, 'utf-8').split('\r\n').join('\n')
const efeito = fonte.slice(
    fonte.indexOf("invoke('series:get-info'"),
    fonte.indexOf('}, [isOpen, contentId, contentType, retryNonce])'),
)

describe('ficha da série: nenhuma saída do efeito apaga o loading sem deixar algo na tela', () => {
    it('recorta mesmo o efeito certo (marcadores únicos no arquivo)', () => {
        // Sem esta sanidade, um marcador renomeado faria o `indexOf` devolver
        // -1, o recorte viraria lixo e os outros dois casos ficariam vermelhos
        // pelo motivo errado.
        expect(fonte.split("invoke('series:get-info'")).toHaveLength(2)
        expect(fonte.split('}, [isOpen, contentId, contentType, retryNonce])')).toHaveLength(2)
        expect(efeito.length).toBeGreaterThan(500)
    })

    it('resposta "deu certo" sem temporada vira erro de carga, não coluna em branco', () => {
        expect(efeito).toMatch(/sortedSeasonKeys\(data\?\.episodes\)\.length === 0[\s\S]{0,400}setLoadError\(true\)/)
    })

    it('a cadeia do invoke termina em .catch', () => {
        // O `.catch` de dentro pendura no `.then(data)` e só pega exceção do
        // corpo dele. O que fecha o `invoke` vem depois do `} else {` da
        // bifurcação — sem ele, a rejeição fica solta e o "Carregando
        // episódios..." não sai nunca mais da coluna.
        const depoisDaBifurcacao = efeito.slice(efeito.lastIndexOf('} else {'))
        expect(depoisDaBifurcacao).toContain('.catch(')
    })
})
