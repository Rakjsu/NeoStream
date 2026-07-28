import { describe, it, expect } from 'vitest'
import { isValidSessionPin, resolveSessionPin } from './webRemotePin'

describe('PIN do pareamento sobrevive ao restart do desktop', () => {
    it('PIN salvo é reaproveitado sem regravar', () => {
        expect(resolveSessionPin('0421', () => '9999')).toEqual({ pin: '0421', persist: false })
    })

    it('sem PIN salvo sorteia um e pede persistência', () => {
        expect(resolveSessionPin('', () => '1234')).toEqual({ pin: '1234', persist: true })
        expect(resolveSessionPin(undefined, () => '1234')).toEqual({ pin: '1234', persist: true })
    })

    it('valor corrompido na store não vira PIN', () => {
        expect(resolveSessionPin('12', () => '1234')).toEqual({ pin: '1234', persist: true })
        expect(resolveSessionPin('abcd', () => '1234')).toEqual({ pin: '1234', persist: true })
        expect(resolveSessionPin(4321, () => '1234')).toEqual({ pin: '1234', persist: true })
    })

    it('isValidSessionPin exige 4 dígitos', () => {
        expect(isValidSessionPin('0000')).toBe(true)
        expect(isValidSessionPin('00000')).toBe(false)
        expect(isValidSessionPin(null)).toBe(false)
    })
})
