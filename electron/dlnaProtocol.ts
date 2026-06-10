/**
 * Pure DLNA/UPnP protocol helpers — no Electron, no sockets, no state.
 * Everything here is unit-testable; the side-effectful parts (HTTP, SSDP
 * sockets, proxy server) live in dlnaHandlers.ts.
 */

export const DLNA_FEATURES = 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000'

export const AVTRANSPORT_SERVICE = 'urn:schemas-upnp-org:service:AVTransport:1'
export const RENDERING_CONTROL_SERVICE = 'urn:schemas-upnp-org:service:RenderingControl:1'

export interface SsdpHeaders {
    ST?: string
    USN?: string
    SERVER?: string
    LOCATION?: string
    st?: string
    usn?: string
    server?: string
    location?: string
}

export function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

export function getXmlTagValue(xml: string, tag: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'))
    return match?.[1]?.trim()
}

export function getHeader(headers: SsdpHeaders, key: 'ST' | 'USN' | 'SERVER' | 'LOCATION'): string | undefined {
    const lowerKey = key.toLowerCase() as keyof SsdpHeaders
    return headers[key] || headers[lowerKey]
}

export function parseSsdpMessage(message: string): SsdpHeaders {
    return message.split(/\r?\n/).reduce<SsdpHeaders>((headers, line) => {
        const separatorIndex = line.indexOf(':')
        if (separatorIndex <= 0) return headers

        const key = line.slice(0, separatorIndex).trim().toUpperCase()
        const value = line.slice(separatorIndex + 1).trim()

        if (key === 'ST' || key === 'USN' || key === 'SERVER' || key === 'LOCATION') {
            headers[key as 'ST' | 'USN' | 'SERVER' | 'LOCATION'] = value
        }

        return headers
    }, {})
}

export function looksLikeMediaRenderer(headers: SsdpHeaders): boolean {
    const target = `${getHeader(headers, 'ST') || ''} ${getHeader(headers, 'USN') || ''}`.toLowerCase()
    return target.includes('mediarenderer') || target.includes('avtransport') || target.includes('renderingcontrol')
}

export function createSearchMessage(target: string): string {
    return [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 3',
        `ST: ${target}`,
        '',
        ''
    ].join('\r\n')
}

