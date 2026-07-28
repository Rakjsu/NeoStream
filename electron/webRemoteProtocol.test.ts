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
    admitClient,
    isClientBufferOverflow,
    WS_MAX_CLIENTS,
    WS_MAX_CLIENTS_PER_IP,
    WS_MAX_BUFFER_BYTES,
    pinGateKey,
    pinMatches,
    PIN_GLOBAL_MAX_FAILS,
    PIN_GLOBAL_LOCK_MS,
    PIN_GLOBAL_DECAY_MS,
    PIN_MAX_FAILS,
    PIN_LOCK_MS,
    pickLanAddress,
    scoreLanCandidate,
    parseProgressReport,
    encodePingFrame,
    encodeCloseFrame,
    isPeerStale,
    canDeliverTo,
    isLinkPing,
    LINK_PONG_MESSAGE,
    WS_CLOSE_PIN_ROTATED,
    WS_PEER_TIMEOUT_MS,
    parseMobileHello,
    buildDesktopHello,
    compareAppVersions,
    isOutdatedMobile,
    markMobileInHistory,
    parsePushAck,
    REMOTE_PROTOCOL_VERSION,
    MIN_MOBILE_APP_VERSION,
} from './webRemoteProtocol'

/** Mask a text payload as a browser client would (client→server frames). */
function maskedClientTextFrame(text: string, mask = [0x12, 0x34, 0x56, 0x78]): Uint8Array {
    const payload = Buffer.from(text, 'utf-8')
    const header = [0x81, 0x80 | payload.length, ...mask]
    const masked = payload.map((b, i) => b ^ mask[i & 3])
    return Uint8Array.from([...header, ...masked])
}

