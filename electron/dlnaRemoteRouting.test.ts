import { describe, it, expect } from 'vitest'
import { planDlnaCommand, clampVolume, stepVolume, muteTarget, dlnaStateFields, planDlnaStop } from './dlnaRemoteRouting'

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

describe('planDlnaStop (o Parar não pode depender da última varredura)', () => {
    const sessao = {
        deviceId: 'discovered-uuid:tv::urn-MediaRenderer',
        avTransportUrl: 'http://192.168.0.10:9197/upnp/control/AVTransport1',
    }

    it('varredura limpou o mapa e a TV não respondeu — o Stop sai pela sessão', () => {
        // É o caso real: abrir a janela "Transmitir" dispara uma varredura, a
        // primeira linha dela LIMPA o mapa de descobertos, e a TV ocupada
        // tocando pode não responder ao M-SEARCH. O Parar caía em
        // "Device not found" com o vídeo tocando na sala.
        expect(planDlnaStop(sessao, undefined, sessao.deviceId))
            .toEqual({ from: 'session', controlUrl: sessao.avTransportUrl })
    })

    it('com sessão viva, a URL dela vence a do aparelho', () => {
        // E de quebra pula o fetch da descrição, que é outra coisa que falha
        // com a TV ocupada.
        expect(planDlnaStop(sessao, { host: '192.168.0.10', location: 'http://192.168.0.10:7676/dmr' }, sessao.deviceId))
            .toEqual({ from: 'session', controlUrl: sessao.avTransportUrl })
    })

    it('sessão de OUTRO aparelho não é alvo', () => {
        // Um Parar mirado na TV-B não pode derrubar a sessão da TV-A.
        expect(planDlnaStop(sessao, { host: '192.168.0.20', location: 'http://192.168.0.20:7676/dmr' }, 'discovered-outra-tv'))
            .toEqual({ from: 'device', location: 'http://192.168.0.20:7676/dmr' })
        expect(planDlnaStop(null, { host: '192.168.0.10' }, 'x'))
            .toEqual({ from: 'device', location: 'http://192.168.0.10:9197/dmr' })
    })

    it('sem sessão e sem aparelho não há alvo — só aí o erro é honesto', () => {
        expect(planDlnaStop(null, undefined, 'x')).toBeNull()
        expect(planDlnaStop(sessao, undefined, 'discovered-outra-tv')).toBeNull()
    })
})
