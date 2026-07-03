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
    computeMpvGeometry,
    createInitialStatus,
    extractIpcLines,
    formatMpvGeometry,
    MPV_CONTROLS_HEIGHT,
    MPV_USER_AGENT,
    MPV_WINDOW_TITLE,
    OBSERVED_PROPERTIES,
    parseIpcLine,
    parseTrackList,
    parseTrackSelection,
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

    it('uses borderless/ontop pseudo-embedded options when geometry is given', () => {
        const args = buildMpvArgs('\\\\.\\pipe\\t', {
            url: 'http://x/y',
            geometry: { x: 100, y: 50, width: 1280, height: 624 },
        })

        expect(args).toContain('--no-border')
        expect(args).toContain('--ontop')
        expect(args).toContain('--no-osc')
        expect(args).toContain('--window-dragging=no')
        expect(args).toContain('--geometry=1280x624+100+50')
        expect(args.some((a) => a.startsWith('--autofit'))).toBe(false)
    })

    it('keeps the standalone window options when geometry is omitted', () => {
        const args = buildMpvArgs('\\\\.\\pipe\\t', { url: 'http://x/y' })

        expect(args).toContain('--autofit=70%')
        expect(args).not.toContain('--no-border')
        expect(args).not.toContain('--ontop')
        expect(args.some((a) => a.startsWith('--geometry='))).toBe(false)
    })
})

describe('computeMpvGeometry', () => {
    it('reserves the controls strip at the bottom of the content bounds', () => {
        const geometry = computeMpvGeometry({ x: 200, y: 120, width: 1280, height: 720 })

        expect(geometry).toEqual({
            x: 200,
            y: 120,
            width: 1280,
            height: 720 - MPV_CONTROLS_HEIGHT,
        })
    })

    it('accepts a custom controls height and never collapses below 1px', () => {
        expect(computeMpvGeometry({ x: 0, y: 0, width: 800, height: 600 }, 100).height).toBe(500)
        expect(computeMpvGeometry({ x: 0, y: 0, width: 800, height: 50 }, 100).height).toBe(1)
        expect(computeMpvGeometry({ x: 0, y: 0, width: 0, height: 200 }).width).toBe(1)
    })

    it('rounds fractional bounds (scaled displays)', () => {
        const geometry = computeMpvGeometry({ x: 10.4, y: 20.6, width: 1000.5, height: 500.2 })
        expect(geometry.x).toBe(10)
        expect(geometry.y).toBe(21)
        expect(geometry.width).toBe(1001)
        expect(geometry.height).toBe(500 - MPV_CONTROLS_HEIGHT)
    })
})

describe('formatMpvGeometry', () => {
    it('serializes WxH+X+Y', () => {
        expect(formatMpvGeometry({ x: 100, y: 50, width: 1280, height: 624 })).toBe('1280x624+100+50')
    })

    it('keeps negative offsets parseable (monitors left of/above primary)', () => {
        expect(formatMpvGeometry({ x: -1920, y: -10, width: 800, height: 600 })).toBe('800x600+-1920+-10')
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

        expect(status).toEqual({
            running: true,
            timePos: 42.5,
            duration: 3600,
            paused: true,
            eofReached: false,
            volume: null,
            fullscreen: false,
            tracks: [],
            audioTrackId: null,
            subtitleTrackId: null,
        })

        status = applyIpcMessage(status, { event: 'property-change', name: 'eof-reached', data: true })
        expect(status.eofReached).toBe(true)
    })

    it('tracks volume and fullscreen property changes', () => {
        let status = createInitialStatus(true)

        status = applyIpcMessage(status, { event: 'property-change', name: 'volume', data: 65 })
        expect(status.volume).toBe(65)

        status = applyIpcMessage(status, { event: 'property-change', name: 'fullscreen', data: true })
        expect(status.fullscreen).toBe(true)

        status = applyIpcMessage(status, { event: 'property-change', name: 'volume', data: 'loud' })
        expect(status.volume).toBeNull()

        status = applyIpcMessage(status, { event: 'property-change', name: 'fullscreen', data: false })
        expect(status.fullscreen).toBe(false)
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

describe('track switching (aid/sid/track-list)', () => {
    it('observes track-list, aid and sid', () => {
        expect(OBSERVED_PROPERTIES).toContain('track-list')
        expect(OBSERVED_PROPERTIES).toContain('aid')
        expect(OBSERVED_PROPERTIES).toContain('sid')
    })

    it('parseTrackList keeps audio/sub tracks and drops video/garbage', () => {
        const tracks = parseTrackList([
            { id: 1, type: 'video', title: 'V' },
            { id: 1, type: 'audio', title: 'Português', lang: 'pt', default: true },
            { id: 2, type: 'audio', lang: 'en' },
            { id: 1, type: 'sub', lang: 'pt' },
            { type: 'audio' },
            'noise',
            null,
        ])
        expect(tracks).toEqual([
            { id: 1, type: 'audio', title: 'Português', lang: 'pt', isDefault: true },
            { id: 2, type: 'audio', title: null, lang: 'en', isDefault: false },
            { id: 1, type: 'sub', title: null, lang: 'pt', isDefault: false },
        ])
    })

    it('parseTrackList tolerates non-array payloads', () => {
        expect(parseTrackList(undefined)).toEqual([])
        expect(parseTrackList('x')).toEqual([])
    })

    it('parseTrackSelection maps false/no to null', () => {
        expect(parseTrackSelection(2)).toBe(2)
        expect(parseTrackSelection(false)).toBeNull()
        expect(parseTrackSelection('no')).toBeNull()
    })

    it('applyIpcMessage folds track properties into the status', () => {
        let status = createInitialStatus(true)
        status = applyIpcMessage(status, {
            event: 'property-change', name: 'track-list',
            data: [{ id: 1, type: 'audio', lang: 'pt' }, { id: 1, type: 'sub', lang: 'en' }],
        })
        status = applyIpcMessage(status, { event: 'property-change', name: 'aid', data: 1 })
        status = applyIpcMessage(status, { event: 'property-change', name: 'sid', data: false })
        expect(status.tracks).toHaveLength(2)
        expect(status.audioTrackId).toBe(1)
        expect(status.subtitleTrackId).toBeNull()
    })
})
