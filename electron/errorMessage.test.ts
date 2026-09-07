import { describe, it, expect } from 'vitest'
import { getErrorMessage } from './errorMessage'

/**
 * Teste de CARACTERIZAÇÃO: este PR não muda comportamento nenhum, e é
 * justamente isso que precisa ficar travado. A função virou uma cópia só, e a
 * tentação seguinte é "melhorá-la" — tratar objeto, prefixar rótulo. Cada caso
 * abaixo é uma forma de entrada que o main realmente produz.
 */
describe('getErrorMessage', () => {
    it('Error devolve a message, inclusive vazia e de subclasse', () => {
        expect(getErrorMessage(new Error('boom'))).toBe('boom')
        expect(getErrorMessage(new Error(''))).toBe('')
        expect(getErrorMessage(new TypeError('tipo errado'))).toBe('tipo errado')
    })

    it('o que não é Error passa por String()', () => {
        expect(getErrorMessage('falhou')).toBe('falhou')
        expect(getErrorMessage(701)).toBe('701')
        expect(getErrorMessage({ code: 701 })).toBe('[object Object]')
        expect(getErrorMessage(null)).toBe('null')
        expect(getErrorMessage(undefined)).toBe('undefined')
    })

    /**
     * O contrato que o DLNA assume. São QUATRO leitores por regex em
     * dlnaHandlers.ts (1098, 1120, 1142, 1146) — mexer no corpo da função os
     * quebra sem que nada aqui ou no build reclame.
     */
    it('o texto continua legível pelas regex do retry da Samsung', () => {
        expect(/\b701\b/.test(getErrorMessage(new Error('SOAP 701 Transition not available')))).toBe(true)
        expect(/\b704\b|restrict|format/i.test(getErrorMessage(new Error('704 restricted')))).toBe(true)
        expect(/\b704\b|restrict|format not supported|not implemented/i
            .test(getErrorMessage(new Error('Format not supported')))).toBe(true)
        expect(/timeout/i.test(getErrorMessage(new Error('Request timeout after 5s')))).toBe(true)
    })
})
