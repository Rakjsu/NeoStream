import { ipcMain, BrowserWindow, dialog, screen } from 'electron'
import axios from 'axios'
import { XtreamClient } from './xtreamClient'
import store from './store'
import { getCertificateSettings, getProviderHttpsAgent, registerApprovedProviderUrl, setAllowInvalidProviderCertificates } from './certificatePolicy'
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

import log from './logger'
// Store for window state (for custom maximize)
let savedWindowBounds: Electron.Rectangle | null = null

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

const OPEN_SUBTITLES_API_KEY = process.env.OPEN_SUBTITLES_API_KEY
const OPEN_SUBTITLES_USERNAME = process.env.OPEN_SUBTITLES_USERNAME
const OPEN_SUBTITLES_PASSWORD = process.env.OPEN_SUBTITLES_PASSWORD

export function setupIpcHandlers() {
    // Legacy single `auth` entry → multi-playlist model (one-time, idempotent).
    migratePlaylistsOnStartup()

    ipcMain.handle('ping', () => 'pong')

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

    ipcMain.handle('playlists:switch', async (_, { id }) => {
        try {
            const target = findPlaylist(String(id))
            if (!target) {
                return { success: false, error: 'Playlist not found' }
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
    ipcMain.handle('streams:get-live', async () => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const streams = await client.getLiveStreams()

            return { success: true, data: streams }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get VOD streams
    ipcMain.handle('streams:get-vod', async () => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const streams = await client.getVODStreams()

            return { success: true, data: streams }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get series
    ipcMain.handle('streams:get-series', async () => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const streams = await client.getSeries()

            return { success: true, data: streams }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get live TV categories
    ipcMain.handle('categories:get-live', async () => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const categories = await client.getLiveCategories()

            return { success: true, data: categories }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get VOD categories
    ipcMain.handle('categories:get-vod', async () => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const categories = await client.getVodCategories()

            return { success: true, data: categories }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Get series categories  
    ipcMain.handle('categories:get-series', async () => {
        try {
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const categories = await client.getSeriesCategories()

            return { success: true, data: categories }
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Fetch EPG from meuguia.tv (bypasses CORS)
    ipcMain.handle('epg:fetch-meuguia', async (_, channelSlug: string) => {
        try {
            const fetch = (await import('node-fetch')).default
            // URL encode the channel slug to handle spaces
            const encodedSlug = encodeURIComponent(channelSlug)
            const url = `https://meuguia.tv/programacao/canal/${encodedSlug}`
            log.info('[EPG IPC] Fetching:', url)
            const response = await fetch(url)
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
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            })

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
            const response = await fetch(url, {
                agent: getProviderHttpsAgent(url),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*'
                }
            })

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
            const response = await fetch(url, {
                agent: getProviderHttpsAgent(url),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/xml, text/xml, */*'
                }
            })

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

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const url = client.getSeriesStreamUrl(streamId, container || 'mp4')
            registerApprovedProviderUrl(url, auth.url)

            return { success: true, url }
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

    // OpenSubtitles API proxy (bypass CORS)
    ipcMain.handle('opensubtitles:request', async (_, { endpoint, method, body }: { endpoint: string; method?: string; body?: OpenSubtitlesBody }) => {
        try {
            if (!OPEN_SUBTITLES_API_KEY) {
                return { success: false, error: 'OpenSubtitles API key is not configured' }
            }
            if (endpoint === '/login' && (!OPEN_SUBTITLES_USERNAME || !OPEN_SUBTITLES_PASSWORD)) {
                return { success: false, error: 'OpenSubtitles credentials are not configured' }
            }

            const fetch = (await import('node-fetch')).default
            const baseUrl = 'https://api.opensubtitles.com/api/v1'
            const requestBody = endpoint === '/login'
                ? {
                    ...body,
                    username: OPEN_SUBTITLES_USERNAME,
                    password: OPEN_SUBTITLES_PASSWORD
                }
                : { ...body }

            const headers: Record<string, string> = {
                'Api-Key': OPEN_SUBTITLES_API_KEY,
                'Content-Type': 'application/json',
                'User-Agent': 'NeoStream IPTV v2.9.0'
            }

            // Add Authorization header if provided in body
            if (requestBody?.authToken) {
                headers['Authorization'] = `Bearer ${requestBody.authToken}`
                delete requestBody.authToken
            }

            const options: { method: string; headers: Record<string, string>; body?: string } = {
                method: method || 'GET',
                headers
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
