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

/**
 * Synthetic EPG channel id for a stalker channel. Portal EPG is keyed by the
 * portal's own channel id, so the live streams and the synthesized XMLTV both
 * use this id (a channel's xmltv_id often doesn't match any reachable XMLTV).
 */
export function stalkerEpgChannelId(id: string): string {
    return `stk-ch-${id}`
}

export interface StalkerVodItem {
    id: string
    name: string
    logo: string
    cmd: string
    categoryId: string
    year: string
    description: string
}

/** Defensive mapping of one vod get_ordered_list page. */
export function parseVodItems(js: unknown): StalkerVodItem[] {
    const data = (js as { data?: unknown } | null)?.data
    if (!Array.isArray(data)) return []
    const items: StalkerVodItem[] = []
    for (const raw of data) {
        if (raw === null || typeof raw !== 'object') continue
        const v = raw as Record<string, unknown>
        const cmd = typeof v.cmd === 'string' ? v.cmd : ''
        const name = typeof v.name === 'string' ? v.name : ''
        if (!cmd || !name) continue
        items.push({
            id: v.id !== undefined && v.id !== null ? String(v.id) : '',
            name,
            logo: typeof v.screenshot_uri === 'string' ? v.screenshot_uri : '',
            cmd,
            categoryId: v.category_id !== undefined && v.category_id !== null ? String(v.category_id) : '',
            year: v.year !== undefined && v.year !== null ? String(v.year) : '',
            description: typeof v.description === 'string' ? v.description : '',
        })
    }
    return items
}

