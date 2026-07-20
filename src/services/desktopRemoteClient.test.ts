import { describe, it, expect } from 'vitest'
import { buildRemoteWsUrl, parsePeerState } from './desktopRemoteClient'

describe('desktopRemoteClient (item 38 — PC controla PC)', () => {
    it('buildRemoteWsUrl normaliza esquema/barras e codifica o PIN', () => {
        expect(buildRemoteWsUrl('192.168.0.20:8974', '1234')).toBe('ws://192.168.0.20:8974/?pin=1234')
        expect(buildRemoteWsUrl('https://pc.local:8974/', ' 9%9 ')).toBe('ws://pc.local:8974/?pin=9%259')
        expect(buildRemoteWsUrl('ws://10.0.0.5:8974//', '0007')).toBe('ws://10.0.0.5:8974/?pin=0007')
    })

    it('parsePeerState aceita só type:state e tem defaults seguros', () => {
        expect(parsePeerState(JSON.stringify({ type: 'state', title: 'Canal X', playing: true })))
            .toEqual({ title: 'Canal X', playing: true, casting: false, castTitle: '' })
        expect(parsePeerState(JSON.stringify({ type: 'state', casting: true, castTitle: 'Filme' })))
            .toEqual({ title: '', playing: false, casting: true, castTitle: 'Filme' })
        expect(parsePeerState(JSON.stringify({ type: 'guide' }))).toBeNull()
        expect(parsePeerState('não-json')).toBeNull()
    })
})
