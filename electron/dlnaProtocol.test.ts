import { describe, it, expect } from 'vitest'
import {
    escapeXml,
    parseSsdpMessage,
    getHeader,
    looksLikeMediaRenderer,
    createSearchMessage,
    getMimeForUrl,
    needsRemux,
    toCastableLiveUrl,
    buildDidl,
    buildSoapEnvelope,
    parseUpnpFault,
    parseUpnpTime,
    formatUpnpTime,
    vttToSrt,
    rewritePlaylistUris,
    DLNA_FEATURES,
} from './dlnaProtocol'

describe('escapeXml', () => {
    it('escapes the five XML special characters', () => {
        expect(escapeXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f')
    })

    it('keeps multibyte text intact', () => {
        expect(escapeXml('百岁之好，一言为定')).toBe('百岁之好，一言为定')
    })
})

describe('SSDP parsing', () => {
    const response = [
        'HTTP/1.1 200 OK',
        'CACHE-CONTROL: max-age=1800',
        'LOCATION: http://10.0.0.109:9197/dmr',
        'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
        'USN: uuid:abc::urn:schemas-upnp-org:device:MediaRenderer:1',
        'SERVER: Samsung-Linux/4.1, UPnP/1.0',
        ''
    ].join('\r\n')

    it('extracts ST/USN/SERVER/LOCATION case-insensitively', () => {
        const headers = parseSsdpMessage(response)
        expect(getHeader(headers, 'LOCATION')).toBe('http://10.0.0.109:9197/dmr')
        expect(getHeader(headers, 'SERVER')).toContain('Samsung')
    })

    it('identifies media renderers', () => {
        expect(looksLikeMediaRenderer(parseSsdpMessage(response))).toBe(true)
        expect(looksLikeMediaRenderer(parseSsdpMessage('ST: upnp:rootdevice\r\nUSN: uuid:x'))).toBe(false)
    })

    it('builds a spec-compliant M-SEARCH', () => {
        const msg = createSearchMessage('ssdp:all')
        expect(msg).toContain('M-SEARCH * HTTP/1.1')
        expect(msg).toContain('MAN: "ssdp:discover"')
        expect(msg).toContain('ST: ssdp:all')
        expect(msg.endsWith('\r\n\r\n')).toBe(true)
    })
})

describe('mime and container handling', () => {
    it('maps known extensions ignoring query strings', () => {
        expect(getMimeForUrl('http://x/v.m3u8?token=1')).toBe('application/vnd.apple.mpegurl')
        expect(getMimeForUrl('http://x/v.ts')).toBe('video/MP2T')
        expect(getMimeForUrl('http://x/v.mkv')).toBe('video/x-matroska')
        expect(getMimeForUrl('http://x/v')).toBe('video/mp4')
    })

    it('flags MKV/AVI for remux', () => {
        expect(needsRemux('http://x/movie.mkv')).toBe(true)
        expect(needsRemux('http://x/movie.avi?u=1')).toBe(true)
        expect(needsRemux('http://x/movie.mp4')).toBe(false)
    })

    it('rewrites Xtream live HLS to the TS variant only', () => {
        expect(toCastableLiveUrl('http://h/live/u/p/123.m3u8')).toBe('http://h/live/u/p/123.ts')
        expect(toCastableLiveUrl('http://h/live/u/p/123.m3u8?a=1')).toBe('http://h/live/u/p/123.ts?a=1')
        // Non-live HLS and non-HLS URLs untouched
        expect(toCastableLiveUrl('http://h/vod/u/p/9.m3u8')).toBe('http://h/vod/u/p/9.m3u8')
        expect(toCastableLiveUrl('http://h/live/u/p/123.ts')).toBe('http://h/live/u/p/123.ts')
    })
})

describe('DIDL / SOAP building', () => {
    it('builds DIDL with escaped title and DLNA features', () => {
        const didl = buildDidl({ title: 'A & B <Test>', mediaUrl: 'http://x/v.mp4', mime: 'video/mp4' })
        expect(didl).toContain('A &amp; B &lt;Test&gt;')
        expect(didl).toContain(`http-get:*:video/mp4:${DLNA_FEATURES}`)
        expect(didl).not.toContain('CaptionInfo')
    })

    it('adds Samsung caption elements when a subtitle is provided', () => {
        const didl = buildDidl({
            title: 'T', mediaUrl: 'http://x/v.mp4', mime: 'video/mp4',
            subtitleUrl: 'http://10.0.0.186:1234/dlna-sub/abc.srt'
        })
        expect(didl).toContain('sec:CaptionInfoEx')
        expect(didl).toContain('dlna-sub/abc.srt')
        expect(didl).toContain('http-get:*:text/srt:*')
    })

    it('builds a SOAP envelope with the action namespace', () => {
        const xml = buildSoapEnvelope('urn:svc:1', 'Play', '<InstanceID>0</InstanceID>')
        expect(xml).toContain('<u:Play xmlns:u="urn:svc:1">')
        expect(xml.startsWith('<?xml version="1.0"')).toBe(true)
    })

    it('parses UPnP faults and passes clean responses', () => {
        const fault = parseUpnpFault('<x><errorCode>704</errorCode><errorDescription>Local restrictions</errorDescription></x>')
        expect(fault).toEqual({ code: '704', description: 'Local restrictions' })
        expect(parseUpnpFault('<ok/>')).toBeNull()
    })
})

describe('UPnP time', () => {
    it('parses H:MM:SS and handles NOT_IMPLEMENTED', () => {
        expect(parseUpnpTime('0:01:30')).toBe(90)
        expect(parseUpnpTime('01:02:03.500')).toBe(3723.5)
        expect(parseUpnpTime('NOT_IMPLEMENTED')).toBe(0)
        expect(parseUpnpTime(undefined)).toBe(0)
    })

    it('formats seconds as REL_TIME', () => {
        expect(formatUpnpTime(0)).toBe('0:00:00')
        expect(formatUpnpTime(90)).toBe('0:01:30')
        expect(formatUpnpTime(3723)).toBe('1:02:03')
        expect(formatUpnpTime(-5)).toBe('0:00:00')
    })
})

describe('vttToSrt', () => {
    it('converts header, timestamps and numbers cues', () => {
        const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n\n00:00:03.000 --> 00:00:04.000\nWorld\n'
        const srt = vttToSrt(vtt)
        expect(srt).not.toContain('WEBVTT')
        expect(srt).toContain('1\n00:00:01,000 --> 00:00:02,000\nHello')
        expect(srt).toContain('2\n00:00:03,000 --> 00:00:04,000\nWorld')
    })

    it('renumbers cues that already have indexes', () => {
        const vtt = 'WEBVTT\n\n7\n00:00:01.000 --> 00:00:02.000\nA\n\n9\n00:00:03.000 --> 00:00:04.000\nB\n'
        const srt = vttToSrt(vtt)
        expect(srt).toContain('1\n00:00:01,000')
        expect(srt).toContain('2\n00:00:03,000')
    })
})

describe('rewritePlaylistUris', () => {
    const base = 'http://host/live/playlist.m3u8'
    const map = (url: string) => `http://proxy/p?u=${encodeURIComponent(url)}`

    it('rewrites segment lines to absolute proxied URLs', () => {
        const playlist = '#EXTM3U\n#EXTINF:10,\nseg1.ts\nhttp://cdn/seg2.ts\n'
        const out = rewritePlaylistUris(playlist, base, map)
        expect(out).toContain(`http://proxy/p?u=${encodeURIComponent('http://host/live/seg1.ts')}`)
        expect(out).toContain(`http://proxy/p?u=${encodeURIComponent('http://cdn/seg2.ts')}`)
    })

    it('rewrites URI="..." attributes inside tags', () => {
        const playlist = '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:10,\nseg.ts\n'
        const out = rewritePlaylistUris(playlist, base, map)
        expect(out).toContain(`URI="http://proxy/p?u=${encodeURIComponent('http://host/live/key.bin')}"`)
    })

    it('leaves comments and blank lines alone', () => {
        const playlist = '#EXTM3U\n\n#EXT-X-VERSION:3\n'
        expect(rewritePlaylistUris(playlist, base, map)).toBe(playlist)
    })
})