/** total_items from a paginated response (0 when absent/garbage). */
export function parseTotalItems(js: unknown): number {
    const total = (js as { total_items?: unknown } | null)?.total_items
    const n = Number(total)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** VOD items → the Xtream VOD shape (ids offset like the M3U mapping). */
export function stalkerVodToStreams(items: StalkerVodItem[]): {
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
}[] {
    return items.map((item, i) => ({
        num: i + 1,
        name: item.name,
        stream_type: 'movie',
        stream_id: 200000 + i + 1,
        stream_icon: item.logo,
        rating: '',
        category_id: item.categoryId ? `stk-vod-${item.categoryId}` : 'stk-vod-0',
        container_extension: 'mp4', // create_link decides the real container
        added: '',
        direct_source: item.cmd,
    }))
}

/** VOD categories → Xtream category shape (distinct prefix from live genres). */
export function stalkerVodCategories(genres: StalkerGenre[]): {
    category_id: string
    category_name: string
    parent_id: number
}[] {
    return genres.map(g => ({
        category_id: `stk-vod-${g.id}`,
        category_name: g.title,
        parent_id: 0,
    }))
}

export interface StalkerEpgProgram {
    name: string
    description: string
    startTs: number
    stopTs: number
}

/**
 * Parse itv get_epg_info: programs keyed by portal channel id. Accepts both
 * `{data: {chId: [...]}}` and the bare `{chId: [...]}` variants.
 */
export function parseEpgPrograms(js: unknown): Map<string, StalkerEpgProgram[]> {
    const result = new Map<string, StalkerEpgProgram[]>()
    if (js === null || typeof js !== 'object') return result
    const wrapped = (js as { data?: unknown }).data
    const source = wrapped !== null && typeof wrapped === 'object' && !Array.isArray(wrapped)
        ? wrapped as Record<string, unknown>
        : js as Record<string, unknown>

    for (const [chId, rawList] of Object.entries(source)) {
        if (!Array.isArray(rawList)) continue
        const programs: StalkerEpgProgram[] = []
        for (const raw of rawList) {
            if (raw === null || typeof raw !== 'object') continue
            const p = raw as Record<string, unknown>
            const name = typeof p.name === 'string' ? p.name : ''
            const startTs = Number(p.start_timestamp)
            const stopTs = Number(p.stop_timestamp)
            if (!name || !Number.isFinite(startTs) || !Number.isFinite(stopTs) || stopTs <= startTs) continue
            programs.push({
                name,
                description: typeof p.descr === 'string' ? p.descr : '',
                startTs,
                stopTs,
            })
        }
        if (programs.length > 0) result.set(String(chId), programs)
    }
    return result
}

function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/** Unix seconds → XMLTV time ("YYYYMMDDHHMMSS +0000", UTC). */
export function formatXmltvTime(unixSeconds: number): string {
    const date = new Date(unixSeconds * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
        `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
        `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0000`
    )
}

/**
 * Synthesize an XMLTV document from portal EPG so stalker playlists plug into
 * the existing provider-EPG index (mini-EPG, guide, program search).
 */
export function buildXmltvFromStalkerEpg(
    channels: StalkerChannel[],
    epgByChannel: Map<string, StalkerEpgProgram[]>,
): string {
    const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv>']
    for (const channel of channels) {
        parts.push(
            `<channel id="${escapeXml(stalkerEpgChannelId(channel.id))}">` +
            `<display-name>${escapeXml(channel.name)}</display-name></channel>`,
        )
    }
    for (const channel of channels) {
        const programs = epgByChannel.get(channel.id)
        if (!programs) continue
        for (const program of programs) {
            parts.push(
                `<programme start="${formatXmltvTime(program.startTs)}" stop="${formatXmltvTime(program.stopTs)}" ` +
                `channel="${escapeXml(stalkerEpgChannelId(channel.id))}">` +
                `<title>${escapeXml(program.name)}</title>` +
                (program.description ? `<desc>${escapeXml(program.description)}</desc>` : '') +
                `</programme>`,
            )
        }
    }
    parts.push('</tv>')
    return parts.join('\n')
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
        // Matches the synthesized XMLTV (buildXmltvFromStalkerEpg), which is
        // keyed by portal channel id — not by the portal's xmltv_id.
        epg_channel_id: stalkerEpgChannelId(channel.id),
        added: '',
        category_id: channel.genreId ? `stk-${channel.genreId}` : 'stk-0',
        custom_sid: '',
        tv_archive: 0,
        direct_source: channel.cmd,
        tv_archive_duration: 0,
    }))
}

/**
 * Series drill-down (Ministra): `type=series&action=get_ordered_list` lists
 * series; with `movie_id=<id>` it returns the SEASONS, each carrying a `cmd`
 * and a `series` array with the episode numbers. Playing an episode is
 * create_link(type=vod, cmd=<season cmd>, series=<episode number>).
 */
export interface StalkerSeriesItem {
    id: string
    name: string
    logo: string
    categoryId: string
}

/** Defensive mapping of one series get_ordered_list page. */
export function parseSeriesItems(js: unknown): StalkerSeriesItem[] {
    const data = (js as { data?: unknown } | null)?.data
    if (!Array.isArray(data)) return []
    const items: StalkerSeriesItem[] = []
    for (const raw of data) {
        if (raw === null || typeof raw !== 'object') continue
        const v = raw as Record<string, unknown>
        const name = typeof v.name === 'string' ? v.name : ''
        const id = v.id !== undefined && v.id !== null ? String(v.id) : ''
        if (!id || !name) continue
        items.push({
            id,
            name,
            logo: typeof v.screenshot_uri === 'string' ? v.screenshot_uri : '',
            categoryId: v.category_id !== undefined && v.category_id !== null ? String(v.category_id) : '',
        })
    }
    return items
}

export interface StalkerSeason {
    id: string
    name: string
    cmd: string
    episodes: number[]
}

/** Seasons of one series (get_ordered_list with movie_id). */
export function parseSeasons(js: unknown): StalkerSeason[] {
    const data = (js as { data?: unknown } | null)?.data
    if (!Array.isArray(data)) return []
    const seasons: StalkerSeason[] = []
    for (const raw of data) {
        if (raw === null || typeof raw !== 'object') continue
        const v = raw as Record<string, unknown>
        const cmd = typeof v.cmd === 'string' ? v.cmd : ''
        const episodesRaw = Array.isArray(v.series) ? v.series : []
        const episodes = episodesRaw.map(Number).filter(n => Number.isFinite(n) && n > 0)
        if (!cmd || episodes.length === 0) continue
        seasons.push({
            id: v.id !== undefined && v.id !== null ? String(v.id) : '',
            name: typeof v.name === 'string' ? v.name : '',
            cmd,
            episodes,
        })
    }
    return seasons
}

/** Season display name → number ("Season 2" / "Temporada 2" / trailing digits), 1-based fallback. */
export function seasonNumberOf(season: StalkerSeason, index: number): number {
    const match = season.name.match(/(\d{1,2})\s*$/) ?? season.id.match(/:(\d{1,2})$/)
    const n = match ? Number(match[1]) : NaN
    return Number.isFinite(n) && n > 0 ? n : index + 1
}

/**
 * Series list → the Xtream series shape (ids 500000+idx by portal order).
 * `portal_id` keeps the portal's own id so series:get-info can drill down;
 * the renderer ignores unknown fields.
 */
export function stalkerSeriesToList(items: StalkerSeriesItem[]): {
    num: number
    name: string
    series_id: number
    cover: string
    category_id: string
    plot: string
    rating: string
    last_modified: string
    portal_id: string
}[] {
    return items.map((item, i) => ({
        num: i + 1,
        name: item.name,
        series_id: 500000 + i + 1,
        cover: item.logo,
        category_id: item.categoryId ? `stk-ser-${item.categoryId}` : 'stk-ser-0',
        plot: '',
        rating: '',
        last_modified: '',
        portal_id: item.id,
    }))
}

/** Series categories with a prefix distinct from live/vod. */
export function stalkerSeriesCategories(genres: StalkerGenre[]): {
    category_id: string
    category_name: string
    parent_id: number
}[] {
    return genres.map(g => ({
        category_id: `stk-ser-${g.id}`,
        category_name: g.title,
        parent_id: 0,
    }))
}

/**
 * Episode "id" for the modal/get-series-url round trip. Numeric ids can't
 * carry the season cmd, so it's a composite string the URL resolver parses.
 */
export function stalkerEpisodeId(portalSeriesId: string, seasonId: string, episode: number): string {
    return `stk-ep|${portalSeriesId}|${seasonId}|${episode}`
}

export function parseStalkerEpisodeId(id: string): { portalSeriesId: string; seasonId: string; episode: number } | null {
    const parts = String(id ?? '').split('|')
    if (parts.length !== 4 || parts[0] !== 'stk-ep') return null
    const episode = Number(parts[3])
    if (!parts[1] || !parts[2] || !Number.isFinite(episode) || episode <= 0) return null
    return { portalSeriesId: parts[1], seasonId: parts[2], episode }
}

/** Seasons → the get_series_info shape the modal consumes. */
export function stalkerSeriesInfo(portalSeriesId: string, seasons: StalkerSeason[]): {
    episodes: Record<string, { id: string; episode_num: number; title: string; container_extension: string; season: number }[]>
} {
    const episodes: Record<string, { id: string; episode_num: number; title: string; container_extension: string; season: number }[]> = {}
    seasons.forEach((season, index) => {
        const seasonNumber = seasonNumberOf(season, index)
        const key = String(seasonNumber)
        if (!episodes[key]) episodes[key] = []
        for (const episodeNumber of season.episodes) {
            episodes[key].push({
                id: stalkerEpisodeId(portalSeriesId, season.id, episodeNumber),
                episode_num: episodeNumber,
                title: `${season.name || `Temporada ${seasonNumber}`} — Ep. ${episodeNumber}`,
                container_extension: 'mp4',
                season: seasonNumber,
            })
        }
        episodes[key].sort((a, b) => a.episode_num - b.episode_num)
    })
    return { episodes }
}
