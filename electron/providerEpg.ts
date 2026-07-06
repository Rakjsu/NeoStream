/**
 * Xtream provider EPG — main process side.
 *
 * Downloads {server}/xmltv.php once per session (24h file cache, same
 * mechanism/dir as 'epg:get-cached'), parses it ONCE into an in-memory
 * Map<epg_channel_id, programs> and answers per-channel lookups instantly
 * over IPC. When the provider has no xmltv.php (404/HTML/empty), it is
 * marked unavailable for the session — no retry storms — and per-channel
 * get_simple_data_table is tried as the secondary provider source.
 *
 * Pure parsing helpers live in providerEpgProtocol.ts (unit-tested).
 */
import { ipcMain } from 'electron'
import store from './store'
import axios from 'axios'
import { findPlaylist, getActivePlaylistIdPublic } from './playlistManager'
import { parseM3uHeader } from './m3uProtocol'
import log from './logger'
import { getProviderHttpsAgent, registerApprovedProviderUrl } from './certificatePolicy'
import {
    buildSimpleDataTableUrl,
    buildXmltvUrl,
    looksLikeXmltv,
    parseSimpleDataTable,
    parseXmltvIndexWithMeta,
    searchEpgIndex,
} from './providerEpgProtocol'
import type { ProviderEpgProgram } from './providerEpgProtocol'

const XMLTV_CACHE_KEY_PREFIX = 'provider-xmltv'
const XMLTV_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const SIMPLE_TABLE_TTL_MS = 60 * 60 * 1000
const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/xml, text/xml, application/json, */*'
}

type Availability = 'unknown' | 'ready' | 'unavailable'

interface Credentials {
    url: string
    username: string
    password: string
}

let xmltvAvailability: Availability = 'unknown'
let xmltvIndex: Map<string, ProviderEpgProgram[]> | null = null
let xmltvLoading: Promise<void> | null = null
// Provider's local UTC offset (minutes) learned from the xmltv timestamps —
// used to format timeshift (catch-up) start strings in provider-local time.
let providerUtcOffsetMinutes: number | null = null

// get_simple_data_table fallback — disabled for the session on first hard failure.
let simpleTableAvailable = true
const simpleTableCache = new Map<number, { at: number; programs: ProviderEpgProgram[] }>()

function getCredentials(): Credentials | null {
    const auth = store.get('auth')
    if (auth.url && auth.username && auth.password) {
        return { url: auth.url, username: auth.username, password: auth.password }
    }
    return null
}

/** Reset all session state (e.g. after switching providers). Exported for tests/future use. */
export function resetProviderEpgState() {
    xmltvAvailability = 'unknown'
    xmltvIndex = null
    xmltvLoading = null
    providerUtcOffsetMinutes = null
    simpleTableAvailable = true
    simpleTableCache.clear()
}

/**
 * The provider's local UTC offset (minutes) as seen in its xmltv timestamps,
 * or null when unknown (no xmltv / no offsets). Callers should fall back to
 * the local machine offset.
 */
export function getProviderUtcOffsetMinutes(): number | null {
    return providerUtcOffsetMinutes
}

/**
 * Triggers the xmltv probe (no-op if already done) so the offset above gets
 * populated before building a timeshift start string.
 */
export function ensureProviderEpgLoaded(): Promise<void> {
    return ensureXmltvIndex()
}

/**
 * Download xmltv.php through the same 24h file cache used by 'epg:get-cached'
 * (userData/epg_cache, cacheKey 'provider-xmltv'). Returns null on failure.
 */
