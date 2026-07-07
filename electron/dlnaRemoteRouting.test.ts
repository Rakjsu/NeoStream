import { describe, it, expect } from 'vitest'
import { planDlnaCommand, clampVolume, stepVolume, muteTarget, dlnaStateFields } from './dlnaRemoteRouting'

describe('planDlnaCommand (controle web → sessão DLNA)', () => {
    it('mapeia as ações de transporte', () => {
        expect(planDlnaCommand('togglePlay', undefined)).toEqual({ kind: 'toggle' })
        expect(planDlnaCommand('stop', undefined)).toEqual({ kind: 'stop' })
        expect(planDlnaCommand('seek', 30)).toEqual({ kind: 'seekRelative', seconds: 30 })
        expect(planDlnaCommand('seek', -30)).toEqual({ kind: 'seekRelative', seconds: -30 })
        expect(planDlnaCommand('volumeUp', undefined)).toEqual({ kind: 'volumeStep', delta: 10 })
        expect(planDlnaCommand('volumeDown', undefined)).toEqual({ kind: 'volumeStep', delta: -10 })
        expect(planDlnaCommand('mute', undefined)).toEqual({ kind: 'muteToggle' })
    })

    it('setVolume converte o nível do fio (0..1) pra 0..100 com clamp', () => {
        expect(planDlnaCommand('setVolume', 0.42)).toEqual({ kind: 'setVolume', level: 42 })
        expect(planDlnaCommand('setVolume', 7)).toEqual({ kind: 'setVolume', level: 100 })
        expect(planDlnaCommand('setVolume', -1)).toEqual({ kind: 'setVolume', level: 0 })
    })

    it('valor inválido é consumido como no-op (não vaza pro player local)', () => {
        expect(planDlnaCommand('seek', undefined)).toEqual({ kind: 'noop' })
        expect(planDlnaCommand('setVolume', Number.NaN)).toEqual({ kind: 'noop' })
    })

    it('ações que a DLNA não fala caem pro renderer (null)', () => {
        for (const action of ['next', 'previous', 'subtitle', 'setAudioTrack', 'fazAlgo']) {
            expect(planDlnaCommand(action, undefined)).toBeNull()
        }
    })
})

describe('dlnaStateFields (status DLNA → estado do celular)', () => {
    it('mapeia pro mesmo formato do Chromecast (volume 0..1)', () => {
        expect(dlnaStateFields({ state: 'PLAYING', position: 90, duration: 3600, volume: 40, title: 'Filme', deviceName: 'Sala Samsung' })).toEqual({
            casting: true, castPlaying: true, castTime: 90, castDuration: 3600, castTitle: 'Filme', castVolume: 0.4, castDevice: 'Sala Samsung',
        })
        expect(dlnaStateFields({ state: 'PAUSED_PLAYBACK', position: 90, duration: 3600, volume: null, title: 'Filme', deviceName: '' }))
            .toMatchObject({ castPlaying: false, castVolume: null })
        expect(dlnaStateFields({ state: 'TRANSITIONING', position: 0, duration: 0, volume: 150, title: '', deviceName: '' }))
            .toMatchObject({ castPlaying: true, castVolume: 1 })
    })
})

describe('helpers de volume', () => {
    it('clamp e passos em 0..100', () => {
        expect(clampVolume(150)).toBe(100)
        expect(clampVolume(-5)).toBe(0)
        expect(stepVolume(95, 10)).toBe(100)
        expect(stepVolume(5, -10)).toBe(0)
        expect(stepVolume(50, 10)).toBe(60)
    })

    it('mute alterna lembrando o volume anterior', () => {
        expect(muteTarget(70, 30)).toEqual({ level: 0, preMute: 70 })   // muta e lembra
        expect(muteTarget(0, 70)).toEqual({ level: 70, preMute: 70 })   // restaura
        expect(muteTarget(0, 0)).toEqual({ level: 30, preMute: 0 })     // sem memória: padrão são
    })
})
