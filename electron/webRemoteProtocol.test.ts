import { describe, it, expect } from 'vitest'
import {
    computeAcceptKey,
    buildHandshakeResponse,
    encodeTextFrame,
    decodeFrames,
    encodePongFrame,
    parseRemoteCommand,
    isPinLockedOut,
    registerPinFailure,
    PIN_MAX_FAILS,
    PIN_LOCK_MS,
} from './webRemoteProtocol'

/** Mask a text payload as a browser client would (client→server frames). */
function maskedClientTextFrame(text: string, mask = [0x12, 0x34, 0x56, 0x78]): Uint8Array {
    const payload = Buffer.from(text, 'utf-8')
    const header = [0x81, 0x80 | payload.length, ...mask]
    const masked = payload.map((b, i) => b ^ mask[i & 3])
    return Uint8Array.from([...header, ...masked])
}

describe('handshake', () => {
    it('computeAcceptKey usa a GUID do RFC 6455', () => {
        // Canonical example from the spec.
        expect(computeAcceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
    })
    it('buildHandshakeResponse traz os cabeçalhos de upgrade', () => {
        const res = buildHandshakeResponse('dGhlIHNhbXBsZSBub25jZQ==')
        expect(res).toContain('HTTP/1.1 101 Switching Protocols')
        expect(res).toContain('Upgrade: websocket')
        expect(res).toContain('Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
    })
})

describe('frames', () => {
    it('encodeTextFrame → decodeFrames faz o round-trip (com máscara do cliente)', () => {
        const encoded = encodeTextFrame('{"type":"state"}')
        // Server frames are unmasked; feed a masked CLIENT frame to the decoder.
        const clientFrame = maskedClientTextFrame('{"type":"state"}')
        const { frames, rest } = decodeFrames(clientFrame)
        expect(frames).toEqual([{ type: 'text', text: '{"type":"state"}' }])
        expect(rest.length).toBe(0)
        // Sanity: the server encoding starts with the text opcode + fin bit.
        expect(encoded[0]).toBe(0x81)
    })

    it('decodeFrames devolve o resto quando o frame está incompleto', () => {
        const full = maskedClientTextFrame('ping')
        const { frames, rest } = decodeFrames(full.subarray(0, full.length - 2))
        expect(frames).toHaveLength(0)
        expect(rest.length).toBe(full.length - 2)
    })

    it('separa múltiplos frames grudados', () => {
        const glued = new Uint8Array([...maskedClientTextFrame('a'), ...maskedClientTextFrame('b')])
        const { frames } = decodeFrames(glued)
        expect(frames.map(f => f.type === 'text' && f.text)).toEqual(['a', 'b'])
    })

    it('reconhece close e ping', () => {
        const close = Uint8Array.from([0x88, 0x80, 0, 0, 0, 0])
        expect(decodeFrames(close).frames[0]).toEqual({ type: 'close' })
        expect(encodePongFrame(Uint8Array.from([1, 2]))[0]).toBe(0x8a)
    })
})

describe('parseRemoteCommand', () => {
    it('aceita ações conhecidas', () => {
        expect(parseRemoteCommand('{"action":"togglePlay"}')).toEqual({ action: 'togglePlay' })
        expect(parseRemoteCommand('{"action":"seek","seconds":30}')).toEqual({ action: 'seek', seconds: 30 })
    })
    it('aceita playChannel com id de canal', () => {
        expect(parseRemoteCommand('{"action":"playChannel","channelId":"1234"}'))
            .toEqual({ action: 'playChannel', channelId: '1234' })
    })
    it('aceita requestEpg com id de canal', () => {
        expect(parseRemoteCommand('{"action":"requestEpg","channelId":"77"}'))
            .toEqual({ action: 'requestEpg', channelId: '77' })
        expect(parseRemoteCommand('{"action":"requestEpg"}')).toBeNull()
    })
    it('aceita requestCatalog e castMovie', () => {
        expect(parseRemoteCommand('{"action":"requestCatalog"}')).toEqual({ action: 'requestCatalog' })
        expect(parseRemoteCommand('{"action":"castMovie","movieId":"42"}'))
            .toEqual({ action: 'castMovie', movieId: '42' })
        expect(parseRemoteCommand('{"action":"castMovie"}')).toBeNull() // movieId ausente
    })
    it('aceita castMovieQueue com ids válidos e filtra lixo', () => {
        expect(parseRemoteCommand('{"action":"castMovieQueue","movieIds":["1","2","3"]}'))
            .toEqual({ action: 'castMovieQueue', movieIds: ['1', '2', '3'] })
        // Filtra não-strings/vazios; fica só o válido.
        expect(parseRemoteCommand('{"action":"castMovieQueue","movieIds":["7", 8, "", null]}'))
            .toEqual({ action: 'castMovieQueue', movieIds: ['7'] })
        expect(parseRemoteCommand('{"action":"castMovieQueue","movieIds":[]}')).toBeNull()
        expect(parseRemoteCommand('{"action":"castMovieQueue"}')).toBeNull()
    })
    it('rejeita lixo e ações desconhecidas', () => {
        expect(parseRemoteCommand('não-json')).toBeNull()
        expect(parseRemoteCommand('{"action":"rm -rf"}')).toBeNull()
        expect(parseRemoteCommand('{"action":"seek"}')).toBeNull() // seconds ausente
        expect(parseRemoteCommand('{"action":"playChannel"}')).toBeNull() // channelId ausente
        expect(parseRemoteCommand('{"action":"playChannel","channelId":""}')).toBeNull() // id vazio
        expect(parseRemoteCommand('{"action":"playChannel","channelId":42}')).toBeNull() // id não-string
        expect(parseRemoteCommand('42')).toBeNull()
    })
})

describe('PIN lockout', () => {
    it('conta falhas e só bloqueia ao atingir o limite', () => {
        let entry = registerPinFailure(undefined, 1000)
        expect(entry).toEqual({ fails: 1, lockedUntil: 0 })
        for (let i = 2; i < PIN_MAX_FAILS; i++) {
            entry = registerPinFailure(entry, 1000)
            expect(entry.fails).toBe(i)
            expect(entry.lockedUntil).toBe(0)
        }
        // A falha nº PIN_MAX_FAILS arma o cooldown e zera o contador.
        entry = registerPinFailure(entry, 1000)
        expect(entry.fails).toBe(0)
        expect(entry.lockedUntil).toBe(1000 + PIN_LOCK_MS)
    })
    it('isPinLockedOut respeita a janela de cooldown', () => {
        const locked = { fails: 0, lockedUntil: 5000 }
        expect(isPinLockedOut(locked, 4999)).toBe(true)
        expect(isPinLockedOut(locked, 5000)).toBe(false) // expirou
        expect(isPinLockedOut(locked, 6000)).toBe(false)
        expect(isPinLockedOut(undefined, 1)).toBe(false)
        expect(isPinLockedOut({ fails: 2, lockedUntil: 0 }, 1)).toBe(false)
    })
})
