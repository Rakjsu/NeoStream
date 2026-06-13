/**
 * Pure helpers for the Xtream provider EPG integration — no Electron, no
 * network, no state. Everything here is unit-testable; the side-effectful
 * parts (download, file cache, ipcMain handlers) live in providerEpg.ts.
 *
 * Endpoints covered:
 *   1. {server}/xmltv.php?username=..&password=..           — full XMLTV dump
 *   2. {server}/player_api.php?..&action=get_simple_data_table&stream_id=..
 *      — per-channel JSON EPG with base64-encoded title/description.
 */

export interface ProviderEpgProgram {
    id: string
    start: string
    end: string
    title: string
    description?: string
    channel_id: string
}

/** Keep only programs within now-24h .. now+48h to bound memory. */
export const PROVIDER_EPG_PAST_WINDOW_MS = 24 * 60 * 60 * 1000
export const PROVIDER_EPG_FUTURE_WINDOW_MS = 48 * 60 * 60 * 1000

export function normalizeServerUrl(serverUrl: string): string {
    return serverUrl.trim().replace(/\/+$/, '')
}

export function buildXmltvUrl(serverUrl: string, username: string, password: string): string {
    const base = normalizeServerUrl(serverUrl)
    return `${base}/xmltv.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
}

export function buildSimpleDataTableUrl(serverUrl: string, username: string, password: string, streamId: number): string {
    const base = normalizeServerUrl(serverUrl)
    return `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
        + `&action=get_simple_data_table&stream_id=${encodeURIComponent(String(streamId))}`
}

/**
 * Quick sanity check on a downloaded xmltv.php body. Providers without EPG
 * typically answer 404, an HTML error page or an empty/minimal document —
 * none of those contain <programme> entries.
 */
export function looksLikeXmltv(text: string): boolean {
    if (!text) return false
    const head = text.slice(0, 2000).toLowerCase()
    if (head.includes('<html') || head.includes('<!doctype html')) return false
    return text.toLowerCase().includes('<programme')
}

/**
 * Parse the XMLTV time format "20260612153000 +0000" (offset optional,
 * seconds optional) into epoch milliseconds. Returns null when malformed.
 */
export function parseXmltvTime(value: string): number | null {
    const match = /^(\d{12,14})(?:\s*([+-]\d{4}))?$/.exec(value.trim())
    if (!match) return null

    const digits = match[1].padEnd(14, '0')
    const year = parseInt(digits.substring(0, 4), 10)
    const month = parseInt(digits.substring(4, 6), 10) - 1
    const day = parseInt(digits.substring(6, 8), 10)
    const hour = parseInt(digits.substring(8, 10), 10)
    const minute = parseInt(digits.substring(10, 12), 10)
    const second = parseInt(digits.substring(12, 14), 10)

    if (month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
        return null
    }

    let offsetMs = 0
    if (match[2]) {
        const sign = match[2].startsWith('-') ? -1 : 1
        const offsetHours = parseInt(match[2].substring(1, 3), 10)
        const offsetMinutes = parseInt(match[2].substring(3, 5), 10)
        offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60 * 1000
    }

    return Date.UTC(year, month, day, hour, minute, second) - offsetMs
}

/**
 * Extract the UTC offset (in minutes) from an XMLTV time value, e.g.
 * "20260612153000 -0300" → -180. Returns null when the offset is absent.
 * Used to learn the provider's local timezone for timeshift start strings.
 */
export function parseXmltvOffsetMinutes(value: string): number | null {
    const match = /^\d{12,14}\s*([+-])(\d{2})(\d{2})$/.exec(value.trim())
    if (!match) return null
    const sign = match[1] === '-' ? -1 : 1
    return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10))
}

/** Strip a CDATA wrapper (if any) and decode the common XML entities. */
export function decodeXmlText(text: string): string {
    let value = text.trim()
    const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value)
    if (cdata) value = cdata[1]

    return value
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .trim()
}

export interface XmltvWindow {
    /** Drop programs that ended before this instant. */
    minEndMs: number
    /** Drop programs that start after this instant. */
    maxStartMs: number
}

export function buildDefaultWindow(nowMs: number): XmltvWindow {
    return {
        minEndMs: nowMs - PROVIDER_EPG_PAST_WINDOW_MS,
        maxStartMs: nowMs + PROVIDER_EPG_FUTURE_WINDOW_MS,
    }
}

const PROGRAMME_RE = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi
const ATTR_RE: Record<string, RegExp> = {
    start: /start="([^"]+)"/i,
    stop: /stop="([^"]+)"/i,
    channel: /channel="([^"]+)"/i,
}
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i
const DESC_RE = /<desc[^>]*>([\s\S]*?)<\/desc>/i

export interface XmltvIndexResult {
    index: Map<string, ProviderEpgProgram[]>
    /**
     * Most common UTC offset (minutes) seen on programme start attributes —
     * i.e. the provider's local timezone — or null when none carried one.
     */
    utcOffsetMinutes: number | null
}

/**
 * Single-pass scan of an XMLTV document into a per-channel program index.
 * Regex/string scanning on purpose (same approach as the renderer's Open-EPG
 * parser) — a DOM parse of a multi-megabyte dump would be far more expensive.
 */
