import { ipcMain, BrowserWindow, dialog, screen, shell } from 'electron'
import axios from 'axios'
import { XtreamClient } from './xtreamClient'
import store from './store'
import { getCertificateSettings, getProviderHttpsAgent, registerApprovedProviderUrl, setAllowInvalidProviderCertificates } from './certificatePolicy'
import { fetchWithRetry, requestWithRetry } from './fetchRetry'
import { ensureProviderEpgLoaded, getProviderUtcOffsetMinutes, resetProviderEpgState, setupProviderEpgHandlers } from './providerEpg'
import { formatTimeshiftStart } from './timeshiftProtocol'
import {
    activatePlaylist,
    deactivatePlaylists,
    exportPlaylistsForBackup,
    findPlaylist,
    getActivePlaylistIdPublic,
    importPlaylistsFromBackup,
    listPublicPlaylists,
    migratePlaylistsOnStartup,
    removePlaylist,
    renameStoredPlaylist,
    saveAndActivatePlaylist,
} from './playlistManager'
import type { PlaylistBackupEntry } from './playlistManager'

import { cachedCatalogFetch, invalidatePlaylistCache, type CatalogKind } from './catalogCache'
import { parseM3u, looksLikeM3u, m3uToLiveStreams, m3uToVodStreams, m3uCategories, classifyM3uChannels, m3uToSeries, m3uSeriesInfo, findM3uEpisodeUrl } from './m3uProtocol'
import { normalizeMac, stalkerChannelsToLiveStreams, stalkerGenresToCategories, stalkerVodToStreams, stalkerVodCategories, stalkerSeriesToList, stalkerSeriesCategories, stalkerSeriesInfo, parseStalkerEpisodeId, STALKER_SENTINEL } from './stalkerProtocol'
import { StalkerClient, resolvePortal } from './stalkerClient'
import log from './logger'
// Store for window state (for custom maximize)
let savedWindowBounds: Electron.Rectangle | null = null

/**
 * Shared SWR body for the six catalog endpoints: instant repeat visits from
 * the disk cache (15 min TTL) + stale fallback when the provider errors.
 */
/** Download + parse an M3U document (shared by add and the SWR fetcher). */
async function fetchM3uChannels(url: string) {
    // One retry for transient failures — a momentary 502 on first boot (no
    // SWR cache yet) otherwise means an empty catalog.
    const response = await requestWithRetry(() => axios.get(url, {
        timeout: 20000,
        responseType: 'text',
        transformResponse: [(data: unknown) => data],
        httpsAgent: getProviderHttpsAgent(url, url)
    }))
    const text = String(response.data ?? '')
    if (!looksLikeM3u(text)) {
        throw new Error('A URL não devolveu uma lista M3U válida')
    }
    const channels = parseM3u(text)
    if (channels.length === 0) {
        throw new Error('Lista M3U sem canais')
    }
    return channels
}

async function catalogListHandler(
    kind: CatalogKind,
    method: 'getLiveStreams' | 'getVODStreams' | 'getSeries' | 'getLiveCategories' | 'getVodCategories' | 'getSeriesCategories',
    payload?: { forceRefresh?: boolean }
) {
    try {
        const auth = store.get('auth')
        if (!auth.url || !auth.username || !auth.password) {
            return { success: false, error: 'Not authenticated' }
        }
        const playlistId = getActivePlaylistIdPublic() ?? 'default'

        // M3U playlists: live channels come from the parsed document; the
        // other catalog kinds are simply empty (phase 1 covers live TV).
        const activeEntry = playlistId !== 'default' ? findPlaylist(playlistId) : undefined
        if (activeEntry?.type === 'm3u') {
            // Phase 3: SxxEyy items in movie/series groups become the series
            // catalog; the rest of the movie groups stay VOD.
            const result = await cachedCatalogFetch(
                playlistId,
                kind,
                async () => {
                    const channels = await fetchM3uChannels(activeEntry.url)
                    const { live, vod, series } = classifyM3uChannels(channels)
                    switch (kind) {
                        case 'live': return m3uToLiveStreams(live)
                        case 'live-categories': return m3uCategories(live)
                        case 'vod': return m3uToVodStreams(vod)
                        case 'vod-categories': return m3uCategories(vod)
                        case 'series': return m3uToSeries(series)
                        case 'series-categories': return m3uCategories(series)
                        default: return []
                    }
                },
                payload?.forceRefresh === true
            )
            return { success: true, data: result.data, fromCache: result.fromCache }
        }

        // Stalker portals: live + VOD (phase 2) + series (phase 3), all from
        // the portal API through the same SWR cache.
        if (activeEntry?.type === 'stalker') {
            const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
            const result = await cachedCatalogFetch(
                playlistId,
                kind,
                async () => {
                    switch (kind) {
                        case 'live': return stalkerChannelsToLiveStreams(await stalker.getAllChannels())
                        case 'live-categories': return stalkerGenresToCategories(await stalker.getGenres())
                        case 'vod': return stalkerVodToStreams(await stalker.getVodItems())
                        case 'vod-categories': return stalkerVodCategories(await stalker.getVodCategories())
                        case 'series': return stalkerSeriesToList(await stalker.getSeriesItems())
                        case 'series-categories': return stalkerSeriesCategories(await stalker.getSeriesCategories())
                        default: return []
                    }
                },
                payload?.forceRefresh === true
            )
            return { success: true, data: result.data, fromCache: result.fromCache }
        }

        const client = new XtreamClient(auth.url, auth.username, auth.password)
        const result = await cachedCatalogFetch(
            playlistId,
            kind,
            () => client[method](),
            payload?.forceRefresh === true
        )
        return { success: true, data: result.data, fromCache: result.fromCache }
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) }
    }
}

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

