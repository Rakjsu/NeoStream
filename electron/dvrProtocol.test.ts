import { describe, it, expect } from 'vitest'
import { recordingFilename, buildRecordingArgs, parseFfmpegTime, formatRecDuration } from './dvrProtocol'

describe('recordingFilename', () => {
    it('keeps the channel name and stamps date/time', () => {
        const name = recordingFilename('Globo HD', new Date(2026, 6, 1, 21, 5))
        expect(name).toBe('Globo HD - 2026-07-01 21h05.ts')
    })

    it('strips characters Windows rejects', () => {
        const name = recordingFilename('ESPN* <BR>: "1"?', new Date(2026, 0, 2, 8, 0))
        expect(name).toBe('ESPN BR 1 - 2026-01-02 08h00.ts')
    })

    it('falls back for empty names and caps length', () => {
        expect(recordingFilename('', new Date(2026, 0, 1, 0, 0))).toMatch(/^canal - /)
        const long = recordingFilename('x'.repeat(200), new Date(2026, 0, 1, 0, 0))
        expect(long.length).toBeLessThan(110)
    })
})

describe('buildRecordingArgs', () => {
    it('copies codecs into mpegts with reconnects', () => {
        const args = buildRecordingArgs('http://host/live/1.m3u8', 'C:/rec/out.ts')
        expect(args).toContain('-i')
        expect(args[args.indexOf('-i') + 1]).toBe('http://host/live/1.m3u8')
        expect(args).toContain('copy')
        expect(args).toContain('mpegts')
        expect(args[args.length - 1]).toBe('C:/rec/out.ts')
        expect(args).toContain('-reconnect')
    })
})

describe('parseFfmpegTime', () => {
    it('parses the time= field from ffmpeg progress lines', () => {
        expect(parseFfmpegTime('frame=  100 fps=25 time=00:01:30.52 bitrate=...')).toBe(90)
        expect(parseFfmpegTime('time=01:00:05.00')).toBe(3605)
    })

    it('returns null when absent', () => {
        expect(parseFfmpegTime('opening stream...')).toBeNull()
    })
})

describe('formatRecDuration', () => {
    it('formats mm:ss and h:mm:ss', () => {
        expect(formatRecDuration(65)).toBe('01:05')
        expect(formatRecDuration(3661)).toBe('1:01:01')
        expect(formatRecDuration(-5)).toBe('00:00')
    })
})
