/**
 * Stalker/Ministra portal client (main process). Wraps the one-endpoint
 * protocol from stalkerProtocol.ts with axios + the provider HTTPS agent.
 *
 * Token lifecycle: handshake mints a bearer token tied to the MAC cookie.
 * Tokens are cached in-memory per (portal, mac) and re-minted when a call
 * comes back unauthorized (portals expire them without warning).
 */

import axios from 'axios'
import log from './logger'
import { getProviderHttpsAgent } from './certificatePolicy'
import {
    STALKER_USER_AGENT,
    buildStalkerCookie,
    buildStalkerQuery,
    extractToken,
    extractStreamUrl,
    parseChannels,
    parseGenres,
    parseVodItems,
    parseTotalItems,
    parseEpgPrograms,
    parseSeriesItems,
    parseSeasons,
    portalCandidates,
    unwrapJs,
    type StalkerChannel,
    type StalkerGenre,
    type StalkerVodItem,
    type StalkerEpgProgram,
    type StalkerSeriesItem,
    type StalkerSeason,
} from './stalkerProtocol'

const TIMEOUT_MS = 20000

interface TokenCacheEntry {
    token: string
    mintedAt: number
}

// Tokens usually live for a session; refresh proactively after 10 minutes.
const TOKEN_TTL_MS = 10 * 60 * 1000
const tokenCache = new Map<string, TokenCacheEntry>()

function cacheKey(loadUrl: string, mac: string): string {
    return `${loadUrl}|${mac}`
}

export class StalkerClient {
    constructor(
        private readonly loadUrl: string,
        private readonly mac: string,
    ) {}

