import { describe, it, expect } from 'vitest'
import {
    STATUS_DE_GRAVACAO,
    sanitizarStatusDeGravacao,
    sanitizarArquivoDeGravacao,
} from './webRemoteProtocol'

/**
 * 📼 O relay de gravações para o celular.
 *
 * A página do celular já tinha os ramos de 'renamed', 'protected' e
 * 'unprotected' escritos, com textos próprios — mas o servidor só aceitava
 * quatro status e virava 'error' no resto. Três fluxos caíam no mesmo
 * `else showToast(L.recFail)`: renomear com sucesso, proteger/desproteger, e a
 * recusa de apagar um arquivo travado. Todos respondiam, literalmente, "Falha
 * ao iniciar a gravação".
 */
describe('sanitizarStatusDeGravacao', () => {
    it.each(['ok', 'stopped', 'deleted', 'cancelled'])('mantém o status antigo %s', (status) => {
        expect(sanitizarStatusDeGravacao(status)).toBe(status)
    })

    it.each(['renamed', 'protected', 'unprotected'])('deixa passar o status %s, que a página já sabe mostrar', (status) => {
        expect(sanitizarStatusDeGravacao(status)).toBe(status)
    })

    it('qualquer outra coisa continua virando erro', () => {
        expect(sanitizarStatusDeGravacao('qualquer')).toBe('error')
        expect(sanitizarStatusDeGravacao(undefined)).toBe('error')
        expect(sanitizarStatusDeGravacao(42)).toBe('error')
        expect(sanitizarStatusDeGravacao({ status: 'renamed' })).toBe('error')
    })

    it('a lista é fechada — o celular só ouve o que a página sabe desenhar', () => {
        expect([...STATUS_DE_GRAVACAO]).toEqual(
            ['ok', 'stopped', 'deleted', 'cancelled', 'renamed', 'protected', 'unprotected']
        )
    })
})

describe('sanitizarArquivoDeGravacao', () => {
    it('propaga o cadeado — sem isto o 🔐 nunca aparecia na lista do celular', () => {
        expect(sanitizarArquivoDeGravacao({ name: 'Jogo.mp4', sizeMb: 812.4, locked: true }))
            .toEqual({ name: 'Jogo.mp4', sizeMb: 812, locked: true })
    })

    it('arquivo sem cadeado vem destravado, não indefinido', () => {
        expect(sanitizarArquivoDeGravacao({ name: 'Filme.mp4', sizeMb: 10 }).locked).toBe(false)
        // `locked` só é verdade quando é o booleano true: string "true" vinda
        // de um cliente qualquer não tranca nada.
        expect(sanitizarArquivoDeGravacao({ name: 'x', locked: 'true' }).locked).toBe(false)
    })

    it('tamanho estranho não vira NaN na tela', () => {
        expect(sanitizarArquivoDeGravacao({ name: 'x', sizeMb: Number.NaN }).sizeMb).toBe(0)
        expect(sanitizarArquivoDeGravacao({ name: 'x', sizeMb: -5 }).sizeMb).toBe(0)
        expect(sanitizarArquivoDeGravacao({ name: 'x' }).sizeMb).toBe(0)
    })

    it('nome longo é cortado e entrada inválida não quebra', () => {
        expect(sanitizarArquivoDeGravacao({ name: 'a'.repeat(300) }).name).toHaveLength(200)
        expect(sanitizarArquivoDeGravacao(null)).toEqual({ name: '', sizeMb: 0, locked: false })
    })
})
