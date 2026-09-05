import { describe, expect, it } from 'vitest'
import {
    ESTILO_NEUTRO, ESTILOS_DE_SAIDA, animarSaida, restaurarJanela, type AlvoDeEstilo, type FaseJanela,
} from './windowChrome'

/**
 * 🪟 O bug que motivou isto: o X do title bar deixava o body em opacity:0 e
 * a janela voltava da bandeja cinza. A garantia aqui é que TODA fase de saída
 * tem volta — e que a volta é completa (não "restaurou opacity e esqueceu o
 * transform").
 */

function alvo(): AlvoDeEstilo {
    return { transition: '', opacity: '', transform: '' }
}

describe('windowChrome', () => {
    it.each(Object.keys(ESTILOS_DE_SAIDA) as FaseJanela[])(
        'a fase %s tem volta: sair e restaurar devolve o body ao estado neutro',
        fase => {
            const body = alvo()
            animarSaida(body, fase)
            expect(body.opacity).not.toBe('1') // a saída de fato mexeu no body
            restaurarJanela(body)
            expect(body).toEqual(ESTILO_NEUTRO) // campo a campo
        },
    )

    it('o estado neutro é visível e sem transição pendurada', () => {
        expect(ESTILO_NEUTRO.opacity).toBe('1')
        expect(ESTILO_NEUTRO.transition).toBe('')
    })

    it('fechar NÃO é uma fase de saída — o renderer não sabe se vai morrer ou esconder', () => {
        // Se alguém adicionar `close` ao mapa, este teste cai e obriga a ler o
        // comentário do módulo antes de reintroduzir o bug.
        expect(Object.keys(ESTILOS_DE_SAIDA)).not.toContain('close')
    })

    it('restaurar é idempotente', () => {
        const body = alvo()
        restaurarJanela(body)
        restaurarJanela(body)
        expect(body).toEqual(ESTILO_NEUTRO)
    })
})
