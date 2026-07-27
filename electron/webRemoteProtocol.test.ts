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
    pickLanAddress,
    scoreLanCandidate,
    parseProgressReport,
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
    // 🔒 Regressão (auditoria R3, lacuna 3): sem id de aparelho no hello o
    // desktop não tinha como endereçar o push a UM celular da casa.
    it('hello traz o id do aparelho (vazio no app que não manda)', () => {
        const comId = parseMobileHello(JSON.stringify({
            action: 'helloMobile', name: 'Pixel', deviceId: 'm-abcdef0123456789',
        }))
        expect(comId?.deviceId).toBe('m-abcdef0123456789')
        expect(parseMobileHello(JSON.stringify({ action: 'helloMobile', name: 'Velho' }))?.deviceId).toBe('')
        const gigante = parseMobileHello(JSON.stringify({ action: 'helloMobile', deviceId: 'x'.repeat(500) }))
        expect(gigante?.deviceId.length).toBe(64)
    })

    it('hello do APK legado (só action+name) vira peer v0 sem capacidades', () => {
        // Regressão: o desktop v4.44 tratava esse hello igual ao de um APK com
        // os gates de tranca/parental — não havia como distinguir os dois.
        const hello = parseMobileHello(JSON.stringify({ action: 'helloMobile', name: 'NeoStream Mobile' }))
        expect(hello).toEqual({ name: 'NeoStream Mobile', protocolVersion: 0, appVersion: '', capabilities: [], deviceId: '' })
        expect(isOutdatedMobile(hello!.appVersion)).toBe(true)
    })

    it('hello versionado traz versão do app e capacidades', () => {
        const hello = parseMobileHello(JSON.stringify({
            action: 'helloMobile', name: 'Pixel', protocolVersion: 1, appVersion: '0.21.0',
            capabilities: ['pushAck', 'gatedPlay'],
        }))
        expect(hello).toEqual({ name: 'Pixel', protocolVersion: 1, appVersion: '0.21.0', capabilities: ['pushAck', 'gatedPlay'], deviceId: '' })
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

// 🔒 Regressão (auditoria R3): os ids não tinham teto de tamanho — só o limite
// de frame (1MB) segurava. Um id de ~900k chars passava a validação, ia pro
// renderer via IPC e virava URL gigante na chamada ao provedor.
describe('teto de tamanho dos ids (parseRemoteCommand)', () => {
    const huge = 'A'.repeat(900_000)

    it('corta channelId de playChannel/requestEpg/recordChannel/scheduleNext em 80', () => {
        for (const action of ['playChannel', 'requestEpg', 'recordChannel', 'scheduleNext']) {
            const command = parseRemoteCommand(JSON.stringify({ action, channelId: huge })) as { channelId: string } | null
            expect(command?.channelId.length).toBe(80)
        }
    })

    it('corta movieId, seriesId e episodeId em 80', () => {
        const movie = parseRemoteCommand(JSON.stringify({ action: 'castMovie', movieId: huge })) as { movieId: string } | null
        expect(movie?.movieId.length).toBe(80)
        const party = parseRemoteCommand(JSON.stringify({ action: 'partyAdd', movieId: huge })) as { movieId: string } | null
        expect(party?.movieId.length).toBe(80)
        const series = parseRemoteCommand(JSON.stringify({ action: 'requestSeriesInfo', seriesId: huge })) as { seriesId: string } | null
        expect(series?.seriesId.length).toBe(80)
        const episode = parseRemoteCommand(JSON.stringify({ action: 'castEpisode', episodeId: huge })) as { episodeId: string } | null
        expect(episode?.episodeId.length).toBe(80)
    })

    it('corta CADA item da fila (o limite de 200 itens não segurava o tamanho)', () => {
        const queue = parseRemoteCommand(JSON.stringify({ action: 'castMovieQueue', movieIds: [huge, '7'] })) as { movieIds: string[] } | null
        expect(queue?.movieIds[0].length).toBe(80)
        expect(queue?.movieIds[1]).toBe('7')
    })

    it('corta o deviceId do alvo de cast e segue rejeitando id vazio/não-string', () => {
        const command = parseRemoteCommand(JSON.stringify({
            action: 'castMovie', movieId: '7', deviceId: huge, deviceType: 'dlna',
        })) as { target?: { deviceId: string } } | null
        expect(command?.target?.deviceId.length).toBe(80)
        expect(parseRemoteCommand(JSON.stringify({ action: 'playChannel', channelId: '' }))).toBeNull()
        expect(parseRemoteCommand(JSON.stringify({ action: 'playChannel', channelId: 42 }))).toBeNull()
    })
})
