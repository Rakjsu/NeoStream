import { describe, it, expect } from 'vitest'
import { buildTranscodeArgs, isPlaylistReady, newTranscodeSessionId, safeJoinTranscodePath, contentTypeFor } from './transcodeProtocol'

describe('newTranscodeSessionId', () => {
    it('nao deriva do relogio: id imprevisivel', () => {
        const id = newTranscodeSessionId()
        expect(id).not.toContain(Date.now().toString(36))
        expect(id).toMatch(/^t[0-9a-f]{32}$/)
    })

    it('ids diferentes no mesmo milissegundo', () => {
        const ids = new Set(Array.from({ length: 50 }, () => newTranscodeSessionId()))
        expect(ids.size).toBe(50)
    })

    it('continua servivel pelo servidor de loopback', () => {
        const id = newTranscodeSessionId()
        expect(safeJoinTranscodePath('/root', `/${id}/index.m3u8`)).toBe(`/root/${id}/index.m3u8`)
    })
})

describe('buildTranscodeArgs', () => {
    it('full: reencode h264+aac em HLS ao vivo', () => {
        const args = buildTranscodeArgs('http://x/canal.ts', 'full')
        expect(args).toContain('libx264')
        expect(args).toContain('aac')
        expect(args[args.length - 1]).toBe('index.m3u8')
        expect(args.join(' ')).toContain('-i http://x/canal.ts')
        expect(args.join(' ')).toContain('delete_segments')
    })

    it('audio: video copiado, so audio reencodado', () => {
        const args = buildTranscodeArgs('http://x/a', 'audio')
        expect(args.join(' ')).toContain('-c:v copy')
        expect(args).not.toContain('libx264')
    })
})

describe('isPlaylistReady', () => {
    it('pronto com >=2 segmentos', () => {
        const two = '#EXTM3U\n#EXTINF:2.0,\ns0.ts\n#EXTINF:2.0,\ns1.ts\n'
        expect(isPlaylistReady(two)).toBe(true)
        expect(isPlaylistReady('#EXTM3U\n#EXTINF:2.0,\ns0.ts\n')).toBe(false)
        expect(isPlaylistReady('')).toBe(false)
    })
})

describe('safeJoinTranscodePath', () => {
    it('aceita so /<sessao>/<arquivo> simples', () => {
        expect(safeJoinTranscodePath('/root', '/t1abc/index.m3u8')).toBe('/root/t1abc/index.m3u8')
        expect(safeJoinTranscodePath('/root', '/t1/seg0001.ts')).toBe('/root/t1/seg0001.ts')
    })

    it('rejeita travessia e formas estranhas', () => {
        expect(safeJoinTranscodePath('/root', '/../etc/passwd')).toBeNull()
        expect(safeJoinTranscodePath('/root', '/t1/../../x')).toBeNull()
        expect(safeJoinTranscodePath('/root', '/t1/a/b.ts')).toBeNull()
        expect(safeJoinTranscodePath('/root', '/t1')).toBeNull()
    })
})

describe('contentTypeFor', () => {
    it('m3u8 e ts com os MIME certos', () => {
        expect(contentTypeFor('a/index.m3u8')).toBe('application/vnd.apple.mpegurl')
        expect(contentTypeFor('a/seg.ts')).toBe('video/mp2t')
        expect(contentTypeFor('a/x.bin')).toBe('application/octet-stream')
    })
})
