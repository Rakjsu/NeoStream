/**
 * M3U/M3U8 playlist parsing — pure helpers (unit-tested).
 *
 * Supports the extended IPTV dialect:
 *   #EXTM3U
 *   #EXTINF:-1 tvg-id="globo" tvg-logo="http://..." group-title="Abertos",Globo SP
 *   http://server/stream.m3u8
 *
 * Parsed channels are mapped to the Xtream LiveStream shape the renderer
 * already understands, with `direct_source` carrying the play URL and the
 * group-title becoming the category.
 */

export interface M3uChannel {
    name: string
    url: string
    logo?: string
    group?: string
    tvgId?: string
}

const ATTR_PATTERN = /([a-zA-Z0-9-]+)="([^"]*)"/g

/** Attributes on the #EXTM3U header line (e.g. url-tvg="http://.../guide.xml"). */
export function parseM3uHeader(text: string): { urlTvg?: string } {
    const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
    if (!firstLine.startsWith('#EXTM3U')) return {}
    const attrs: Record<string, string> = {}
    for (const match of firstLine.matchAll(ATTR_PATTERN)) {
        attrs[match[1].toLowerCase()] = match[2]
    }
    const urlTvg = attrs['url-tvg'] || attrs['x-tvg-url']
    return /^https?:\/\//.test(urlTvg ?? '') ? { urlTvg } : {}
}

const VOD_GROUP_PATTERN = /film|movie|vod|cine/i

/**
 * Split channels into live vs VOD by group-title heuristics ("FILMES | Ação",
 * "Movies", "Cinema"...). Ungrouped entries stay live.
 */
export function classifyM3uChannels(channels: M3uChannel[]): { live: M3uChannel[]; vod: M3uChannel[] } {
    const live: M3uChannel[] = []
    const vod: M3uChannel[] = []
    for (const channel of channels) {
        (channel.group && VOD_GROUP_PATTERN.test(channel.group) ? vod : live).push(channel)
    }
    return { live, vod }
}

/** Parse extended-M3U text into channels. Tolerates CRLF, BOM and junk lines. */
export function parseM3u(text: string): M3uChannel[] {
    const channels: M3uChannel[] = []
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)

    let pending: Omit<M3uChannel, 'url'> | null = null
    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (line.length === 0) continue

        if (line.startsWith('#EXTINF')) {
            const attrs: Record<string, string> = {}
            for (const match of line.matchAll(ATTR_PATTERN)) {
                attrs[match[1].toLowerCase()] = match[2]
            }
            // Display name = text after the LAST comma outside the attributes.
            const commaIndex = line.lastIndexOf(',')
            const name = (commaIndex >= 0 ? line.slice(commaIndex + 1) : '').trim()
            pending = {
                name: name || attrs['tvg-name'] || 'Canal sem nome',
                logo: attrs['tvg-logo'] || undefined,
                group: attrs['group-title'] || undefined,
                tvgId: attrs['tvg-id'] || undefined
            }
            continue
        }

        if (line.startsWith('#')) continue // other directives (#EXTGRP etc.)

        // A non-comment line is a URL; it closes the pending #EXTINF (or is a
        // bare URL entry without metadata).
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(line)) {
            channels.push({
                name: pending?.name || line,
                url: line,
                logo: pending?.logo,
                group: pending?.group,
                tvgId: pending?.tvgId
            })
            pending = null
        }
    }

    return channels
}

/** Xtream-compatible live stream shape (subset the renderer uses). */
export interface M3uLiveStream {
    num: number
    name: string
    stream_type: 'live'
    stream_id: number
    stream_icon: string
    epg_channel_id: string
    added: string
    category_id: string
    custom_sid: string
    tv_archive: 0
    direct_source: string
    tv_archive_duration: 0
}

export interface M3uCategory {
    category_id: string
    category_name: string
    parent_id: 0
}

const NO_GROUP = 'M3U'

/** Group-titles → Xtream-style categories, stable ids by first appearance. */
export function m3uCategories(channels: M3uChannel[]): M3uCategory[] {
    const names: string[] = []
    for (const channel of channels) {
        const group = channel.group || NO_GROUP
        if (!names.includes(group)) names.push(group)
    }
    return names.map((name, i) => ({ category_id: `m3u-${i}`, category_name: name, parent_id: 0 }))
}

/** Channels → Xtream LiveStream shape (direct_source carries the URL). */
export function m3uToLiveStreams(channels: M3uChannel[]): M3uLiveStream[] {
    const categories = m3uCategories(channels)
    const categoryIdOf = new Map(categories.map(c => [c.category_name, c.category_id]))

    return channels.map((channel, i) => ({
        num: i + 1,
        name: channel.name,
        stream_type: 'live',
        stream_id: i + 1,
        stream_icon: channel.logo || '',
        epg_channel_id: channel.tvgId || '',
        added: '',
        category_id: categoryIdOf.get(channel.group || NO_GROUP) || 'm3u-0',
        custom_sid: '',
        tv_archive: 0,
        direct_source: channel.url,
        tv_archive_duration: 0
    }))
}

/** Xtream-compatible VOD stream shape (subset the renderer uses). */
export interface M3uVodStream {
    num: number
    name: string
    stream_type: 'movie'
    stream_id: number
    stream_icon: string
    rating: string
    category_id: string
    container_extension: string
    added: string
    direct_source: string
}

/** VOD channels → Xtream VOD shape (ids offset by 100000 to avoid clashing with live). */
export function m3uToVodStreams(vodChannels: M3uChannel[]): M3uVodStream[] {
    const categories = m3uCategories(vodChannels)
    const categoryIdOf = new Map(categories.map(c => [c.category_name, c.category_id]))

    return vodChannels.map((channel, i) => ({
        num: i + 1,
        name: channel.name,
        stream_type: 'movie',
        stream_id: 100000 + i + 1,
        stream_icon: channel.logo || '',
        rating: '',
        category_id: categoryIdOf.get(channel.group || 'M3U') || 'm3u-0',
        container_extension: (channel.url.match(/\.([a-z0-9]{2,4})(?:\?|$)/i)?.[1] ?? 'mp4').toLowerCase(),
        added: '',
        direct_source: channel.url
    }))
}

/** Cheap sanity check that a fetched body is an M3U document. */
export function looksLikeM3u(text: string): boolean {
    const head = text.replace(/^\uFEFF/, '').trimStart().slice(0, 200)
    return head.startsWith('#EXTM3U') || head.includes('#EXTINF')
}
