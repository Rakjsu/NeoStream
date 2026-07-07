import { describe, it, expect } from 'vitest'
import { planAirplayCommand, parseScrub, airplayStateFields } from './airplayRemoteRouting'

describe('planAirplayCommand (controle web → sessão AirPlay)', () => {
    it('togglePlay vira rate 0/1 conforme o estado rastreado', () => {
        expect(planAirplayCommand('togglePlay', undefined, true)).toEqual({ kind: 'rate', value: 0 })
        expect(planAirplayCommand('togglePlay', undefined, false)).toEqual({ kind: 'rate', value: 1 })
    })

    it('seek relativo e stop', () => {
        expect(planAirplayCommand('seek', 30, true)).toEqual({ kind: 'seekRelative', seconds: 30 })
        expect(planAirplayCommand('seek', -30, true)).toEqual({ kind: 'seekRelative', seconds: -30 })
        expect(planAirplayCommand('seek', undefined, true)).toEqual({ kind: 'noop' })
        expect(planAirplayCommand('stop', undefined, true)).toEqual({ kind: 'stop' })
    })

    it('o que o protocolo não fala cai pro renderer (null)', () => {
        for (const action of ['volumeUp', 'volumeDown', 'mute', 'setVolume', 'subtitle', 'setAudioTrack', 'next', 'previous']) {
            expect(planAirplayCommand(action, 1, true)).toBeNull()
        }
    })
})

describe('parseScrub (GET /scrub)', () => {
    it('extrai duração e posição', () => {
        expect(parseScrub('duration: 3600.5\nposition: 125.25\n')).toEqual({ duration: 3600.5, position: 125.25 })
    })

    it('corpo estranho vira zeros (nunca NaN)', () => {
        expect(parseScrub('')).toEqual({ duration: 0, position: 0 })
        expect(parseScrub('duration: abc')).toEqual({ duration: 0, position: 0 })
    })
})

describe('airplayStateFields (status AirPlay → estado do celular)', () => {
    it('mapeia pro formato comum (sem volume — protocolo não expõe)', () => {
        expect(airplayStateFields({ position: 12.5, duration: 3600, playing: true, title: 'Filme', deviceName: 'Apple TV Sala' })).toEqual({
            casting: true, castPlaying: true, castTime: 12.5, castDuration: 3600,
            castTitle: 'Filme', castVolume: null, castDevice: 'Apple TV Sala',
        })
        expect(airplayStateFields({ position: -1, duration: 0, playing: false, title: '', deviceName: '' }))
            .toMatchObject({ castPlaying: false, castTime: 0, castDuration: 0 })
    })
})