type OpenSubtitlesBody = Record<string, unknown> & {
    authToken?: string
}

// Which timeshift URL form the provider accepted this session ('m3u8' = path
// form, 'php' = streaming/timeshift.php). Keyed by base URL so a playlist
// switch re-probes the new provider.
let timeshiftProbeResult: { base: string; form: 'm3u8' | 'php' } | null = null

/**
 * Quick probe of the path-form timeshift URL: GET with a 2s timeout, body
 * discarded. 2xx/3xx means the provider speaks form (a); 4xx/timeout/network
 * error means the caller should use the timeshift.php form instead.
 */
async function probeTimeshiftM3u8(url: string, baseUrl: string): Promise<boolean> {
    try {
        const response = await axios.get(url, {
            timeout: 2000,
            validateStatus: () => true,
            responseType: 'stream',
            httpsAgent: getProviderHttpsAgent(url, baseUrl)
        })
        const body = response.data as { destroy?: () => void } | undefined
        body?.destroy?.()
        return response.status >= 200 && response.status < 400
    } catch {
        return false
    }
}

// OpenSubtitles credentials are the USER's own (Configurações → APIs, saved in
// the store). The env vars remain as a dev-only fallback — packaged apps never
// have them, which is why the old env-only wiring was dead in production.
interface OpenSubtitlesConfig { apiKey: string; username: string; password: string }

function getOpenSubtitlesConfig(): OpenSubtitlesConfig {
    const saved = (store.get('openSubtitles') ?? {}) as Partial<OpenSubtitlesConfig>
    return {
        apiKey: (saved.apiKey || process.env.OPEN_SUBTITLES_API_KEY || '').trim(),
        username: (saved.username || process.env.OPEN_SUBTITLES_USERNAME || '').trim(),
        password: saved.password || process.env.OPEN_SUBTITLES_PASSWORD || '',
    }
}

