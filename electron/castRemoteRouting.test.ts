import { describe, it, expect, vi } from 'vitest'
import { routeCastCommand, type RoutableCastSession } from './castRemoteRouting'

function fakeSession(status: Partial<RoutableCastSession['status']> = {}) {
    const session = {
        status: {
            playing: true,
            currentTime: 100,
            volume: 0.5,
            queue: [] as { itemId: number }[],
            subtitleAvailable: false,
            subtitleEnabled: true,
            ...status,
        },
        pause: vi.fn(),
        resume: vi.fn(),
        seek: vi.fn(),
        setVolume: vi.fn(),
        queueSkip: vi.fn(),
        setSubtitleEnabled: vi.fn(),
    }
    return session
}

const QUEUE = [{ itemId: 1 }, { itemId: 2 }, { itemId: 3 }]

describe('routeCastCommand', () => {
    it('togglePlay pausa quando tocando e retoma quando pausado', () => {
        const playing = fakeSession({ playing: true })
        expect(routeCastCommand(playing, 'togglePlay', undefined, 0.3).handled).toBe(true)
        expect(playing.pause).toHaveBeenCalled()

        const paused = fakeSession({ playing: false })
        routeCastCommand(paused, 'togglePlay', undefined, 0.3)
        expect(paused.resume).toHaveBeenCalled()
    })

    it('stop devolve stop=true (o caller derruba a sessão)', () => {
        const s = fakeSession()
        const result = routeCastCommand(s, 'stop', undefined, 0.3)
        expect(result).toMatchObject({ handled: true, stop: true })
    })

    it('seek é relativo no fio e vira absoluto (nunca negativo)', () => {
        const s = fakeSession({ currentTime: 100 })
        routeCastCommand(s, 'seek', 30, 0.3)
        expect(s.seek).toHaveBeenCalledWith(130)
        routeCastCommand(s, 'seek', -500, 0.3)
        expect(s.seek).toHaveBeenCalledWith(0)
        // seconds inválido: consumido sem seek (não cai no zap local).
        expect(routeCastCommand(s, 'seek', undefined, 0.3).handled).toBe(true)
        expect(s.seek).toHaveBeenCalledTimes(2)
    })

    it('next/previous com fila pulam episódio; sem fila caem pro zap local', () => {
        const withQueue = fakeSession({ queue: QUEUE })
        expect(routeCastCommand(withQueue, 'next', undefined, 0.3).handled).toBe(true)
        expect(withQueue.queueSkip).toHaveBeenCalledWith('next')
        routeCastCommand(withQueue, 'previous', undefined, 0.3)
        expect(withQueue.queueSkip).toHaveBeenCalledWith('prev')

        const noQueue = fakeSession({ queue: [] })
        expect(routeCastCommand(noQueue, 'next', undefined, 0.3).handled).toBe(false)
        expect(noQueue.queueSkip).not.toHaveBeenCalled()
    })

    it('volumeUp/Down com clamp em 0..1', () => {
        const loud = fakeSession({ volume: 0.95 })
        routeCastCommand(loud, 'volumeUp', undefined, 0.3)
        expect(loud.setVolume).toHaveBeenCalledWith(1)

        const quiet = fakeSession({ volume: 0.05 })
        routeCastCommand(quiet, 'volumeDown', undefined, 0.3)
        expect(quiet.setVolume).toHaveBeenCalledWith(0)
    })

    it('mute lembra o volume e o segundo toque restaura', () => {
        const s = fakeSession({ volume: 0.7 })
        const muted = routeCastCommand(s, 'mute', undefined, 0.3)
        expect(s.setVolume).toHaveBeenCalledWith(0)
        expect(muted.preMuteVolume).toBe(0.7) // lembrado

        const s2 = fakeSession({ volume: 0 })
        const unmuted = routeCastCommand(s2, 'mute', undefined, muted.preMuteVolume)
        expect(s2.setVolume).toHaveBeenCalledWith(0.7)
        expect(unmuted.preMuteVolume).toBe(0.7)
    })

    it('subtitle alterna quando há track; sem track é recusado', () => {
        const withSub = fakeSession({ subtitleAvailable: true, subtitleEnabled: true })
        expect(routeCastCommand(withSub, 'subtitle', undefined, 0.3).handled).toBe(true)
        expect(withSub.setSubtitleEnabled).toHaveBeenCalledWith(false)

        const noSub = fakeSession({ subtitleAvailable: false })
        expect(routeCastCommand(noSub, 'subtitle', undefined, 0.3).handled).toBe(false)
        expect(noSub.setSubtitleEnabled).not.toHaveBeenCalled()
    })

    it('ação desconhecida não é consumida', () => {
        const s = fakeSession()
        expect(routeCastCommand(s, 'fazAlgo', undefined, 0.3).handled).toBe(false)
    })
})
