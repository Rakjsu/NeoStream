import { describe, it, expect } from 'vitest'
import { planDlnaCommand, clampVolume, stepVolume, muteTarget } from './dlnaRemoteRouting'

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
