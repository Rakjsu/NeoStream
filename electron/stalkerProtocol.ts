/**
 * Stalker/Ministra portal protocol — PURE helpers (no 'electron'/axios import)
 * so URL building, MAC normalization and response mapping are unit-testable.
 *
 * Protocol notes (MAG middleware):
 *   - Everything goes through one endpoint (portal.php or
 *     stalker_portal/server/load.php) with ?type=..&action=.. query params.
 *   - The box identifies itself with a MAC cookie (00:1A:79 prefix is the
 *     classic MAG OUI) and a MAG User-Agent.
 *   - `handshake` returns a bearer token used on subsequent calls.
 *   - Channel `cmd` fields come prefixed ("ffmpeg http://...", "auto ...");
 *     some portals need `create_link` per play to mint a tokenized URL.
 */

export const STALKER_USER_AGENT =
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3'

/** Sentinel stored in PlaylistEntry.password for stalker playlists. */
export const STALKER_SENTINEL = 'stalker'

/**
 * Normalize user MAC input to AA:BB:CC:DD:EE:FF (uppercase, colon-separated).
 * Accepts separators -, :, . or none. Returns null when not 12 hex digits.
 */
export function normalizeMac(input: string): string | null {
    const hex = String(input ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    if (hex.length !== 12) return null
    return hex.match(/.{2}/g)!.join(':')
}

/**
 * Candidate load endpoints for a portal URL, most specific first. Users paste
 * anything from a bare host to a full .../c/ or portal.php URL.
 */
export function portalCandidates(rawUrl: string): string[] {
    let url: URL
    try {
        url = new URL(/^https?:\/\//.test(rawUrl) ? rawUrl : `http://${rawUrl}`)
    } catch {
        return []
    }
    const origin = url.origin
    const path = url.pathname.replace(/\/+$/, '')

    const candidates: string[] = []
    const push = (u: string) => {
        if (!candidates.includes(u)) candidates.push(u)
    }

    // Explicit endpoint pasted by the user wins.
    if (/(portal|load)\.php$/.test(path)) push(`${origin}${path}`)
    // ".../stalker_portal/..." anywhere → its canonical server/load.php.
    if (path.includes('/stalker_portal')) push(`${origin}/stalker_portal/server/load.php`)

    push(`${origin}/portal.php`)
    push(`${origin}/stalker_portal/server/load.php`)
    push(`${origin}/c/portal.php`)
    return candidates
}

/** Query string for a portal call (type + action + extras). */
export function buildStalkerQuery(
    type: string,
    action: string,
    extra: Record<string, string> = {},
): string {
    const params = new URLSearchParams({ type, action, JsHttpRequest: '1-xml', ...extra })
    return params.toString()
}

/** Cookie header identifying the "box". */
export function buildStalkerCookie(mac: string): string {
    return `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=America/Sao_Paulo`
}

/** Portal responses wrap the payload in {"js": ...}. Returns null on shape mismatch. */
export function unwrapJs<T>(body: unknown): T | null {
    if (body === null || typeof body !== 'object') return null
    const js = (body as { js?: T }).js
    return js === undefined ? null : js
}

export function extractToken(handshakeJs: unknown): string | null {
    if (handshakeJs === null || typeof handshakeJs !== 'object') return null
    const token = (handshakeJs as { token?: unknown }).token
    return typeof token === 'string' && token ? token : null
}

export interface StalkerGenre {
    id: string
    title: string
}

export interface StalkerChannel {
    id: string
    name: string
    number: number
    logo: string
    genreId: string
    cmd: string
    xmltvId: string
}

/** Defensive mapping of the portal's genre list. */
export function parseGenres(js: unknown): StalkerGenre[] {
    if (!Array.isArray(js)) return []
    const genres: StalkerGenre[] = []
    for (const item of js) {
        if (item === null || typeof item !== 'object') continue
        const g = item as Record<string, unknown>
        const id = g.id !== undefined && g.id !== null ? String(g.id) : ''
        const title = typeof g.title === 'string' ? g.title : ''
        if (!id || !title || id === '*') continue // '*' = the "All" pseudo-genre
        genres.push({ id, title })
    }
    return genres
}

/** Defensive mapping of get_all_channels data. */
export function parseChannels(js: unknown): StalkerChannel[] {
    const data = (js as { data?: unknown } | null)?.data
    if (!Array.isArray(data)) return []
    const channels: StalkerChannel[] = []
    for (const item of data) {
        if (item === null || typeof item !== 'object') continue
        const c = item as Record<string, unknown>
        const cmd = typeof c.cmd === 'string' ? c.cmd : ''
        const name = typeof c.name === 'string' ? c.name : ''
        if (!cmd || !name) continue
        channels.push({
            id: c.id !== undefined && c.id !== null ? String(c.id) : '',
            name,
            number: Number(c.number) || channels.length + 1,
            logo: typeof c.logo === 'string' ? c.logo : '',
            genreId: c.tv_genre_id !== undefined && c.tv_genre_id !== null ? String(c.tv_genre_id) : '',
            cmd,
            xmltvId: typeof c.xmltv_id === 'string' ? c.xmltv_id : '',
        })
    }
    return channels
}

/**
 * Strip the player-hint prefix off a cmd ("ffmpeg http://...", "auto ...")
 * and return the URL, or null when there is none.
 */
export function extractStreamUrl(cmd: string): string | null {
    const match = String(cmd ?? '').match(/https?:\/\/\S+/)
    return match ? match[0] : null
}

/** Genre list → the Xtream category shape the renderer already renders. */
export function stalkerGenresToCategories(genres: StalkerGenre[]): {
    category_id: string
    category_name: string
    parent_id: number
}[] {
    return genres.map(g => ({
        category_id: `stk-${g.id}`,
        category_name: g.title,
        parent_id: 0,
    }))
}

/**
 * Channels → the Xtream live-stream shape. `direct_source` carries the raw
 * cmd; playback resolves it via stalker:create-link (which also handles
 * portals whose cmd URLs are already final).
 */
export function stalkerChannelsToLiveStreams(channels: StalkerChannel[]): {
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
}[] {
    return channels.map((channel, i) => ({
        num: channel.number || i + 1,
        name: channel.name,
        stream_type: 'live',
        stream_id: Number(channel.id) || i + 1,
        stream_icon: channel.logo,
        epg_channel_id: channel.xmltvId,
        added: '',
        category_id: channel.genreId ? `stk-${channel.genreId}` : 'stk-0',
        custom_sid: '',
        tv_archive: 0,
        direct_source: channel.cmd,
        tv_archive_duration: 0,
    }))
}