export function setupIpcHandlers() {
    // Legacy single `auth` entry → multi-playlist model (one-time, idempotent).
    migratePlaylistsOnStartup()

    ipcMain.handle('ping', () => 'pong')

    // Open a URL in the OS browser (never inside the app). Restricted to
    // https so renderer bugs can't shell out to arbitrary protocols.
    ipcMain.handle('shell:open-external', (_e, { url }: { url?: string }) => {
        const target = String(url ?? '')
        if (!/^https:\/\//.test(target)) return { success: false, error: 'URL inválida' }
        void shell.openExternal(target)
        return { success: true }
    })

    // Renderer errors land in main.log so packaged-app bug reports include
    // the UI side, not just the main process.
    ipcMain.on('log:renderer', (_event, payload: { level?: string; message?: string; stack?: string }) => {
        const message = `[Renderer] ${String(payload?.message ?? 'unknown error').slice(0, 2000)}`
        const stack = payload?.stack ? `\n${String(payload.stack).slice(0, 4000)}` : ''
        if (payload?.level === 'warn') log.warn(message + stack)
        else log.error(message + stack)
    })

    // Window controls for custom title bar
    ipcMain.handle('window:minimize', () => {
        const win = BrowserWindow.getFocusedWindow()
        if (win) win.minimize()
    })

    // Custom maximize that respects taskbar (doesn't use native maximize)
    ipcMain.handle('window:maximize', () => {
        const win = BrowserWindow.getFocusedWindow()
        if (!win) return

        // If we have saved bounds, we're maximized - restore
        if (savedWindowBounds) {
            win.setBounds(savedWindowBounds)
            savedWindowBounds = null
        } else {
            // Save current bounds and maximize to workArea
            const currentBounds = win.getBounds()
            savedWindowBounds = currentBounds

            const display = screen.getDisplayMatching(currentBounds)
            const workArea = display.workArea

            win.setBounds({
                x: workArea.x,
                y: workArea.y,
                width: workArea.width,
                height: workArea.height
            })
        }
    })

    ipcMain.handle('window:close', () => {
        const win = BrowserWindow.getFocusedWindow()
        if (win) win.close()
    })

    ipcMain.handle('window:is-maximized', () => {
        // Simply check if we have saved bounds (meaning we're in custom maximized state)
        return savedWindowBounds !== null
    })

    ipcMain.handle('auth:login', async (_, { url, username, password, name }) => {
        try {
            const client = new XtreamClient(url, username, password)
            const data = await client.authenticate()

            // Single write path: saves into the playlists model and mirrors
            // the active playlist into the legacy `auth` entry.
            const entry = saveAndActivatePlaylist({
                name: typeof name === 'string' ? name : undefined,
                url,
                username,
                password,
                userInfo: data.user_info
            })

            // New provider may have a different (or no) EPG — re-probe lazily.
            resetProviderEpgState()

            return { success: true, data, playlistId: entry.id }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // ---- Multi-playlist management -------------------------------------

    ipcMain.handle('playlists:list', () => {
        return { success: true, playlists: listPublicPlaylists() }
    })

    // Synchronous-ish read of the active playlist id. The renderer namespaces
    // per-profile user-state (favorites / watch progress) by it so stream ids
    // from different providers don't bleed across playlists.
    ipcMain.handle('playlists:get-active-id', () => {
        return { id: getActivePlaylistIdPublic() }
    })

    ipcMain.handle('playlists:add', async (_, { name, url, username, password }) => {
        try {
            // Same validation as auth:login (player_api authenticate).
            const client = new XtreamClient(url, username, password)
            const data = await client.authenticate()

            const entry = saveAndActivatePlaylist({
                name: typeof name === 'string' ? name : undefined,
                url,
                username,
                password,
                userInfo: data.user_info
            })
            resetProviderEpgState()

            return { success: true, playlistId: entry.id, userInfo: data.user_info }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Add an M3U playlist (phase 1: live channels only).
    ipcMain.handle('playlists:add-m3u', async (_, { name, url }) => {
        try {
            const m3uUrl = String(url ?? '').trim()
            if (!/^https?:\/\//.test(m3uUrl)) {
                return { success: false, error: 'URL inválida' }
            }
            const channels = await fetchM3uChannels(m3uUrl)

            const entry = saveAndActivatePlaylist({
                name: typeof name === 'string' && name.trim() ? name.trim() : `M3U (${channels.length} canais)`,
                url: m3uUrl,
                username: 'm3u',
                password: 'm3u',
                type: 'm3u'
            })
            resetProviderEpgState()

            return { success: true, playlistId: entry.id, channelCount: channels.length }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('playlists:add-stalker', async (_, { name, url, mac }) => {
        try {
            const normalizedMac = normalizeMac(String(mac ?? ''))
            if (!normalizedMac) {
                return { success: false, error: 'MAC inválido (esperado AA:BB:CC:DD:EE:FF)' }
            }
            const rawUrl = String(url ?? '').trim()
            if (!rawUrl) {
                return { success: false, error: 'URL do portal inválida' }
            }

            const { loadUrl, client } = await resolvePortal(rawUrl, normalizedMac)
            const channels = await client.getAllChannels()

            const entry = saveAndActivatePlaylist({
                name: typeof name === 'string' && name.trim() ? name.trim() : `Stalker (${channels.length} canais)`,
                url: loadUrl,
                username: normalizedMac,
                password: STALKER_SENTINEL,
                type: 'stalker'
            })
            resetProviderEpgState()

            return { success: true, playlistId: entry.id, channelCount: channels.length }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Resolve a stalker channel cmd into a playable URL at play time (some
    // portals mint per-play tokenized links via create_link).
    ipcMain.handle('stalker:create-link', async (_, { cmd }: { cmd?: string }) => {
        try {
            const playlistId = getActivePlaylistIdPublic()
            const activeEntry = playlistId ? findPlaylist(playlistId) : undefined
            if (activeEntry?.type !== 'stalker') {
                return { success: false, error: 'Playlist ativa não é Stalker' }
            }
            const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
            const playUrl = await stalker.createLink(String(cmd ?? ''))
            return { success: true, url: playUrl }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('playlists:switch', async (_, { id }) => {
        try {
            const target = findPlaylist(String(id))
            if (!target) {
                return { success: false, error: 'Playlist not found' }
            }

            if (target.type === 'm3u') {
                // M3U has no auth endpoint — validate by refetching the list.
                await fetchM3uChannels(target.url)
                activatePlaylist(target.id)
                resetProviderEpgState()
                return { success: true }
            }

            if (target.type === 'stalker') {
                // Validate by re-doing the handshake with the stored MAC.
                const stalker = new StalkerClient(target.url, target.username)
                await stalker.handshake()
                activatePlaylist(target.id)
                resetProviderEpgState()
                return { success: true }
            }

            // Revalidate before switching — a dead provider should not take
            // down the current session.
            const client = new XtreamClient(target.url, target.username, target.password)
            const data = await client.authenticate()

            activatePlaylist(target.id, data.user_info)
            // Per-provider main-process state: EPG indexes/caches.
            resetProviderEpgState()

            return { success: true, userInfo: data.user_info }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('playlists:remove', (_, { id }) => {
        try {
            invalidatePlaylistCache(String(id))
            const outcome = removePlaylist(String(id))
            if (!outcome.removed) {
                return { success: false, error: 'Playlist not found' }
            }
            if (outcome.activeChanged) {
                resetProviderEpgState()
            }
            return {
                success: true,
                loggedOut: outcome.loggedOut,
                newActiveId: outcome.newActive?.id ?? null
            }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('playlists:rename', (_, { id, name }) => {
        const renamed = renameStoredPlaylist(String(id), String(name ?? ''))
        return renamed
            ? { success: true }
            : { success: false, error: 'Playlist not found or invalid name' }
    })

    ipcMain.handle('auth:check', () => {
        const auth = store.get('auth')
        if (auth.url && auth.username && auth.password) {
            return { authenticated: true, user: auth.userInfo }
        }
        return { authenticated: false }
    })

    ipcMain.handle('auth:get-credentials', () => {
        const auth = store.get('auth')
        if (auth.url && auth.username && auth.password) {
            return { success: true, credentials: { url: auth.url, username: auth.username, password: auth.password } }
        }
        return { success: false, error: 'Not authenticated' }
    })

    ipcMain.handle('auth:logout', () => {
        // Clears the active playlist + auth mirror; saved playlists are kept.
        deactivatePlaylists()
        resetProviderEpgState()
        return { success: true }
    })

    ipcMain.handle('security:get-certificate-settings', () => {
        return { success: true, settings: getCertificateSettings() }
    })

    ipcMain.handle('security:set-allow-invalid-provider-certificates', (_, value: boolean) => {
        return { success: true, settings: setAllowInvalidProviderCertificates(Boolean(value)) }
    })

    // Get content counts
    ipcMain.handle('content:get-counts', async () => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)

            const [liveStreams, vodStreams, series] = await Promise.all([
                client.getLiveStreams().catch(() => []),
                client.getVODStreams().catch(() => []),
                client.getSeries().catch(() => [])
            ])

            return {
                success: true,
                counts: {
                    live: Array.isArray(liveStreams) ? liveStreams.length : 0,
                    vod: Array.isArray(vodStreams) ? vodStreams.length : 0,
                    series: Array.isArray(series) ? series.length : 0
                }
            }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get live streams
    ipcMain.handle('streams:get-live', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('live', 'getLiveStreams', payload))

    // Get VOD streams
    ipcMain.handle('streams:get-vod', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('vod', 'getVODStreams', payload))

    // Get series
    ipcMain.handle('streams:get-series', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('series', 'getSeries', payload))

    // Get live TV categories
    ipcMain.handle('categories:get-live', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('live-categories', 'getLiveCategories', payload))

    // Get VOD categories
    ipcMain.handle('categories:get-vod', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('vod-categories', 'getVodCategories', payload))

    // Get series categories  
    ipcMain.handle('categories:get-series', async (_event, payload?: { forceRefresh?: boolean }) =>
        catalogListHandler('series-categories', 'getSeriesCategories', payload))

    // Fetch EPG from meuguia.tv (bypasses CORS)
    ipcMain.handle('epg:fetch-meuguia', async (_, channelSlug: string) => {
        try {
            const fetch = (await import('node-fetch')).default
            // URL encode the channel slug to handle spaces
            const encodedSlug = encodeURIComponent(channelSlug)
            const url = `https://meuguia.tv/programacao/canal/${encodedSlug}`
            log.info('[EPG IPC] Fetching:', url)
            // Timeout per try + one retry for transient failures (DNS blip, 502).
            const response = await fetchWithRetry(() => fetch(url, { signal: AbortSignal.timeout(15000) }))
            const html = await response.text()
            log.info('[EPG IPC] Response length:', html.length)
            return { success: true, html }
        } catch (error: unknown) {
            log.error('[EPG IPC] Error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Fetch EPG from mi.tv async API (returns pre-rendered content)
    ipcMain.handle('epg:fetch-mitv', async (_, channelSlug: string) => {
        try {
            const fetch = (await import('node-fetch')).default
            // Use the async API endpoint that returns rendered HTML content
            const url = `https://mi.tv/br/async/channel/${channelSlug}/-300`
            log.info('[EPG IPC] Fetching mi.tv async API:', url)
            const response = await fetchWithRetry(() => fetch(url, {
                signal: AbortSignal.timeout(15000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            }))

            if (!response.ok) {
                log.info('[EPG IPC] mi.tv returned:', response.status)
                return { success: false, error: `HTTP ${response.status}` }
            }

            const html = await response.text()
            log.info('[EPG IPC] mi.tv Response length:', html.length)
            return { success: true, html }
        } catch (error: unknown) {
            log.error('[EPG IPC] mi.tv Error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Generic fetch URL handler (bypasses CORS for external URLs)
    ipcMain.handle('fetch-url', async (_, url: string) => {
        try {
            const fetch = (await import('node-fetch')).default
            log.info('[Fetch URL] Fetching:', url.substring(0, 100))
            const response = await fetchWithRetry(() => fetch(url, {
                agent: getProviderHttpsAgent(url),
                signal: AbortSignal.timeout(20000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*'
                }
            }))

            if (!response.ok) {
                log.info('[Fetch URL] Response failed:', response.status)
                return { success: false, error: `HTTP ${response.status}` }
            }

            const text = await response.text()
            registerApprovedProviderUrl(response.url || url)
            log.info('[Fetch URL] Response length:', text.length)
            return { success: true, data: text }
        } catch (error: unknown) {
            log.error('[Fetch URL] Error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // EPG Cache System - Downloads EPG XML files on app start
    // Downloads fresh on every app restart, caches during session only
    ipcMain.handle('epg:get-cached', async (_, { url, cacheKey, forceRefresh = false }) => {
        try {
            const fs = await import('fs/promises')
            const path = await import('path')
            const { app } = await import('electron')

            // Get app data directory for cache storage
            const cacheDir = path.join(app.getPath('userData'), 'epg_cache')
            const cacheFile = path.join(cacheDir, `${cacheKey}.xml`)
            const metaFile = path.join(cacheDir, `${cacheKey}.meta.json`)

            // Ensure cache directory exists
            await fs.mkdir(cacheDir, { recursive: true })

            // Check if we have valid cache (downloaded within last 24 hours)
            // Files are cached for 24 hours to avoid unnecessary re-downloads
            const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

            let cacheValid = false
            if (!forceRefresh) {
                try {
                    const metaContent = await fs.readFile(metaFile, 'utf-8')
                    const meta = JSON.parse(metaContent)
                    const cacheAge = Date.now() - meta.timestamp

                    if (cacheAge < CACHE_TTL_MS) {
                        // Cache is still valid (within 24 hours)
                        log.info('[EPG Cache] Cache valid, age:', Math.round(cacheAge / 3600000), 'hours')
                        cacheValid = true
                    } else {
                        log.info('[EPG Cache] Cache old, downloading fresh (age:', Math.round(cacheAge / 60000), 'min)')
                    }
                } catch {
                    log.info('[EPG Cache] No cache found, will download fresh')
                }
            } else {
                log.info('[EPG Cache] Force refresh requested')
            }

            // If cache is valid (within 24 hours), return cached data
            if (cacheValid) {
                try {
                    const data = await fs.readFile(cacheFile, 'utf-8')
                    log.info('[EPG Cache] Returning cached data, length:', data.length)
                    return { success: true, data, fromCache: true }
                } catch {
                    log.info('[EPG Cache] Cache file read failed, will download fresh')
                }
            }

            // Download fresh data
            log.info('[EPG Cache] Downloading from:', url)
            const fetch = (await import('node-fetch')).default
            const response = await fetchWithRetry(() => fetch(url, {
                agent: getProviderHttpsAgent(url),
                // Generous: EPG XML files are big; a failure falls back to stale cache.
                signal: AbortSignal.timeout(60000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/xml, text/xml, */*'
                }
            }))

            if (!response.ok) {
                log.error('[EPG Cache] Download failed:', response.status)

                // Try to return stale cache if download fails
                try {
                    const data = await fs.readFile(cacheFile, 'utf-8')
                    log.info('[EPG Cache] Returning stale cache due to download failure')
                    return { success: true, data, fromCache: true, stale: true }
                } catch {
                    return { success: false, error: `Download failed: HTTP ${response.status}` }
                }
            }

            const data = await response.text()
            registerApprovedProviderUrl(response.url || url)
            log.info('[EPG Cache] Downloaded data, length:', data.length)

            // Save to cache
            await fs.writeFile(cacheFile, data, 'utf-8')
            await fs.writeFile(metaFile, JSON.stringify({
                timestamp: Date.now(),
                url: url,
                size: data.length
            }), 'utf-8')

            log.info('[EPG Cache] Saved to cache:', cacheFile)
            return { success: true, data, fromCache: false }

        } catch (error: unknown) {
            log.error('[EPG Cache] Error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get EPG cache info (for UI display)
    ipcMain.handle('epg:get-cache-info', async (_, cacheKey: string) => {
        try {
            const fs = await import('fs/promises')
            const path = await import('path')
            const { app } = await import('electron')

            const cacheDir = path.join(app.getPath('userData'), 'epg_cache')
            const metaFile = path.join(cacheDir, `${cacheKey}.meta.json`)

            const metaContent = await fs.readFile(metaFile, 'utf-8')
            const meta = JSON.parse(metaContent)

            return {
                success: true,
                info: {
                    lastUpdate: new Date(meta.timestamp).toISOString(),
                    age: Date.now() - meta.timestamp,
                    size: meta.size
                }
            }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })
    ipcMain.handle('streams:get-vod-url', async (_, { streamId, container }) => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            // M3U playlists: the movie's own URL is the stream URL.
            const activeId = getActivePlaylistIdPublic()
            const activeEntry = activeId ? findPlaylist(activeId) : undefined
            if (activeEntry?.type === 'm3u') {
                const channels = await fetchM3uChannels(activeEntry.url)
                const vod = m3uToVodStreams(classifyM3uChannels(channels).vod)
                const movie = vod.find(v => v.stream_id === Number(streamId))
                if (!movie) return { success: false, error: 'Filme não encontrado na lista M3U' }
                registerApprovedProviderUrl(movie.direct_source, activeEntry.url)
                return { success: true, url: movie.direct_source }
            }

            // Stalker: find the movie in the (cached) VOD list, then mint the
            // playable URL via create_link (type=vod).
            if (activeEntry?.type === 'stalker') {
                const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
                const cached = await cachedCatalogFetch(
                    activeId ?? 'default',
                    'vod',
                    async () => stalkerVodToStreams(await stalker.getVodItems()),
                    false
                )
                const vod = cached.data as ReturnType<typeof stalkerVodToStreams>
                const movie = vod.find(v => v.stream_id === Number(streamId))
                if (!movie) return { success: false, error: 'Filme não encontrado no portal' }
                const url = await stalker.createLink(movie.direct_source, 'vod')
                registerApprovedProviderUrl(url, activeEntry.url)
                return { success: true, url }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const containerExt = container || 'mp4'
            const url = client.getVodStreamUrl(Number(streamId), containerExt)
            registerApprovedProviderUrl(url, auth.url)

            return { success: true, url }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get series episode stream URL
    ipcMain.handle('streams:get-series-url', async (_, { streamId, container }) => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            // M3U: the episode id maps back to an item in the parsed list.
            const activeId = getActivePlaylistIdPublic()
            const activeEntry = activeId ? findPlaylist(activeId) : undefined
            if (activeEntry?.type === 'm3u') {
                const channels = await fetchM3uChannels(activeEntry.url)
                const { series } = classifyM3uChannels(channels)
                const url = findM3uEpisodeUrl(series, Number(streamId))
                if (!url) return { success: false, error: 'Episódio não encontrado na lista M3U' }
                registerApprovedProviderUrl(url, activeEntry.url)
                return { success: true, url }
            }

            // Stalker: composite episode id -> season cmd + create_link(series=N).
            const stalkerEpisode = parseStalkerEpisodeId(String(streamId))
            if (stalkerEpisode && activeEntry?.type === 'stalker') {
                const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
                const seasons = await stalker.getSeasons(stalkerEpisode.portalSeriesId)
                const season = seasons.find(item => item.id === stalkerEpisode.seasonId)
                if (!season) return { success: false, error: 'Temporada não encontrada no portal' }
                const url = await stalker.createLink(season.cmd, 'vod', stalkerEpisode.episode)
                registerApprovedProviderUrl(url, activeEntry.url)
                return { success: true, url }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const url = client.getSeriesStreamUrl(streamId, container || 'mp4')
            registerApprovedProviderUrl(url, auth.url)

            return { success: true, url }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Series info (seasons/episodes). Xtream: proxied get_series_info (uses
    // the provider HTTPS agent, unlike the old renderer-side fetch); M3U:
    // built from the parsed list (SxxEyy grouping).
    ipcMain.handle('series:get-info', async (_, { seriesId }: { seriesId?: number | string }) => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const activeId = getActivePlaylistIdPublic()
            const activeEntry = activeId ? findPlaylist(activeId) : undefined
            if (activeEntry?.type === 'm3u') {
                const channels = await fetchM3uChannels(activeEntry.url)
                const { series } = classifyM3uChannels(channels)
                return { success: true, info: m3uSeriesInfo(series, Number(seriesId)) }
            }
            if (activeEntry?.type === 'stalker') {
                const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
                const cached = await cachedCatalogFetch(
                    activeId ?? 'default',
                    'series',
                    async () => stalkerSeriesToList(await stalker.getSeriesItems()),
                    false
                )
                const list = cached.data as ReturnType<typeof stalkerSeriesToList>
                const target = list.find(item => item.series_id === Number(seriesId))
                if (!target) return { success: false, error: 'Série não encontrada no portal' }
                const seasons = await stalker.getSeasons(target.portal_id)
                return { success: true, info: stalkerSeriesInfo(target.portal_id, seasons) }
            }

            const base = String(auth.url).replace(/\/$/, '')
            const infoUrl = `${base}/player_api.php?username=${encodeURIComponent(auth.username)}&password=${encodeURIComponent(auth.password)}&action=get_series_info&series_id=${encodeURIComponent(String(seriesId ?? ''))}`
            const response = await axios.get(infoUrl, {
                timeout: 15000,
                httpsAgent: getProviderHttpsAgent(infoUrl, base)
            })
            return { success: true, info: response.data }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get live stream URL
    ipcMain.handle('streams:get-live-url', async (_, { streamId }) => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            // M3U/Stalker: the channel entry carries what playback needs
            // (direct URL / portal cmd) — resolve from the cached live list so
            // multi-view and PiP zap work on every playlist type.
            const activeId = getActivePlaylistIdPublic()
            const activeEntry = activeId ? findPlaylist(activeId) : undefined
            if (activeEntry?.type === 'm3u' || activeEntry?.type === 'stalker') {
                const cached = await cachedCatalogFetch(
                    activeId ?? 'default',
                    'live',
                    async () => activeEntry.type === 'm3u'
                        ? m3uToLiveStreams(classifyM3uChannels(await fetchM3uChannels(activeEntry.url)).live)
                        : stalkerChannelsToLiveStreams(await new StalkerClient(activeEntry.url, activeEntry.username).getAllChannels()),
                    false
                )
                const streams = cached.data as { stream_id: number; direct_source: string }[]
                const channel = streams.find(s => s.stream_id === Number(streamId))
                if (!channel?.direct_source) {
                    return { success: false, error: 'Canal não encontrado na playlist ativa' }
                }
                const url = activeEntry.type === 'stalker'
                    ? await new StalkerClient(activeEntry.url, activeEntry.username).createLink(channel.direct_source)
                    : channel.direct_source
                registerApprovedProviderUrl(url, activeEntry.url)
                return { success: true, url }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const url = client.getLiveStreamUrl(streamId)
            registerApprovedProviderUrl(url, auth.url)

            return { success: true, url }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get catch-up/timeshift (replay) stream URL for an archived program.
    // startIso is the program start in ISO-8601 (UTC); the provider expects
    // its OWN local time, so the start is converted using the UTC offset
    // learned from the provider xmltv (fallback: this machine's offset).
    ipcMain.handle('streams:get-timeshift-url', async (_, { streamId, startIso, durationMin }) => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const startMs = Date.parse(String(startIso))
            if (Number.isNaN(startMs)) {
                return { success: false, error: 'Invalid start time' }
            }
            const duration = Math.max(1, Math.round(Number(durationMin) || 0))

            // Make sure the xmltv probe ran so the provider offset is known.
            await ensureProviderEpgLoaded()
            const offsetMinutes = getProviderUtcOffsetMinutes() ?? -new Date().getTimezoneOffset()
            const start = formatTimeshiftStart(startMs, offsetMinutes)

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const m3u8Url = client.getTimeshiftM3u8Url(Number(streamId), start, duration)
            const phpUrl = client.getTimeshiftPhpUrl(Number(streamId), start, duration)

            // Session-cached probe: try the path form once; on 4xx/timeout
            // fall back to streaming/timeshift.php for the rest of the session.
            let form = timeshiftProbeResult?.base === auth.url ? timeshiftProbeResult.form : null
            if (!form) {
                form = (await probeTimeshiftM3u8(m3u8Url, auth.url)) ? 'm3u8' : 'php'
                timeshiftProbeResult = { base: auth.url, form }
                log.info('[Timeshift] Probe selected form:', form)
            }

            const url = form === 'm3u8' ? m3u8Url : phpUrl
            const fallbackUrl = form === 'm3u8' ? phpUrl : m3u8Url
            registerApprovedProviderUrl(url, auth.url)
            registerApprovedProviderUrl(fallbackUrl, auth.url)

            return { success: true, url, fallbackUrl, form, offsetMinutes }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // The user's OpenSubtitles credentials (Configurações → APIs). Values come
    // back as saved so the form can prefill — this is the user's own machine
    // and their own account.
    ipcMain.handle('opensubtitles:get-config', () => {
        const saved = (store.get('openSubtitles') ?? {}) as Partial<OpenSubtitlesConfig>
        return {
            success: true,
            apiKey: saved.apiKey || '',
            username: saved.username || '',
            password: saved.password || '',
        }
    })

    ipcMain.handle('opensubtitles:set-config', (_e, raw: Partial<OpenSubtitlesConfig> | undefined) => {
        store.set('openSubtitles', {
            apiKey: String(raw?.apiKey ?? '').trim().slice(0, 200),
            username: String(raw?.username ?? '').trim().slice(0, 200),
            password: String(raw?.password ?? '').slice(0, 200),
        })
        return { success: true }
    })

    // OpenSubtitles API proxy (bypass CORS)
    ipcMain.handle('opensubtitles:request', async (_, { endpoint, method, body }: { endpoint: string; method?: string; body?: OpenSubtitlesBody }) => {
        try {
            const creds = getOpenSubtitlesConfig()
            if (!creds.apiKey) {
                return { success: false, error: 'OpenSubtitles API key is not configured' }
            }
            if (endpoint === '/login' && (!creds.username || !creds.password)) {
                return { success: false, error: 'OpenSubtitles credentials are not configured' }
            }

            const fetch = (await import('node-fetch')).default
            const baseUrl = 'https://api.opensubtitles.com/api/v1'
            const requestBody = endpoint === '/login'
                ? {
                    ...body,
                    username: creds.username,
                    password: creds.password
                }
                : { ...body }

            const headers: Record<string, string> = {
                'Api-Key': creds.apiKey,
                'Content-Type': 'application/json',
                'User-Agent': 'NeoStream IPTV v2.9.0'
            }

            // Add Authorization header if provided in body
            if (requestBody?.authToken) {
                headers['Authorization'] = `Bearer ${requestBody.authToken}`
                delete requestBody.authToken
            }

            const options: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal } = {
                method: method || 'GET',
                headers,
                signal: AbortSignal.timeout(15000)
            }

            if (requestBody && method === 'POST') {
                options.body = JSON.stringify(requestBody)
            }

            const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`
            log.info(`[OpenSubtitles] ${method} ${endpoint}`)

            const response = await fetch(url, options)
            const data = await response.json()

            return {
                success: response.ok,
                status: response.status,
                data
            }
        } catch (error: unknown) {
            log.error('[OpenSubtitles] Error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Save a user-data backup JSON to a file chosen by the user
    ipcMain.handle('backup:save-file', async (_, { json }: { json: string }) => {
        try {
            const date = new Date().toISOString().slice(0, 10)
            const result = await dialog.showSaveDialog({
                title: 'Save backup',
                defaultPath: `neostream-backup-${date}.json`,
                filters: [{ name: 'JSON', extensions: ['json'] }]
            })

            if (result.canceled || !result.filePath) {
                return { success: false, canceled: true }
            }

            const fs = await import('fs/promises')
            await fs.writeFile(result.filePath, json, 'utf-8')
            log.info('[Backup] Saved to', result.filePath)
            return { success: true, path: result.filePath }
        } catch (error: unknown) {
            log.error('[Backup] Save error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Wrapped retrospective card: the renderer draws a PNG on a canvas and
    // hands the base64 over; main shows the save dialog and writes the bytes.
    ipcMain.handle('wrapped:save-png', async (_, { dataUrl }: { dataUrl?: string }) => {
        try {
            const base64 = String(dataUrl ?? '').replace(/^data:image\/png;base64,/, '')
            if (!base64 || /[^A-Za-z0-9+/=]/.test(base64)) {
                return { success: false, error: 'PNG inválido' }
            }
            const year = new Date().getFullYear()
            const result = await dialog.showSaveDialog({
                title: 'Salvar retrospectiva',
                defaultPath: `neostream-wrapped-${year}.png`,
                filters: [{ name: 'PNG', extensions: ['png'] }]
            })
            if (result.canceled || !result.filePath) {
                return { success: false, canceled: true }
            }
            const fs = await import('fs/promises')
            await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'))
            log.info('[Wrapped] card salvo em', result.filePath)
            return { success: true, path: result.filePath }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Load a user-data backup JSON from a file chosen by the user
    ipcMain.handle('backup:load-file', async () => {
        try {
            const result = await dialog.showOpenDialog({
                title: 'Open backup',
                filters: [{ name: 'JSON', extensions: ['json'] }],
                properties: ['openFile']
            })

            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, canceled: true }
            }

            const fs = await import('fs/promises')
            const json = await fs.readFile(result.filePaths[0], 'utf-8')
            log.info('[Backup] Loaded from', result.filePaths[0])
            return { success: true, json }
        } catch (error: unknown) {
            log.error('[Backup] Load error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // 🩺 Verificador de favoritos: sonda uma lista de URLs de stream (GET com
    // o corpo destruído na hora — o 1º byte basta) e devolve vivo/morto por
    // id. Roda aqui no main pra não esbarrar em CORS no renderer.
    ipcMain.handle('diagnostics:probe-urls', async (_e, data: { targets?: { id: string; url: string }[] }) => {
        const targets = (data?.targets ?? []).filter(t => t?.id && t?.url).slice(0, 40)
        const probeOne = async (target: { id: string; url: string }) => {
            try {
                const response = await axios.get(target.url, {
                    timeout: 8000,
                    validateStatus: () => true,
                    responseType: 'stream',
                    httpsAgent: getProviderHttpsAgent(target.url, target.url)
                })
                const body = response.data as { destroy?: () => void } | undefined
                body?.destroy?.()
                return { id: target.id, alive: response.status >= 200 && response.status < 400 }
            } catch {
                return { id: target.id, alive: false }
            }
        }
        // 4 por vez pra não afogar o provedor.
        const results: { id: string; alive: boolean }[] = []
        for (let i = 0; i < targets.length; i += 4) {
            results.push(...await Promise.all(targets.slice(i, i + 4).map(probeOne)))
        }
        return { success: true, results }
    })

    // Provider health: probe the active provider's endpoints with timings.
    ipcMain.handle('diagnostics:provider-health', async () => {
        const auth = store.get('auth')
        if (!auth.url || !auth.username || !auth.password) {
            return { success: false, error: 'Not authenticated' }
        }
        const base = String(auth.url).replace(/\/$/, '')
        const creds = `username=${encodeURIComponent(auth.username)}&password=${encodeURIComponent(auth.password)}`

        const probe = async (name: string, url: string) => {
            const startedAt = Date.now()
            try {
                const response = await axios.get(url, {
                    timeout: 8000,
                    validateStatus: () => true,
                    responseType: 'stream',
                    httpsAgent: getProviderHttpsAgent(url, base)
                })
                const body = response.data as { destroy?: () => void } | undefined
                body?.destroy?.()
                return { name, ok: response.status >= 200 && response.status < 400, status: response.status, ms: Date.now() - startedAt }
            } catch (error: unknown) {
                return { name, ok: false, status: null, ms: Date.now() - startedAt, error: getErrorMessage(error) }
            }
        }

        // Non-Xtream playlists get type-appropriate checks: the M3U document
        // itself, or the portal handshake + channel list.
        const activeId = getActivePlaylistIdPublic()
        const activeEntry = activeId ? findPlaylist(activeId) : undefined

        if (activeEntry?.type === 'm3u') {
            const startedAt = Date.now()
            const download = await probe('m3u_download', activeEntry.url)
            const parseResult = await fetchM3uChannels(activeEntry.url)
                .then(channels => ({ name: 'm3u_parse', ok: channels.length > 0, status: null, ms: Date.now() - startedAt, error: undefined as string | undefined }))
                .catch((error: unknown) => ({ name: 'm3u_parse', ok: false, status: null, ms: Date.now() - startedAt, error: getErrorMessage(error) as string | undefined }))
            return { success: true, results: [download, parseResult] }
        }

        if (activeEntry?.type === 'stalker') {
            const stalker = new StalkerClient(activeEntry.url, activeEntry.username)
            const timed = async (name: string, run: () => Promise<unknown>) => {
                const startedAt = Date.now()
                try {
                    await run()
                    return { name, ok: true, status: null, ms: Date.now() - startedAt }
                } catch (error: unknown) {
                    return { name, ok: false, status: null, ms: Date.now() - startedAt, error: getErrorMessage(error) }
                }
            }
            const handshake = await timed('stalker_handshake', () => stalker.handshake())
            const channels = handshake.ok
                ? await timed('stalker_channels', () => stalker.getAllChannels())
                : { name: 'stalker_channels', ok: false, status: null, ms: 0, error: 'handshake falhou' }
            return { success: true, results: [handshake, channels] }
        }

        const results = await Promise.all([
            probe('player_api', `${base}/player_api.php?${creds}`),
            probe('live_streams', `${base}/player_api.php?${creds}&action=get_live_streams`),
            probe('xmltv', `${base}/xmltv.php?${creds}`)
        ])
        return { success: true, results }
    })

    // Full playlist entries for the backup file (passwords included — the
    // renderer immediately encodes them into the payload it writes to disk).
    ipcMain.handle('backup:export-playlists', () => {
        try {
            return { success: true, playlists: exportPlaylistsForBackup() }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Restore playlists from a backup (no provider validation — may be offline).
    ipcMain.handle('backup:import-playlists', (_, { playlists }: { playlists: PlaylistBackupEntry[] }) => {
        try {
            const imported = importPlaylistsFromBackup(Array.isArray(playlists) ? playlists : [])
            return { success: true, imported }
        } catch (error: unknown) {
            log.error('[Backup] Playlist import error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Provider EPG (xmltv.php / get_simple_data_table) handlers
    setupProviderEpgHandlers()

    log.info('IPC Handlers initialized')
}
