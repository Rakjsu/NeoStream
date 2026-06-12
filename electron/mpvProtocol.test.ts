/**
 * EXPERIMENTAL — MPV PoC. Unit tests for the pure IPC/protocol helpers.
 */
import { describe, it, expect } from 'vitest'
import {
    applyIpcMessage,
    buildMpvArgs,
    buildObserveCommandLines,
    buildPathCandidates,
    buildPipeName,
    createInitialStatus,
    extractIpcLines,
    MPV_USER_AGENT,
    MPV_WINDOW_TITLE,
    OBSERVED_PROPERTIES,
    parseIpcLine,
    serializeIpcCommand,
} from './mpvProtocol'

describe('buildPipeName', () => {
    it('builds a Windows named pipe path scoped by pid and instance', () => {
        expect(buildPipeName(1234, 2)).toBe('\\\\.\\pipe\\neostream-mpv-1234-2')
    })
})

describe('buildMpvArgs', () => {
    it('includes the IPC server, window options and the URL last after --', () => {
        const args = buildMpvArgs('\\\\.\\pipe\\test', { url: 'http://host/stream.ts' })

        expect(args[0]).toBe('--input-ipc-server=\\\\.\\pipe\\test')
        expect(args).toContain('--force-window=immediate')
        expect(args).toContain(`--title=${MPV_WINDOW_TITLE}`)
        expect(args).toContain('--autofit=70%')
        expect(args).toContain('--no-terminal')
        expect(args).toContain(`--user-agent=${MPV_USER_AGENT}`)
        expect(args.slice(-2)).toEqual(['--', 'http://host/stream.ts'])
    })

    it('adds media title and integer --start when resuming', () => {
        const args = buildMpvArgs('\\\\.\\pipe\\test', {
            url: 'http://host/movie.mkv',
            title: 'Some Movie',
            startSeconds: 123.7,
        })

        expect(args).toContain('--force-media-title=Some Movie')
        expect(args).toContain('--start=123')
    })

    it('omits --start when startSeconds is missing or zero', () => {
        const noStart = buildMpvArgs('\\\\.\\pipe\\t', { url: 'http://x/y', startSeconds: 0 })
        expect(noStart.some((a) => a.startsWith('--start='))).toBe(false)
    })
})

describe('serializeIpcCommand', () => {
    it('serializes a newline-terminated JSON command', () => {
        expect(serializeIpcCommand(['set_property', 'pause', true]))
            .toBe('{"command":["set_property","pause",true]}\n')
    })

    it('includes request_id when given', () => {
        const line = serializeIpcCommand(['get_property', 'duration'], 7)
        expect(JSON.parse(line)).toEqual({ command: ['get_property', 'duration'], request_id: 7 })
    })
})

describe('buildObserveCommandLines', () => {
    it('observes each property with a unique non-zero id', () => {
        const lines = buildObserveCommandLines()
        expect(lines).toHaveLength(OBSERVED_PROPERTIES.length)
        lines.forEach((line, index) => {
            expect(JSON.parse(line)).toEqual({
                command: ['observe_property', index + 1, OBSERVED_PROPERTIES[index]],
            })
        })
    })
})

describe('parseIpcLine', () => {
    it('parses a valid event line', () => {
        expect(parseIpcLine('{"event":"property-change","name":"pause","data":true}'))
            .toEqual({ event: 'property-change', name: 'pause', data: true })
    })

    it('returns null for blank or malformed lines', () => {
        expect(parseIpcLine('')).toBeNull()
        expect(parseIpcLine('   ')).toBeNull()
        expect(parseIpcLine('not json')).toBeNull()
        expect(parseIpcLine('42')).toBeNull()
    })
})

describe('applyIpcMessage', () => {
    it('updates time-pos, duration, pause and eof-reached from property changes', () => {
        let status = createInitialStatus(true)

        status = applyIpcMessage(status, { event: 'property-change', name: 'time-pos', data: 42.5 })
        status = applyIpcMessage(status, { event: 'property-change', name: 'duration', data: 3600 })
        status = applyIpcMessage(status, { event: 'property-change', name: 'pause', data: true })

        expect(status).toEqual({ running: true, timePos: 42.5, duration: 3600, paused: true, eofReached: false })

        status = applyIpcMessage(status, { event: 'property-change', name: 'eof-reached', data: true })
        expect(status.eofReached).toBe(true)
    })

    it('nullifies numeric properties when mpv sends non-numbers', () => {
        const base = { ...createInitialStatus(true), timePos: 10 }
        const next = applyIpcMessage(base, { event: 'property-change', name: 'time-pos', data: null })
        expect(next.timePos).toBeNull()
    })

    it('treats end-file as eof and ignores unrelated events', () => {
        const base = createInitialStatus(true)
        expect(applyIpcMessage(base, { event: 'end-file' }).eofReached).toBe(true)
        expect(applyIpcMessage(base, { event: 'client-message' })).toEqual(base)
        expect(applyIpcMessage(base, { request_id: 1, error: 'success' })).toEqual(base)
    })
})

describe('extractIpcLines', () => {
    it('frames complete lines and keeps the unterminated remainder', () => {
        const first = extractIpcLines('', '{"event":"a"}\n{"event":')
        expect(first.lines).toEqual(['{"event":"a"}'])
        expect(first.rest).toBe('{"event":')

        const second = extractIpcLines(first.rest, '"b"}\n')
        expect(second.lines).toEqual(['{"event":"b"}'])
        expect(second.rest).toBe('')
    })

    it('drops blank lines', () => {
        expect(extractIpcLines('', '\n\n{"event":"x"}\n').lines).toEqual(['{"event":"x"}'])
    })
})

describe('buildPathCandidates', () => {
    it('builds candidates only for the env vars that are present', () => {
        const candidates = buildPathCandidates({
            ProgramFiles: 'C:\\Program Files',
            USERPROFILE: 'C:\\Users\\test',
        })

        expect(candidates).toContain('C:\\Program Files\\mpv\\mpv.exe')
        expect(candidates).toContain('C:\\Users\\test\\scoop\\shims\\mpv.exe')
        // Chocolatey default location is always probed
        expect(candidates).toContain('C:\\ProgramData\\chocolatey\\bin\\mpv.exe')
        expect(candidates.some((c) => c.includes('undefined'))).toBe(false)
    })

    it('includes x86, LocalAppData and Chocolatey locations when configured', () => {
        const candidates = buildPathCandidates({
            'ProgramFiles(x86)': 'C:\\Program Files (x86)',
            LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
            ChocolateyInstall: 'D:\\choco',
        })

        expect(candidates).toContain('C:\\Program Files (x86)\\mpv\\mpv.exe')
        expect(candidates).toContain('C:\\Users\\test\\AppData\\Local\\Programs\\mpv\\mpv.exe')
        expect(candidates).toContain('D:\\choco\\bin\\mpv.exe')
    })
})
