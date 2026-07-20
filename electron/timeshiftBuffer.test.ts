import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
    buildTimeshiftArgs,
    bufferedSecondsFromPlaylist,
    resolveTimeshiftFile,
    timeshiftContentType,
} from './timeshiftBuffer'

describe('timeshiftBuffer (item 15 — pausar TV ao vivo)', () => {
    it('args do ffmpeg: cópia sem re-encode + janela deslizante', () => {
        const args = buildTimeshiftArgs('http://prov/ch.ts', 'C:\\tmp\\ts')
        expect(args).toContain('-c')
        expect(args[args.indexOf('-c') + 1]).toBe('copy')
        expect(args[args.indexOf('-hls_flags') + 1]).toBe('delete_segments')
        expect(args[args.indexOf('-i') + 1]).toBe('http://prov/ch.ts')
        expect(args[args.length - 1]).toBe(path.join('C:\\tmp\\ts', 'buffer.m3u8'))
    })

    it('content-type por extensão', () => {
        expect(timeshiftContentType('buffer.m3u8')).toBe('application/vnd.apple.mpegurl')
        expect(timeshiftContentType('seg00001.ts')).toBe('video/mp2t')
        expect(timeshiftContentType('outro.bin')).toBe('application/octet-stream')
    })

    it('resolveTimeshiftFile aceita só nomes simples .m3u8/.ts', () => {
        const root = 'C:\\buf'
        expect(resolveTimeshiftFile(root, '/buffer.m3u8')).toBe(path.join(root, 'buffer.m3u8'))
        expect(resolveTimeshiftFile(root, '/seg00042.ts?x=1')).toBe(path.join(root, 'seg00042.ts'))
        // Path traversal / nomes fora do padrão → null.
        expect(resolveTimeshiftFile(root, '/../segredo.ts')).toBeNull()
        expect(resolveTimeshiftFile(root, '/sub/seg.ts')).toBeNull()
        expect(resolveTimeshiftFile(root, '/nada.mp4')).toBeNull()
        expect(resolveTimeshiftFile(root, '/')).toBeNull()
    })

    it('bufferedSecondsFromPlaylist soma os EXTINF', () => {
        const playlist = '#EXTM3U\n#EXTINF:4.000,\nseg0.ts\n#EXTINF:4.200,\nseg1.ts\n#EXTINF:3.800,\nseg2.ts\n'
        expect(bufferedSecondsFromPlaylist(playlist)).toBe(12)
        expect(bufferedSecondsFromPlaylist('#EXTM3U\n')).toBe(0)
    })
})