export function parseXmltvIndex(xml: string, nowMs: number = Date.now()): Map<string, ProviderEpgProgram[]> {
    return parseXmltvIndexWithMeta(xml, nowMs).index
}

/** Same scan as parseXmltvIndex, additionally tallying the dominant UTC offset. */
export function parseXmltvIndexWithMeta(xml: string, nowMs: number = Date.now()): XmltvIndexResult {
    const index = new Map<string, ProviderEpgProgram[]>()
    const window = buildDefaultWindow(nowMs)
    const offsetCounts = new Map<number, number>()

    PROGRAMME_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = PROGRAMME_RE.exec(xml)) !== null) {
        const attrs = match[1]
        const body = match[2]

        const channelMatch = ATTR_RE.channel.exec(attrs)
        const startMatch = ATTR_RE.start.exec(attrs)
        const stopMatch = ATTR_RE.stop.exec(attrs)
        if (!channelMatch || !startMatch || !stopMatch) continue

        const startRaw = decodeXmlText(startMatch[1])
        const startMs = parseXmltvTime(startRaw)
        const endMs = parseXmltvTime(decodeXmlText(stopMatch[1]))
        if (startMs === null || endMs === null) continue
        if (endMs < window.minEndMs || startMs > window.maxStartMs) continue

        const offset = parseXmltvOffsetMinutes(startRaw)
        if (offset !== null) {
            offsetCounts.set(offset, (offsetCounts.get(offset) ?? 0) + 1)
        }

        const channelId = decodeXmlText(channelMatch[1])
        if (!channelId) continue

        const titleMatch = TITLE_RE.exec(body)
        const descMatch = DESC_RE.exec(body)
        const title = titleMatch ? decodeXmlText(titleMatch[1]) : ''

        const program: ProviderEpgProgram = {
            id: `provider-${channelId}-${startMs}`,
            start: new Date(startMs).toISOString(),
            end: new Date(endMs).toISOString(),
            title: title || 'Sem título',
            description: descMatch ? decodeXmlText(descMatch[1]) : '',
            channel_id: channelId,
        }

        const list = index.get(channelId)
        if (list) list.push(program)
        else index.set(channelId, [program])
    }

    for (const programs of index.values()) {
        programs.sort((a, b) => a.start.localeCompare(b.start))
    }

    let utcOffsetMinutes: number | null = null
    let bestCount = 0
    for (const [offset, count] of offsetCounts) {
        if (count > bestCount) {
            utcOffsetMinutes = offset
            bestCount = count
        }
    }

    return { index, utcOffsetMinutes }
}

/** Decode a base64 string as UTF-8 text (Xtream get_simple_data_table fields). */
export function decodeBase64Utf8(value: string): string {
    try {
        const nodeBuffer = (globalThis as {
            Buffer?: { from(data: string, encoding: string): { toString(encoding: string): string } }
        }).Buffer
        if (nodeBuffer) {
            return nodeBuffer.from(value, 'base64').toString('utf-8')
        }
        const binary = atob(value)
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
        return new TextDecoder().decode(bytes)
    } catch {
        return value
    }
}

interface SimpleDataTableListing {
    title?: string
    description?: string
    start?: string
    end?: string
    stop?: string
    start_timestamp?: string | number
    stop_timestamp?: string | number
}

function parseListingTime(timestamp: string | number | undefined, fallback: string | undefined): number | null {
    const numeric = Number(timestamp)
    if (Number.isFinite(numeric) && numeric > 0) return numeric * 1000

    if (fallback) {
        // "2026-06-12 15:30:00" — treated as local time, same as Date.parse
        const parsed = Date.parse(fallback.replace(' ', 'T'))
        if (!Number.isNaN(parsed)) return parsed
    }

    return null
}

/**
 * Parse the get_simple_data_table JSON payload (per-channel EPG) into the
 * common program shape, applying the same retention window as the XMLTV path.
 */
export function parseSimpleDataTable(payload: unknown, channelId: string, nowMs: number = Date.now()): ProviderEpgProgram[] {
    const listings = (payload as { epg_listings?: unknown })?.epg_listings
    if (!Array.isArray(listings)) return []

    const window = buildDefaultWindow(nowMs)
    const programs: ProviderEpgProgram[] = []

    for (const raw of listings) {
        if (!raw || typeof raw !== 'object') continue
        const listing = raw as SimpleDataTableListing

        const startMs = parseListingTime(listing.start_timestamp, listing.start)
        const endMs = parseListingTime(listing.stop_timestamp, listing.end ?? listing.stop)
        if (startMs === null || endMs === null) continue
        if (endMs < window.minEndMs || startMs > window.maxStartMs) continue

        const title = listing.title ? decodeBase64Utf8(listing.title).trim() : ''
        const description = listing.description ? decodeBase64Utf8(listing.description).trim() : ''

        programs.push({
            id: `provider-sdt-${channelId}-${startMs}`,
            start: new Date(startMs).toISOString(),
            end: new Date(endMs).toISOString(),
            title: title || 'Sem título',
            description,
            channel_id: channelId,
        })
    }

    programs.sort((a, b) => a.start.localeCompare(b.start))
    return programs
}
