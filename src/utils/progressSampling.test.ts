import { describe, it, expect } from 'vitest'
import { shouldSampleProgress, PROGRESS_SAMPLE_INTERVAL_S } from './progressSampling'

/**
 * Simula a cadência real do `timeupdate` do <video> (~4x por segundo) e conta
 * quantas gravações cada critério dispara. As duas condições antigas estão
 * aqui como referência: é o número delas que este helper tinha que derrubar.
 */
function contarGravacoes(
    duracaoS: number,
    decidir: (currentTime: number, lastSaved: number | null) => boolean
): number {
    let gravacoes = 0
    let ultimo: number | null = null
    for (let t = 0; t < duracaoS; t += 0.25) {
        if (decidir(t, ultimo)) {
            gravacoes++
            ultimo = t
        }
    }
    return gravacoes
}

describe('shouldSampleProgress', () => {
    it('grava a primeira amostra e depois só a cada 5 s', () => {
        expect(shouldSampleProgress(0, null)).toBe(true)
        expect(shouldSampleProgress(0.25, 0)).toBe(false)
        expect(shouldSampleProgress(4.75, 0)).toBe(false)
        expect(shouldSampleProgress(5, 0)).toBe(true)
        expect(shouldSampleProgress(9.75, 5)).toBe(false)
        expect(shouldSampleProgress(10, 5)).toBe(true)
    })

    it('um seek para trás grava na hora (a posição mudou de verdade)', () => {
        expect(shouldSampleProgress(120, 600)).toBe(true)
        expect(shouldSampleProgress(598, 600)).toBe(false)
    })

    it('ignora currentTime inválido', () => {
        expect(shouldSampleProgress(NaN, 10)).toBe(false)
        expect(shouldSampleProgress(-1, 10)).toBe(false)
        // lastSaved corrompido não trava a gravação.
        expect(shouldSampleProgress(10, NaN)).toBe(true)
    })

    it('respeita um intervalo customizado', () => {
        expect(shouldSampleProgress(9, 0, 10)).toBe(false)
        expect(shouldSampleProgress(10, 0, 10)).toBe(true)
    })

    it('num filme de 2 h grava 1x por janela, não 2x nem 4x', () => {
        const duasHoras = 2 * 60 * 60
        const janelas = duasHoras / PROGRESS_SAMPLE_INTERVAL_S

        // Critério antigo do VOD: verdadeiro durante um SEGUNDO inteiro.
        const antigoVod = contarGravacoes(duasHoras, (t) => Math.floor(t) % 5 === 0)
        // Critério antigo do AsyncVideoPlayer: verdadeiro em meio segundo.
        const antigoSeries = contarGravacoes(duasHoras, (t) => t % 5 < 0.5)
        const novo = contarGravacoes(duasHoras, shouldSampleProgress)

        expect(antigoVod).toBe(janelas * 4)
        expect(antigoSeries).toBe(janelas * 2)
        expect(novo).toBe(janelas)
    })
})