async function fetchXmltvWithCache(url: string): Promise<string | null> {
    const fs = await import('fs/promises')
    const path = await import('path')
    const crypto = await import('crypto')
    const { app } = await import('electron')

    // Per-provider cache key (multi-playlist): hashing the full xmltv URL
    // (host + credentials) keeps each provider's EPG file separate, so
    // switching playlists never serves another provider's cached guide.
    const urlHash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)
    const cacheKey = `${XMLTV_CACHE_KEY_PREFIX}-${urlHash}`

    const cacheDir = path.join(app.getPath('userData'), 'epg_cache')
    const cacheFile = path.join(cacheDir, `${cacheKey}.xml`)
    const metaFile = path.join(cacheDir, `${cacheKey}.meta.json`)
    await fs.mkdir(cacheDir, { recursive: true })

    // Within TTL → reuse the cached file, never re-download.
    try {
        const meta = JSON.parse(await fs.readFile(metaFile, 'utf-8'))
        if (Date.now() - meta.timestamp < XMLTV_CACHE_TTL_MS) {
            const cached = await fs.readFile(cacheFile, 'utf-8')
            log.info('[Provider EPG] Using cached xmltv, age:',
                Math.round((Date.now() - meta.timestamp) / 3600000), 'h, length:', cached.length)
            return cached
        }
        log.info('[Provider EPG] Cache expired, downloading fresh xmltv')
    } catch {
        log.info('[Provider EPG] No xmltv cache, downloading fresh')
    }

    try {
        const fetch = (await import('node-fetch')).default
        const response = await fetch(url, {
            agent: getProviderHttpsAgent(url),
            // Generous: provider xmltv files are big; failure falls back to stale cache.
            signal: AbortSignal.timeout(60000),
            headers: FETCH_HEADERS
        })

        if (!response.ok) {
            log.warn('[Provider EPG] xmltv download failed: HTTP', response.status)
            return await readStaleCache(fs, cacheFile)
        }

        const data = await response.text()
        registerApprovedProviderUrl(response.url || url)
        log.info('[Provider EPG] Downloaded xmltv, length:', data.length)

        // Only cache plausible XMLTV — caching an HTML error page for 24h
        // would mask the provider coming back.
        if (looksLikeXmltv(data)) {
            await fs.writeFile(cacheFile, data, 'utf-8')
            await fs.writeFile(metaFile, JSON.stringify({ timestamp: Date.now(), size: data.length }), 'utf-8')
        }
        return data
    } catch (error) {
        log.warn('[Provider EPG] xmltv download error:', error instanceof Error ? error.message : String(error))
        return await readStaleCache(fs, cacheFile)
    }
}

async function readStaleCache(fs: typeof import('fs/promises'), cacheFile: string): Promise<string | null> {
    try {
        const data = await fs.readFile(cacheFile, 'utf-8')
        log.info('[Provider EPG] Using stale xmltv cache after download failure')
        return data
    } catch {
        return null
    }
}

/**
 * Availability probe + index build. Runs the download/parse at most once per
 * session (single in-flight promise); a definitive failure marks the source
 * unavailable for the rest of the session.
 */
function ensureXmltvIndex(): Promise<void> {
    if (xmltvAvailability !== 'unknown') return Promise.resolve()
    if (xmltvLoading) return xmltvLoading

    xmltvLoading = (async () => {
        const credentials = getCredentials()
        if (!credentials) {
            // Not logged in yet — stay 'unknown' so the next call (post-login) retries.
            log.info('[Provider EPG] No credentials, skipping xmltv probe')
            return
        }

        try {
            // M3U playlists point at their own XMLTV via the #EXTM3U url-tvg
            // header; Xtream keeps the classic {server}/xmltv.php.
            let url = buildXmltvUrl(credentials.url, credentials.username, credentials.password)
            const activeId = getActivePlaylistIdPublic()
            const activeEntry = activeId ? findPlaylist(activeId) : undefined

            // Stalker portals: no XMLTV endpoint — pull the portal EPG
            // (get_epg_info) and synthesize an XMLTV document so the rest of
            // the pipeline (index, mini-EPG, guide, search) works unchanged.
            if (activeEntry?.type === 'stalker') {
                const { StalkerClient } = await import('./stalkerClient')
                const { buildXmltvFromStalkerEpg } = await import('./stalkerProtocol')
                const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
                let syntheticXml = ''
                try {
                    const [channels, epg] = await Promise.all([stalker.getAllChannels(), stalker.getEpgInfo(24)])
                    syntheticXml = buildXmltvFromStalkerEpg(channels, epg)
                } catch (error) {
                    log.info('[Provider EPG] Stalker portal EPG unavailable:', error instanceof Error ? error.message : String(error))
                }
                if (!syntheticXml || !looksLikeXmltv(syntheticXml)) {
                    xmltvAvailability = 'unavailable'
                    return
                }
                const parseStart = Date.now()
                const parsed = parseXmltvIndexWithMeta(syntheticXml)
                xmltvIndex = parsed.index
                providerUtcOffsetMinutes = parsed.utcOffsetMinutes
                xmltvAvailability = 'ready'
                let programCount = 0
                for (const programs of xmltvIndex.values()) programCount += programs.length
                log.info('[Provider EPG] Stalker EPG indexed', xmltvIndex.size, 'channels /', programCount,
                    'programs in', Date.now() - parseStart, 'ms')
                return
            }

            if (activeEntry?.type === 'm3u') {
                const head = await axios.get(activeEntry.url, {
                    timeout: 15000,
                    responseType: 'text',
                    transformResponse: [(d: unknown) => d],
                    // first ~64KB is plenty for the header line
                    headers: { Range: 'bytes=0-65535' },
                    validateStatus: (code) => code === 200 || code === 206
                }).then(r => String(r.data ?? '')).catch(() => '')
                const { urlTvg } = parseM3uHeader(head)
                if (!urlTvg) {
                    xmltvAvailability = 'unavailable'
                    log.info('[Provider EPG] M3U playlist has no url-tvg — provider EPG disabled')
                    return
                }
                url = urlTvg
            }
            const xml = await fetchXmltvWithCache(url)

            if (!xml || !looksLikeXmltv(xml)) {
                xmltvAvailability = 'unavailable'
                log.info('[Provider EPG] Provider xmltv unavailable (empty/404/HTML), disabled for this session')
                return
            }

            const parseStart = Date.now()
            const parsed = parseXmltvIndexWithMeta(xml)
            xmltvIndex = parsed.index
            providerUtcOffsetMinutes = parsed.utcOffsetMinutes
            xmltvAvailability = 'ready'
            if (parsed.utcOffsetMinutes !== null) {
                log.info('[Provider EPG] Provider UTC offset (min):', parsed.utcOffsetMinutes)
            }

            let programCount = 0
            for (const programs of xmltvIndex.values()) programCount += programs.length
            log.info('[Provider EPG] Indexed', xmltvIndex.size, 'channels /', programCount,
                'programs in', Date.now() - parseStart, 'ms')
        } catch (error) {
            xmltvAvailability = 'unavailable'
            log.error('[Provider EPG] xmltv probe error:', error instanceof Error ? error.message : String(error))
        }
    })().finally(() => {
        xmltvLoading = null
    })

    return xmltvLoading
}