    private async rawCall(query: string, token?: string): Promise<unknown> {
        const url = `${this.loadUrl}?${query}`
        const response = await axios.get(url, {
            timeout: TIMEOUT_MS,
            responseType: 'json',
            // Some portals answer JSON with text/html; parse defensively.
            transformResponse: [(data: unknown) => {
                if (typeof data !== 'string') return data
                try {
                    return JSON.parse(data)
                } catch {
                    return data
                }
            }],
            headers: {
                'User-Agent': STALKER_USER_AGENT,
                'Cookie': buildStalkerCookie(this.mac),
                'X-User-Agent': 'Model: MAG250; Link: WiFi',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            httpsAgent: getProviderHttpsAgent(this.loadUrl, this.loadUrl),
        })
        return response.data
    }

    async handshake(): Promise<string> {
        const body = await this.rawCall(buildStalkerQuery('stb', 'handshake', { token: '' }))
        const token = extractToken(unwrapJs(body))
        if (!token) throw new Error('Portal não devolveu token no handshake')
        // Best-effort profile registration — many portals require it before
        // itv calls; failures are non-fatal (some don't implement it).
        try {
            await this.rawCall(buildStalkerQuery('stb', 'get_profile'), token)
        } catch { /* optional step */ }
        return token
    }

    /** Cached token, minting a new one when absent or stale. */
    private async getToken(forceNew = false): Promise<string> {
        const key = cacheKey(this.loadUrl, this.mac)
        const cached = tokenCache.get(key)
        if (!forceNew && cached && Date.now() - cached.mintedAt < TOKEN_TTL_MS) {
            return cached.token
        }
        const token = await this.handshake()
        tokenCache.set(key, { token, mintedAt: Date.now() })
        return token
    }

    /** Call once; on an empty/unauthorized-looking result, re-handshake once. */
    private async callWithRetry<T>(query: string, parse: (body: unknown) => T | null): Promise<T> {
        const first = parse(await this.rawCall(query, await this.getToken()))
        if (first !== null) return first
        const second = parse(await this.rawCall(query, await this.getToken(true)))
        if (second !== null) return second
        throw new Error('Resposta inesperada do portal')
    }

    async getGenres(): Promise<StalkerGenre[]> {
        return this.callWithRetry(buildStalkerQuery('itv', 'get_genres'), body => {
            const js = unwrapJs(body)
            if (js === null) return null
            const genres = parseGenres(js)
            return genres.length > 0 ? genres : null
        })
    }

    async getAllChannels(): Promise<StalkerChannel[]> {
        return this.callWithRetry(buildStalkerQuery('itv', 'get_all_channels'), body => {
            const js = unwrapJs(body)
            if (js === null) return null
            const channels = parseChannels(js)
            return channels.length > 0 ? channels : null
        })
    }

    /**
     * Resolve a channel/movie `cmd` to a playable URL. Tries create_link
     * (needed by portals that mint per-play tokens); falls back to the URL
     * embedded in the cmd itself when create_link is unavailable.
     */
    async createLink(cmd: string, kind: 'itv' | 'vod' = 'itv', episode?: number): Promise<string> {
        try {
            const resolved = await this.callWithRetry(
                buildStalkerQuery(kind, 'create_link', {
                    cmd,
                    // Series episodes play through the season cmd + the episode
                    // number in `series` (Ministra drill-down).
                    series: episode !== undefined ? String(episode) : '',
                    forced_storage: 'undefined',
                    disable_ad: '0',
                    download: '0'
                }),
                body => {
                    const js = unwrapJs<{ cmd?: string }>(body)
                    if (js === null || typeof js.cmd !== 'string') return null
                    return extractStreamUrl(js.cmd)
                },
            )
            if (resolved) return resolved
        } catch (error) {
            log.warn('[Stalker] create_link falhou, usando cmd direto:', error instanceof Error ? error.message : String(error))
        }
        const direct = extractStreamUrl(cmd)
        if (!direct) throw new Error('Conteúdo sem URL reproduzível')
        return direct
    }

    async getVodCategories(): Promise<StalkerGenre[]> {
        return this.callWithRetry(buildStalkerQuery('vod', 'get_categories'), body => {
            const js = unwrapJs(body)
            if (js === null) return null
            const genres = parseGenres(js)
            return genres.length > 0 ? genres : null
        })
    }

    /**
     * Full VOD listing via the paginated get_ordered_list, capped at
     * `maxItems` (portals can host tens of thousands of titles; the cap is
     * logged so truncation is never silent).
     */
    async getVodItems(maxItems = 2000): Promise<StalkerVodItem[]> {
        const items: StalkerVodItem[] = []
        let total = Infinity
        for (let page = 1; page <= 500 && items.length < Math.min(total, maxItems); page++) {
            const js = await (async () => {
                const query = buildStalkerQuery('vod', 'get_ordered_list', { p: String(page) })
                const first = unwrapJs(await this.rawCall(query, await this.getToken()))
                if (first !== null) return first
                return unwrapJs(await this.rawCall(query, await this.getToken(true)))
            })()
            if (js === null) break
            if (page === 1) {
                const parsedTotal = parseTotalItems(js)
                if (parsedTotal > 0) total = parsedTotal
            }
            const pageItems = parseVodItems(js)
            if (pageItems.length === 0) break
            items.push(...pageItems)
        }
        if (items.length >= maxItems && total > maxItems) {
            log.warn(`[Stalker] catálogo VOD truncado em ${maxItems} de ${total} títulos`)
        }
        return items.slice(0, maxItems)
    }

    async getSeriesCategories(): Promise<StalkerGenre[]> {
        return this.callWithRetry(buildStalkerQuery('series', 'get_categories'), body => {
            const js = unwrapJs(body)
            if (js === null) return null
            const genres = parseGenres(js)
            return genres.length > 0 ? genres : null
        })
    }

    /** Full series listing (paginated like VOD, same logged cap). */
    async getSeriesItems(maxItems = 2000): Promise<StalkerSeriesItem[]> {
        const items: StalkerSeriesItem[] = []
        let total = Infinity
        for (let page = 1; page <= 500 && items.length < Math.min(total, maxItems); page++) {
            const js = await (async () => {
                const query = buildStalkerQuery('series', 'get_ordered_list', { p: String(page) })
                const first = unwrapJs(await this.rawCall(query, await this.getToken()))
                if (first !== null) return first
                return unwrapJs(await this.rawCall(query, await this.getToken(true)))
            })()
            if (js === null) break
            if (page === 1) {
                const parsedTotal = parseTotalItems(js)
                if (parsedTotal > 0) total = parsedTotal
            }
            const pageItems = parseSeriesItems(js)
            if (pageItems.length === 0) break
            items.push(...pageItems)
        }
        if (items.length >= maxItems && total > maxItems) {
            log.warn(`[Stalker] catálogo de séries truncado em ${maxItems} de ${total} títulos`)
        }
        return items.slice(0, maxItems)
    }

    /** Seasons (with episode number lists) of one portal series. */
    async getSeasons(portalSeriesId: string): Promise<StalkerSeason[]> {
        return this.callWithRetry(
            buildStalkerQuery('series', 'get_ordered_list', { movie_id: portalSeriesId, p: '1' }),
            body => {
                const js = unwrapJs(body)
                if (js === null) return null
                const seasons = parseSeasons(js)
                return seasons.length > 0 ? seasons : null
            },
        )
    }

    /** Portal EPG for the whole lineup (period in hours). */
    async getEpgInfo(periodHours = 24): Promise<Map<string, StalkerEpgProgram[]>> {
        return this.callWithRetry(
            buildStalkerQuery('itv', 'get_epg_info', { period: String(periodHours) }),
            body => {
                const js = unwrapJs(body)
                if (js === null) return null
                const programs = parseEpgPrograms(js)
                return programs.size > 0 ? programs : null
            },
        )
    }
}

/**
 * Probe the candidate endpoints for a pasted portal URL until one completes a
 * handshake. Returns the working load URL (and warms the token cache).
 */
export async function resolvePortal(rawUrl: string, mac: string): Promise<{ loadUrl: string; client: StalkerClient }> {
    const candidates = portalCandidates(rawUrl)
    if (candidates.length === 0) throw new Error('URL do portal inválida')

    let lastError: unknown = null
    for (const loadUrl of candidates) {
        try {
            const client = new StalkerClient(loadUrl, mac)
            const token = await client.handshake()
            tokenCache.set(cacheKey(loadUrl, mac), { token, mintedAt: Date.now() })
            log.info('[Stalker] portal resolvido em', loadUrl)
            return { loadUrl, client }
        } catch (error) {
            lastError = error
        }
    }
    throw new Error(`Nenhum endpoint do portal respondeu ao handshake (${lastError instanceof Error ? lastError.message : String(lastError)})`)
}