/** Um pedaço mascarado com FIN/opcode escolhidos (fragmentação do cliente). */
function maskedFragment(opcode: number, fin: boolean, payload: Buffer, mask = [0x12, 0x34, 0x56, 0x78]): Uint8Array {
    const header = [(fin ? 0x80 : 0) | opcode, 0x80 | payload.length, ...mask]
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

describe('fragmentação (FIN/continuation)', () => {
    // O OkHttp do React Native (e proxies da LAN) pode partir uma mensagem em
    // vários frames. Sem ler o FIN, o 1º pedaço virava JSON truncado engolido
    // e as continuações, lixo órfão — "sync que às vezes não pega".
    it('remonta uma mensagem partida em dois frames', () => {
        const full = '{"action":"reportProgress","report":{"kind":"movie"}}'
        const half = Math.floor(full.length / 2)
        const glued = new Uint8Array([
            ...maskedFragment(0x1, false, Buffer.from(full.slice(0, half), 'utf-8')),
            ...maskedFragment(0x0, true, Buffer.from(full.slice(half), 'utf-8')),
        ])
        const { frames, pending } = decodeFrames(glued)
        expect(frames).toEqual([{ type: 'text', text: full }])
        expect(pending).toBeNull()
    })

    it('atravessa chamadas: o pedaço fica em pending até o FIN', () => {
        const first = decodeFrames(maskedFragment(0x1, false, Buffer.from('{"a":', 'utf-8')))
        expect(first.frames).toHaveLength(0)
        expect(first.pending?.opcode).toBe(0x1)
        const second = decodeFrames(maskedFragment(0x0, true, Buffer.from('1}', 'utf-8')), first.pending)
        expect(second.frames).toEqual([{ type: 'text', text: '{"a":1}' }])
        expect(second.pending).toBeNull()
    })

    it('decodifica UTF-8 só no payload remontado (multibyte partido)', () => {
        const bytes = Buffer.from('Ação', 'utf-8') // "ç" ocupa 2 bytes
        const glued = new Uint8Array([
            ...maskedFragment(0x1, false, bytes.subarray(0, 3)),
            ...maskedFragment(0x0, true, bytes.subarray(3)),
        ])
        expect(decodeFrames(glued).frames).toEqual([{ type: 'text', text: 'Ação' }])
    })

    it('ping no meio da fragmentação não quebra a montagem', () => {
        const glued = new Uint8Array([
            ...maskedFragment(0x1, false, Buffer.from('oi ', 'utf-8')),
            ...maskedFragment(0x9, true, Buffer.alloc(0)),
            ...maskedFragment(0x0, true, Buffer.from('mundo', 'utf-8')),
        ])
        const { frames } = decodeFrames(glued)
        expect(frames.map(f => f.type)).toEqual(['ping', 'text'])
        expect(frames[1]).toEqual({ type: 'text', text: 'oi mundo' })
    })

    it('fluxo fora de sincronia derruba o cliente (throw)', () => {
        expect(() => decodeFrames(maskedFragment(0x0, true, Buffer.from('x', 'utf-8')))).toThrow()
        const novoNoMeio = new Uint8Array([
            ...maskedFragment(0x1, false, Buffer.from('a', 'utf-8')),
            ...maskedFragment(0x1, true, Buffer.from('b', 'utf-8')),
        ])
        expect(() => decodeFrames(novoNoMeio)).toThrow()
    })
})

describe('liveness (peer meio-morto)', () => {
    it('encodePingFrame e encodeCloseFrame trazem opcode e código', () => {
        expect(encodePingFrame()[0]).toBe(0x89)
        const bye = encodeCloseFrame(WS_CLOSE_PIN_ROTATED, 'pin-rotated')
        expect(bye[0]).toBe(0x88)
        expect((bye[2] << 8) | bye[3]).toBe(4001)
        expect(Buffer.from(bye.subarray(4)).toString('utf-8')).toBe('pin-rotated')
    })

    it('isPeerStale só depois da tolerância', () => {
        expect(isPeerStale(1000, 1000 + WS_PEER_TIMEOUT_MS)).toBe(false)
        expect(isPeerStale(1000, 1000 + WS_PEER_TIMEOUT_MS + 1)).toBe(true)
    })

    it('canDeliverTo não conta socket destruído, fechado nem calado', () => {
        const now = 1_000_000
        expect(canDeliverTo({ destroyed: false, writable: true, lastSeenAt: now - 1000 }, now)).toBe(true)
        expect(canDeliverTo({ destroyed: true, writable: true, lastSeenAt: now }, now)).toBe(false)
        expect(canDeliverTo({ destroyed: false, writable: false, lastSeenAt: now }, now)).toBe(false)
        // Metade-aberta: o write "funciona", mas ninguém dá sinal há minutos.
        expect(canDeliverTo({ destroyed: false, writable: true, lastSeenAt: now - 120_000 }, now)).toBe(false)
    })

    it('isLinkPing reconhece só o heartbeat do app', () => {
        expect(isLinkPing('{"action":"ping"}')).toBe(true)
        expect(isLinkPing(JSON.stringify({ action: 'ping', t: 5 }))).toBe(true)
        expect(isLinkPing('{"action":"togglePlay"}')).toBe(false)
        expect(isLinkPing('{"action":"deleteRecording","name":"ping"}')).toBe(false)
        expect(isLinkPing('não-json "ping"')).toBe(false)
        expect(JSON.parse(LINK_PONG_MESSAGE)).toEqual({ type: 'pong' })
    })

    it('parseRemoteCommand aceita requestProgress (reconciliação)', () => {
        expect(parseRemoteCommand('{"action":"requestProgress"}')).toEqual({ action: 'requestProgress' })
    })
})

describe('parseRemoteCommand', () => {
    it('aceita ações conhecidas', () => {
        expect(parseRemoteCommand('{"action":"togglePlay"}')).toEqual({ action: 'togglePlay' })
        expect(parseRemoteCommand('{"action":"screenshot"}')).toEqual({ action: 'screenshot' })
        expect(parseRemoteCommand('{"action":"renameRecording","name":"a.ts","newName":"b"}')).toEqual({ action: 'renameRecording', name: 'a.ts', newName: 'b' })
        expect(parseRemoteCommand('{"action":"renameRecording","name":"a.ts"}')).toBeNull()
        expect(parseRemoteCommand('{"action":"toggleProtectRecording","name":"a.ts"}')).toEqual({ action: 'toggleProtectRecording', name: 'a.ts' })
        expect(parseRemoteCommand('{"action":"navKey","key":"up"}')).toEqual({ action: 'navKey', key: 'up' })
        expect(parseRemoteCommand('{"action":"navKey","key":"hack"}')).toBeNull()
        expect(parseRemoteCommand('{"action":"requestFavorites"}')).toEqual({ action: 'requestFavorites' })
        expect(parseRemoteCommand('{"action":"subtitle"}')).toEqual({ action: 'subtitle' })
        expect(parseRemoteCommand('{"action":"seek","seconds":30}')).toEqual({ action: 'seek', seconds: 30 })
    })
    it('aceita playChannel com id de canal', () => {
        expect(parseRemoteCommand('{"action":"playChannel","channelId":"1234"}'))
            .toEqual({ action: 'playChannel', channelId: '1234' })
    })
    it('playChannel carrega o nome do canal (resgate quando as contas diferem)', () => {
        const play = (raw: object) => {
            const command = parseRemoteCommand(JSON.stringify(raw))
            return command && command.action === 'playChannel' ? command : null
        }
        expect(play({ action: 'playChannel', channelId: '1234', name: '  Globo FHD  ' }))
            .toEqual({ action: 'playChannel', channelId: '1234', name: 'Globo FHD' })
        // Nome vazio/inválido não vira string vazia — some do comando.
        expect(play({ action: 'playChannel', channelId: '1', name: '   ' })?.name).toBeUndefined()
        expect(play({ action: 'playChannel', channelId: '1', name: 42 })?.name).toBeUndefined()
        // Cap de 160, o mesmo orçamento do channelName do recordChannel.
        expect(play({ action: 'playChannel', channelId: '1', name: 'x'.repeat(500) })?.name).toHaveLength(160)
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
    it('aceita query opcional em requestCatalog e requestSeries', () => {
        expect(parseRemoteCommand('{"action":"requestCatalog","query":"  Matrix "}'))
            .toEqual({ action: 'requestCatalog', query: 'Matrix' }) // trim
        expect(parseRemoteCommand('{"action":"requestSeries","query":"breaking"}'))
            .toEqual({ action: 'requestSeries', query: 'breaking' })
        // Query vazia/branca ou não-string vira undefined (browse normal).
        expect(parseRemoteCommand('{"action":"requestCatalog","query":"   "}'))
            .toEqual({ action: 'requestCatalog' })
        expect(parseRemoteCommand('{"action":"requestCatalog","query":42}'))
            .toEqual({ action: 'requestCatalog' })
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
    it('aceita requestSeries, requestSeriesInfo e castEpisode', () => {
        expect(parseRemoteCommand('{"action":"requestSeries"}')).toEqual({ action: 'requestSeries' })
        expect(parseRemoteCommand('{"action":"requestSeriesInfo","seriesId":"7"}'))
            .toEqual({ action: 'requestSeriesInfo', seriesId: '7' })
        expect(parseRemoteCommand('{"action":"requestSeriesInfo"}')).toBeNull() // seriesId ausente
        expect(parseRemoteCommand('{"action":"requestSeriesInfo","seriesId":7}')).toBeNull() // não-string
        expect(parseRemoteCommand('{"action":"castEpisode","episodeId":"e99"}'))
            .toEqual({ action: 'castEpisode', episodeId: 'e99' })
        expect(parseRemoteCommand('{"action":"castEpisode"}')).toBeNull() // episodeId ausente
        expect(parseRemoteCommand('{"action":"castEpisode","episodeId":""}')).toBeNull() // id vazio
    })
    it('aceita requestDevices e um alvo de cast opcional (deviceId+deviceType)', () => {
        expect(parseRemoteCommand('{"action":"requestDevices"}')).toEqual({ action: 'requestDevices' })
        expect(parseRemoteCommand('{"action":"requestContinue"}')).toEqual({ action: 'requestContinue' })
        expect(parseRemoteCommand('{"action":"requestRecommended"}')).toEqual({ action: 'requestRecommended' })
        // REC do guia: channelId obrigatório; nome opcional aparado em 160.
        expect(parseRemoteCommand('{"action":"recordChannel","channelId":"77","channelName":"Globo HD"}'))
            .toEqual({ action: 'recordChannel', channelId: '77', channelName: 'Globo HD' })
        expect(parseRemoteCommand('{"action":"recordChannel","channelId":"77"}'))
            .toEqual({ action: 'recordChannel', channelId: '77', channelName: undefined })
        expect(parseRemoteCommand('{"action":"recordChannel"}')).toBeNull()
        // Fase 2 do DVR: parar por id e agendar o próximo programa do canal.
        expect(parseRemoteCommand('{"action":"stopRecord","id":"rec_3"}')).toEqual({ action: 'stopRecord', id: 'rec_3' })
        expect(parseRemoteCommand('{"action":"stopRecord"}')).toBeNull()
        expect(parseRemoteCommand('{"action":"scheduleNext","channelId":"77"}')).toEqual({ action: 'scheduleNext', channelId: '77' })
        expect(parseRemoteCommand('{"action":"scheduleNext"}')).toBeNull()
        // R53: cancelar uma gravação agendada pelo id (aparado em 80).
        expect(parseRemoteCommand('{"action":"cancelSchedule","id":"sched_ab12_1770000000000"}'))
            .toEqual({ action: 'cancelSchedule', id: 'sched_ab12_1770000000000' })
        expect(parseRemoteCommand('{"action":"cancelSchedule","id":"  "}')).toBeNull()
        expect(parseRemoteCommand('{"action":"cancelSchedule"}')).toBeNull()
        expect(parseRemoteCommand('{"action":"cancelSchedule","id":' + JSON.stringify('x'.repeat(120)) + '}'))
            .toEqual({ action: 'cancelSchedule', id: 'x'.repeat(80) })
        expect(parseRemoteCommand('{"action":"requestRecordings"}')).toEqual({ action: 'requestRecordings' })
        // R52: excluir gravação pronta e busca de canais ao vivo.
        expect(parseRemoteCommand('{"action":"deleteRecording","name":"Globo_2026.ts"}'))
            .toEqual({ action: 'deleteRecording', name: 'Globo_2026.ts' })
        expect(parseRemoteCommand('{"action":"deleteRecording","name":"  "}')).toBeNull()
        expect(parseRemoteCommand('{"action":"requestLiveSearch","query":"globo"}'))
            .toEqual({ action: 'requestLiveSearch', query: 'globo' })
        expect(parseRemoteCommand('{"action":"requestLiveSearch"}'))
            .toEqual({ action: 'requestLiveSearch', query: undefined })
        // Volume absoluto: nível numérico com clamp; sem nível é inválido.
        expect(parseRemoteCommand('{"action":"setVolume","level":0.35}')).toEqual({ action: 'setVolume', level: 0.35 })
        expect(parseRemoteCommand('{"action":"setVolume","level":5}')).toEqual({ action: 'setVolume', level: 1 })
        expect(parseRemoteCommand('{"action":"setVolume","level":-2}')).toEqual({ action: 'setVolume', level: 0 })
        expect(parseRemoteCommand('{"action":"setVolume"}')).toBeNull()
        expect(parseRemoteCommand('{"action":"setVolume","level":"alto"}')).toBeNull()
        // Faixa de áudio: trackId numérico obrigatório.
        expect(parseRemoteCommand('{"action":"setAudioTrack","trackId":2}')).toEqual({ action: 'setAudioTrack', trackId: 2 })
        expect(parseRemoteCommand('{"action":"setAudioTrack"}')).toBeNull()
        expect(parseRemoteCommand('{"action":"castMovie","movieId":"42","deviceId":"tv1","deviceType":"dlna"}'))
            .toEqual({ action: 'castMovie', movieId: '42', target: { deviceId: 'tv1', deviceType: 'dlna' } })
        expect(parseRemoteCommand('{"action":"castEpisode","episodeId":"e1","deviceId":"cc1","deviceType":"chromecast"}'))
            .toEqual({ action: 'castEpisode', episodeId: 'e1', target: { deviceId: 'cc1', deviceType: 'chromecast' } })
        // Alvo malformado é ignorado (cast cai no comportamento legado).
        expect(parseRemoteCommand('{"action":"castMovie","movieId":"9","deviceType":"dlna"}'))
            .toEqual({ action: 'castMovie', movieId: '9', target: undefined }) // deviceId ausente
        expect(parseRemoteCommand('{"action":"castMovie","movieId":"9","deviceId":"x","deviceType":"roku"}'))
            .toEqual({ action: 'castMovie', movieId: '9', target: undefined }) // tipo inválido
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
        expect(entry).toEqual({ fails: 1, lockedUntil: 0, lastFailAt: 1000 })
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

describe('pickLanAddress (escolhe a LAN real, não VPN/virtual)', () => {
    it('prefere Ethernet/Wi-Fi a Radmin VPN / ZeroTier / vEthernet', () => {
        // Cenário real que quebrou o pareamento no celular.
        const ifaces = {
            'Radmin VPN': [{ family: 'IPv4', address: '26.236.80.97', internal: false }],
            'Ethernet': [{ family: 'IPv4', address: '10.0.0.186', internal: false }],
            'ZeroTier One [7439]': [{ family: 'IPv4', address: '10.142.93.25', internal: false }],
            'vEthernet (Default Switch)': [{ family: 'IPv4', address: '172.23.96.1', internal: false }],
            'Loopback': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
        }
        expect(pickLanAddress(ifaces)).toBe('10.0.0.186')
    })
    it('prefere 192.168 quando disponível e aceita family numérica', () => {
        expect(pickLanAddress({ 'Wi-Fi': [{ family: 4, address: '192.168.1.7', internal: false }] })).toBe('192.168.1.7')
    })
    it('cai pra 127.0.0.1 sem candidato', () => {
        expect(pickLanAddress({ 'Loopback': [{ family: 'IPv4', address: '127.0.0.1', internal: true }] })).toBe('127.0.0.1')
    })
    it('scoreLanCandidate penaliza nomes virtuais', () => {
        expect(scoreLanCandidate('Ethernet', '10.0.0.5')).toBeGreaterThan(scoreLanCandidate('ZeroTier One', '10.0.0.5'))
    })
})

describe('parseProgressReport (item 11 — sync de posições)', () => {
    it('aceita amostra de filme válida', () => {
        expect(parseProgressReport({ kind: 'movie', movieId: '42', title: 'Filme', positionSec: 300, durationSec: 6000, updatedAt: 1700000000000 }))
            .toEqual({ kind: 'movie', movieId: '42', title: 'Filme', positionSec: 300, durationSec: 6000, updatedAt: 1700000000000, profile: '' })
    })

    it('aceita episódio com série + SxxEyy', () => {
        const report = parseProgressReport({ kind: 'episode', title: 'Minha Série', season: 2, episode: 5, positionSec: 10, durationSec: 1200, updatedAt: 1 })
        expect(report?.season).toBe(2)
        expect(report?.episode).toBe(5)
    })

    // Sem o perfil de origem no fio, o progresso do adulto entrava no perfil
    // infantil do outro aparelho (e o da criança no histórico do adulto).
    it('carrega o perfil de origem nos dois kinds, com teto de tamanho', () => {
        expect(parseProgressReport({ kind: 'movie', movieId: '42', title: 'F', positionSec: 1, durationSec: 10, updatedAt: 1, profile: ' Rafael ' })?.profile).toBe('Rafael')
        expect(parseProgressReport({ kind: 'episode', title: 'S', season: 1, episode: 1, positionSec: 1, durationSec: 10, updatedAt: 1, profile: 'kids' })?.profile).toBe('kids')
        expect(parseProgressReport({ kind: 'movie', movieId: '42', title: 'F', positionSec: 1, durationSec: 10, updatedAt: 1, profile: 'x'.repeat(500) })?.profile).toHaveLength(60)
        // Peer numa versão sem o campo continua válido (etiqueta vazia = curinga).
        expect(parseProgressReport({ kind: 'movie', movieId: '42', title: 'F', positionSec: 1, durationSec: 10, updatedAt: 1 })?.profile).toBe('')
    })

    it('rejeita lixo: sem duração, sem movieId, número não finito', () => {
        expect(parseProgressReport({ kind: 'movie', movieId: '42', title: 'x', positionSec: 1, durationSec: 0, updatedAt: 1 })).toBeNull()
        expect(parseProgressReport({ kind: 'movie', title: 'x', positionSec: 1, durationSec: 10, updatedAt: 1 })).toBeNull()
        expect(parseProgressReport({ kind: 'episode', title: 'x', season: NaN, episode: 1, positionSec: 1, durationSec: 10, updatedAt: 1 })).toBeNull()
        expect(parseProgressReport(null)).toBeNull()
    })

    it('parseRemoteCommand roteia reportProgress com o report validado', () => {
        const text = JSON.stringify({ action: 'reportProgress', report: { kind: 'movie', movieId: '7', title: 'F', positionSec: 60, durationSec: 600, updatedAt: 5 } })
        const command = parseRemoteCommand(text)
        expect(command).toEqual({ action: 'reportProgress', report: { kind: 'movie', movieId: '7', title: 'F', positionSec: 60, durationSec: 600, updatedAt: 5, profile: '' } })
    })
})

describe('handshake versionado (hello com versão + capacidades)', () => {
    it('hello do APK legado (só action+name) vira peer v0 sem capacidades', () => {
        // Regressão: o desktop v4.44 tratava esse hello igual ao de um APK com
        // os gates de tranca/parental — não havia como distinguir os dois.
        const hello = parseMobileHello(JSON.stringify({ action: 'helloMobile', name: 'NeoStream Mobile' }))
        expect(hello).toEqual({ name: 'NeoStream Mobile', protocolVersion: 0, appVersion: '', capabilities: [] })
        expect(isOutdatedMobile(hello!.appVersion)).toBe(true)
    })

    it('hello versionado traz versão do app e capacidades', () => {
        const hello = parseMobileHello(JSON.stringify({
            action: 'helloMobile', name: 'Pixel', protocolVersion: 1, appVersion: '0.21.0',
            capabilities: ['pushAck', 'gatedPlay'],
        }))
        expect(hello).toEqual({ name: 'Pixel', protocolVersion: 1, appVersion: '0.21.0', capabilities: ['pushAck', 'gatedPlay'] })
        expect(isOutdatedMobile(hello!.appVersion)).toBe(false)
    })

    it('sanitiza lixo do fio: nome cortado, versão inválida vira 0, capacidades não-string somem', () => {
        const hello = parseMobileHello(JSON.stringify({
            action: 'helloMobile', name: 'x'.repeat(80), protocolVersion: 'muitas', appVersion: 42,
            capabilities: ['ok', 7, null, ''],
        }))
        expect(hello?.name).toHaveLength(40)
        expect(hello?.protocolVersion).toBe(0)
        expect(hello?.appVersion).toBe('')
        expect(hello?.capabilities).toEqual(['ok'])
    })

    it('ignora qualquer outra mensagem e JSON inválido', () => {
        expect(parseMobileHello(JSON.stringify({ action: 'togglePlay' }))).toBeNull()
        expect(parseMobileHello(JSON.stringify({ type: 'helloDesktop' }))).toBeNull()
        expect(parseMobileHello('{oops')).toBeNull()
    })

    it('buildDesktopHello anuncia versão do protocolo, do app e capacidades', () => {
        const hello = JSON.parse(buildDesktopHello('4.45.0')) as {
            type: string; protocolVersion: number; appVersion: string; capabilities: string[]
        }
        expect(hello.type).toBe('helloDesktop')
        expect(hello.protocolVersion).toBe(REMOTE_PROTOCOL_VERSION)
        expect(hello.appVersion).toBe('4.45.0')
        expect(hello.capabilities).toContain('pushAck')
        expect(hello.capabilities).toContain('favoritesSync')
    })

    it('compareAppVersions compara por número, não por texto', () => {
        expect(compareAppVersions('4.44.0', '4.9.1')).toBe(1)
        expect(compareAppVersions('0.19.0', '0.20.0')).toBe(-1)
        expect(compareAppVersions('0.20.0', '0.20.0')).toBe(0)
        expect(compareAppVersions('0.20', '0.20.0')).toBe(0)
    })

    it('APK abaixo do mínimo com os gates é marcado como desatualizado', () => {
        expect(isOutdatedMobile('0.19.0')).toBe(true)
        expect(isOutdatedMobile('')).toBe(true)
        expect(isOutdatedMobile(MIN_MOBILE_APP_VERSION)).toBe(false)
        expect(isOutdatedMobile('0.21.3')).toBe(false)
    })
})

describe('markMobileInHistory (papel real no histórico de conexões)', () => {
    const connect = (ip: string, role = 'browser') => ({ ip, role, event: 'connect', name: null, at: 1 })

    it('corrige a última conexão daquele IP pra mobile com o nome do app', () => {
        // Sem isto o connect do app ficava gravado como 'browser' — qualquer
        // cliente que mandasse helloMobile era indistinguível de um navegador.
        const history = [connect('10.0.0.5'), connect('10.0.0.9'), connect('10.0.0.5')]
        const out = markMobileInHistory(history, '10.0.0.5', 'Pixel')
        expect(out[2]).toMatchObject({ ip: '10.0.0.5', role: 'mobile', name: 'Pixel' })
        expect(out[0].role).toBe('browser')
        expect(out[1].role).toBe('browser')
    })

    it('não mexe em disconnect nem em IP sem conexão registrada', () => {
        const history = [{ ip: '10.0.0.5', role: 'browser', event: 'disconnect', name: null, at: 1 }]
        expect(markMobileInHistory(history, '10.0.0.5', 'Pixel')).toBe(history)
        expect(markMobileInHistory([], '10.0.0.5', 'Pixel')).toEqual([])
    })
})

describe('parsePushAck (confirmação do push de reprodução)', () => {
    it('aceita os desfechos do app', () => {
        expect(parsePushAck(JSON.stringify({ action: 'pushResult', pushId: 'abc123', status: 'played' })))
            .toEqual({ pushId: 'abc123', status: 'played' })
        for (const status of ['locked', 'blocked', 'notFound'] as const) {
            expect(parsePushAck(JSON.stringify({ action: 'pushResult', pushId: 'x', status }))?.status).toBe(status)
        }
    })

    it('recusa status desconhecido, pushId ausente e outras mensagens', () => {
        expect(parsePushAck(JSON.stringify({ action: 'pushResult', pushId: 'x', status: 'exploded' }))).toBeNull()
        expect(parsePushAck(JSON.stringify({ action: 'pushResult', status: 'played' }))).toBeNull()
        expect(parsePushAck(JSON.stringify({ action: 'togglePlay' }))).toBeNull()
        expect(parsePushAck('nada')).toBeNull()
    })

    it('não é confundido com um comando do controle (e vice-versa)', () => {
        const text = JSON.stringify({ action: 'pushResult', pushId: 'x', status: 'played' })
        expect(parseRemoteCommand(text)).toBeNull()
        expect(parsePushAck(JSON.stringify({ action: 'helloMobile', name: 'x' }))).toBeNull()
    })
})

describe('partyAdd (item 40 — modo festa)', () => {
    it('aceita movieId string e ignora extras', () => {
        expect(parseRemoteCommand(JSON.stringify({ action: 'partyAdd', movieId: '77' })))
            .toEqual({ action: 'partyAdd', movieId: '77' })
    })

    it('rejeita movieId ausente ou não-string', () => {
        expect(parseRemoteCommand(JSON.stringify({ action: 'partyAdd' }))).toBeNull()
        expect(parseRemoteCommand(JSON.stringify({ action: 'partyAdd', movieId: 42 }))).toBeNull()
    })
})

describe('teto de conexões WebSocket', () => {
    it('aceita cliente enquanto há vaga', () => {
        expect(admitClient([], '10.0.0.5')).toBe('ok')
        expect(admitClient(['10.0.0.1', '10.0.0.2'], '10.0.0.5')).toBe('ok')
    })

    it('recusa acima do teto total (um script não trava o main)', () => {
        const cheio = Array.from({ length: WS_MAX_CLIENTS }, (_, i) => `10.0.0.${i}`)
        expect(admitClient(cheio, '10.0.0.99')).toBe('too-many')
    })

    it('recusa acima do teto por IP mesmo com vaga no total', () => {
        const mesmoIp = Array.from({ length: WS_MAX_CLIENTS_PER_IP }, () => '10.0.0.7')
        expect(admitClient(mesmoIp, '10.0.0.7')).toBe('too-many-from-ip')
        expect(admitClient(mesmoIp, '10.0.0.8')).toBe('ok')
    })

    it('o teto por IP não pode ser maior que o total', () => {
        expect(WS_MAX_CLIENTS_PER_IP).toBeLessThanOrEqual(WS_MAX_CLIENTS)
    })
})

describe('teto do buffer por conexão', () => {
    it('deixa passar um frame completo dentro do máximo', () => {
        expect(isClientBufferOverflow(1_000_000)).toBe(false)
    })

    it('derruba quem goteja bytes de um frame anunciado como gigante', () => {
        expect(isClientBufferOverflow(WS_MAX_BUFFER_BYTES + 1)).toBe(true)
    })
})

// 🔐 O PIN tem 4 dígitos: 10 mil combinações. O cooldown por IP é a única
// coisa entre um vizinho de Wi-Fi e o `/setup`, que devolve usuário e senha de
// todos os provedores.
describe('gate de PIN — endereço e comparação', () => {
    it('IPv4 mapeado em IPv6 é o MESMO cliente (senão a cota dobra de graça)', () => {
        expect(pinGateKey('::ffff:192.168.0.5')).toBe(pinGateKey('192.168.0.5'))
        expect(pinGateKey('::FFFF:192.168.0.5')).toBe('192.168.0.5')
    })

    it('endereço ausente cai num balde só, não em baldes distintos', () => {
        expect(pinGateKey(undefined)).toBe(pinGateKey(''))
        expect(pinGateKey('  ')).toBe('unknown')
    })

    it('IPs diferentes continuam separados', () => {
        expect(pinGateKey('192.168.0.5')).not.toBe(pinGateKey('192.168.0.6'))
    })

    it('pinMatches aceita só o PIN exato', () => {
        expect(pinMatches('1234', '1234')).toBe(true)
        expect(pinMatches('1235', '1234')).toBe(false)
        expect(pinMatches('123', '1234')).toBe(false)
        expect(pinMatches('12345', '1234')).toBe(false)
        expect(pinMatches('', '1234')).toBe(false)
    })

    it('PIN de sessão vazio nunca casa (servidor sem PIN não libera nada)', () => {
        expect(pinMatches('', '')).toBe(false)
        expect(pinMatches('0000', '')).toBe(false)
    })

    it('o teto GLOBAL fecha a multiplicação por vários endereços', () => {
        // Cada IP tem 5 tentativas; quem controla um /64 de IPv6 teria uma cota
        // por endereço. O contador global é o piso comum.
        let global = { fails: 0, lockedUntil: 0 }
        const agora = 1_000_000
        for (let i = 0; i < PIN_GLOBAL_MAX_FAILS; i++) {
            global = registerPinFailure(global, agora, PIN_GLOBAL_MAX_FAILS, PIN_GLOBAL_LOCK_MS)
        }
        expect(isPinLockedOut(global, agora)).toBe(true)
        expect(isPinLockedOut(global, agora + PIN_GLOBAL_LOCK_MS + 1)).toBe(false)
    })

    it('o teto global é mais folgado que o por IP (uso legítimo não trava)', () => {
        expect(PIN_GLOBAL_MAX_FAILS).toBeGreaterThan(PIN_MAX_FAILS)
    })
})

describe('decaimento do contador global', () => {
    it('falha velha nao conta: quem erra uma vez por hora nunca chega ao teto', () => {
        const decay = PIN_GLOBAL_DECAY_MS
        let e = registerPinFailure(undefined, 0, PIN_GLOBAL_MAX_FAILS, PIN_GLOBAL_LOCK_MS, decay)
        expect(e.fails).toBe(1)
        // Passou da janela: a contagem recomeca do 1, nao vai pra 2.
        e = registerPinFailure(e, decay + 1, PIN_GLOBAL_MAX_FAILS, PIN_GLOBAL_LOCK_MS, decay)
        expect(e.fails).toBe(1)
    })

    it('falhas dentro da janela continuam somando', () => {
        const decay = PIN_GLOBAL_DECAY_MS
        let e = registerPinFailure(undefined, 0, PIN_GLOBAL_MAX_FAILS, PIN_GLOBAL_LOCK_MS, decay)
        e = registerPinFailure(e, 1000, PIN_GLOBAL_MAX_FAILS, PIN_GLOBAL_LOCK_MS, decay)
        expect(e.fails).toBe(2)
    })

    it('sem decaimento o comportamento antigo continua (por IP)', () => {
        let e = registerPinFailure(undefined, 0)
        e = registerPinFailure(e, 99_999_999)
        expect(e.fails).toBe(2)
    })
})