export function getMimeForUrl(url: string, fallback?: string | null): string {
    const cleanUrl = url.split('?')[0].toLowerCase()
    if (cleanUrl.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
    if (cleanUrl.endsWith('.ts')) return 'video/MP2T'
    if (cleanUrl.endsWith('.mp4')) return 'video/mp4'
    if (cleanUrl.endsWith('.mkv')) return 'video/x-matroska'
    if (cleanUrl.endsWith('.avi')) return 'video/x-msvideo'
    if (cleanUrl.endsWith('.m4s')) return 'video/iso.segment'
    if (cleanUrl.endsWith('.aac')) return 'audio/aac'
    if (cleanUrl.endsWith('.vtt')) return 'text/vtt'
    if (cleanUrl.endsWith('.srt')) return 'text/srt'
    return fallback || 'video/mp4'
}

/** Containers Samsung/LG renderers typically refuse over DLNA without remux. */
export function needsRemux(url: string): boolean {
    const cleanUrl = url.split('?')[0].toLowerCase()
    return cleanUrl.endsWith('.mkv') || cleanUrl.endsWith('.avi')
}

/** Xtream live channels: prefer the continuous MPEG-TS variant over HLS,
 *  which DLNA renderers cannot decode. */
export function toCastableLiveUrl(url: string): string {
    if (/\/live\//i.test(url) && /\.m3u8(\?|$)/i.test(url)) {
        return url.replace(/\.m3u8(\?|$)/i, '.ts$1')
    }
    return url
}

export function buildDidl(options: {
    title: string
    mediaUrl: string
    mime: string
    subtitleUrl?: string
}): string {
    const protocolInfo = `http-get:*:${options.mime}:${DLNA_FEATURES}`
    const title = escapeXml(options.title || 'Video')
    const mediaUrl = escapeXml(options.mediaUrl)

    let subtitleParts = ''
    if (options.subtitleUrl) {
        const subUrl = escapeXml(options.subtitleUrl)
        // Samsung reads sec:CaptionInfoEx; a generic res entry covers others.
        subtitleParts =
            `<sec:CaptionInfo sec:type="srt">${subUrl}</sec:CaptionInfo>` +
            `<sec:CaptionInfoEx sec:type="srt">${subUrl}</sec:CaptionInfoEx>` +
            `<res protocolInfo="http-get:*:text/srt:*">${subUrl}</res>`
    }

    return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/">` +
        `<item id="0" parentID="-1" restricted="false">` +
        `<upnp:class>object.item.videoItem.movie</upnp:class>` +
        `<dc:title>${title}</dc:title>` +
        `<res protocolInfo="${protocolInfo}">${mediaUrl}</res>` +
        subtitleParts +
        `</item></DIDL-Lite>`
}

export function buildSoapEnvelope(serviceType: string, action: string, paramsXml: string): string {
    return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${serviceType}">${paramsXml}</u:${action}></s:Body></s:Envelope>`
}

export interface UpnpFault {
    code: string
    description: string
}

export function parseUpnpFault(responseXml: string): UpnpFault | null {
    const code = getXmlTagValue(responseXml, 'errorCode')
    if (!code) return null
    return {
        code,
        description: getXmlTagValue(responseXml, 'errorDescription') || 'UPnP error'
    }
}

/** "0:01:23" | "01:23:45.500" -> seconds */
export function parseUpnpTime(value: string | undefined): number {
    if (!value || value === 'NOT_IMPLEMENTED') return 0
    const parts = value.split(':')
    if (parts.length !== 3) return 0
    const [h, m, s] = parts
    const seconds = Number(h) * 3600 + Number(m) * 60 + parseFloat(s)
    return Number.isFinite(seconds) ? seconds : 0
}

/** seconds -> "H:MM:SS" (UPnP REL_TIME format) */
export function formatUpnpTime(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds))
    const h = Math.floor(safe / 3600)
    const m = Math.floor((safe % 3600) / 60)
    const s = safe % 60
    const pad = (v: number) => String(v).padStart(2, '0')
    return `${h}:${pad(m)}:${pad(s)}`
}

/** Convert WebVTT (renderer-side format) back to SRT for DLNA renderers. */
export function vttToSrt(vtt: string): string {
    const body = vtt
        .replace(/^\uFEFF/, '')
        .replace(/^WEBVTT[^\n]*\n+/i, '')
        .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2')

    // Number unnumbered cues: SRT requires sequence indexes.
    const blocks = body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
    let index = 0
    const numbered = blocks.map((block) => {
        const lines = block.split('\n')
        if (lines[0].includes('-->')) {
            index += 1
            return `${index}\n${block}`
        }
        if (/^\d+$/.test(lines[0])) {
            index += 1
            return [String(index), ...lines.slice(1)].join('\n')
        }
        return block
    })

    return numbered.join('\n\n') + '\n'
}

/** Rewrite every URI in an HLS playlist through a mapper (proxying). */
export function rewritePlaylistUris(
    playlist: string,
    baseUrl: string,
    mapUri: (absoluteUrl: string) => string
): string {
    const toAbsolute = (uri: string): string => {
        try {
            return new URL(uri, baseUrl).toString()
        } catch {
            return uri
        }
    }

    return playlist.split(/\r?\n/).map((line) => {
        const trimmed = line.trim()
        if (!trimmed) return line

        if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/g, (_match, uri: string) =>
                `URI="${mapUri(toAbsolute(uri))}"`)
        }

        return mapUri(toAbsolute(trimmed))
    }).join('\n')
}