/** Per-channel JSON EPG (secondary source when xmltv.php is unavailable). */
async function fetchSimpleDataTable(streamId: number, channelId: string): Promise<ProviderEpgProgram[]> {
    const cached = simpleTableCache.get(streamId)
    if (cached && Date.now() - cached.at < SIMPLE_TABLE_TTL_MS) {
        return cached.programs
    }

    const credentials = getCredentials()
    if (!credentials) return []

    try {
        const url = buildSimpleDataTableUrl(credentials.url, credentials.username, credentials.password, streamId)
        const fetch = (await import('node-fetch')).default
        const response = await fetch(url, {
            agent: getProviderHttpsAgent(url),
            signal: AbortSignal.timeout(20000),
            headers: FETCH_HEADERS
        })

        if (!response.ok) {
            log.warn('[Provider EPG] get_simple_data_table failed: HTTP', response.status, '— disabled for this session')
            simpleTableAvailable = false
            return []
        }

        const text = await response.text()
        let payload: unknown
        try {
            payload = JSON.parse(text)
        } catch {
            log.warn('[Provider EPG] get_simple_data_table returned non-JSON — disabled for this session')
            simpleTableAvailable = false
            return []
        }

        registerApprovedProviderUrl(response.url || url)
        const programs = parseSimpleDataTable(payload, channelId || String(streamId))
        simpleTableCache.set(streamId, { at: Date.now(), programs })
        return programs
    } catch (error) {
        log.warn('[Provider EPG] get_simple_data_table error:', error instanceof Error ? error.message : String(error))
        simpleTableAvailable = false
        return []
    }
}

export function setupProviderEpgHandlers() {
    // Is the provider's own EPG usable this session? (Triggers the probe.)
    ipcMain.handle('epg:provider-available', async () => {
        try {
            await ensureXmltvIndex()
            return { success: true, available: xmltvAvailability === 'ready' }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    // Program search for the global search overlay (title, airing/upcoming).
    ipcMain.handle('epg:provider-search', async (_, args: { query?: string }) => {
        try {
            const query = typeof args?.query === 'string' ? args.query : ''
            if (query.trim().length < 2) return { success: true, programs: [] }
            await ensureXmltvIndex()
            if (xmltvAvailability !== 'ready' || !xmltvIndex) {
                return { success: true, programs: [] }
            }
            return { success: true, programs: searchEpgIndex(xmltvIndex, query, Date.now()) }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    // Programs for one channel, straight from the in-memory index.
    ipcMain.handle('epg:provider-channel', async (_, args: { channelId?: string; streamId?: number }) => {
        try {
            const channelId = typeof args?.channelId === 'string' ? args.channelId : ''
            const streamId = typeof args?.streamId === 'number' && Number.isFinite(args.streamId)
                ? args.streamId
                : null

            if (channelId) {
                await ensureXmltvIndex()
                if (xmltvAvailability === 'ready' && xmltvIndex) {
                    // xmltv is THE provider EPG when present: a channel missing
                    // from it means the provider has no EPG for it — let the
                    // renderer fall back to its existing chain.
                    return { success: true, programs: xmltvIndex.get(channelId) ?? [], source: 'xmltv' }
                }
            }

            // xmltv unavailable (or channel has no epg id): try the per-channel endpoint.
            if (streamId !== null && simpleTableAvailable) {
                const programs = await fetchSimpleDataTable(streamId, channelId)
                return { success: true, programs, source: 'simple-data-table' }
            }

            return { success: true, programs: [], source: 'none' }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })
}
