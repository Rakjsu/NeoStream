import { ipcMain, BrowserWindow, screen } from 'electron'
import { XtreamClient } from './xtreamClient'
import store from './store'

// Store for window state (for custom maximize)
let savedWindowBounds: Electron.Rectangle | null = null

export function setupIpcHandlers() {
    ipcMain.handle('ping', () => 'pong')

    // Window controls for custom title bar
    ipcMain.handle('window:minimize', () => {
        const win = BrowserWindow.getFocusedWindow()
        if (win) win.minimize()
    })

    // Custom maximize that respects taskbar (doesn't use native maximize)
    ipcMain.handle('window:maximize', () => {
        const win = BrowserWindow.getFocusedWindow()
        if (!win) return

        const currentBounds = win.getBounds()
        // Get the display where the window currently is (not primary)
        const display = screen.getDisplayMatching(currentBounds)
        const workArea = display.workArea

        // Check if currently "maximized" (bounds match workArea)
        const isMaxed = currentBounds.x === workArea.x &&
            currentBounds.y === workArea.y &&
            currentBounds.width === workArea.width &&
            currentBounds.height === workArea.height

        if (isMaxed && savedWindowBounds) {
            // Restore to saved bounds
            win.setBounds(savedWindowBounds)
            savedWindowBounds = null
        } else {
            // Save current bounds and "maximize" to workArea
            savedWindowBounds = currentBounds
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
        const win = BrowserWindow.getFocusedWindow()
        if (!win) return false

        const currentBounds = win.getBounds()
        // Get the display where the window currently is (not primary)
        const display = screen.getDisplayMatching(currentBounds)
        const workArea = display.workArea

        // Check if currently "maximized" (bounds match workArea)
        return currentBounds.x === workArea.x &&
            currentBounds.y === workArea.y &&
            currentBounds.width === workArea.width &&
            currentBounds.height === workArea.height
    })

    ipcMain.handle('auth:login', async (_, { url, username, password }) => {
        try {
            const client = new XtreamClient(url, username, password)
            const data = await client.authenticate()

            // Save to store
            store.set('auth', { url, username, password, userInfo: data.user_info })

            return { success: true, data }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
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
        store.set('auth', {})
        return { success: true }
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
        } catch (error: any) {
            return { success: false, error: error.message }
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
        } catch (error: any) {
            return { success: false, error: error.message }
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
        } catch (error: any) {
            return { success: false, error: error.message }
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
        } catch (error: any) {
            return { success: false, error: error.message }
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
        } catch (error: any) {
            return { success: false, error: error.message }
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
        } catch (error: any) {
            return { success: false, error: error.message }
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
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    // Fetch EPG from meuguia.tv (bypasses CORS)
    ipcMain.handle('epg:fetch-meuguia', async (_, channelSlug: string) => {
        try {
            const fetch = (await import('node-fetch')).default
            // URL encode the channel slug to handle spaces
            const encodedSlug = encodeURIComponent(channelSlug)
            const url = `https://meuguia.tv/programacao/canal/${encodedSlug}`
            console.log('[EPG IPC] Fetching:', url)
            const response = await fetch(url)
            const html = await response.text()
            console.log('[EPG IPC] Response length:', html.length)
            return { success: true, html }
        } catch (error: any) {
            console.error('[EPG IPC] Error:', error.message)
            return { success: false, error: error.message }
        }
    })

    // Fetch EPG from mi.tv async API (returns pre-rendered content)
    ipcMain.handle('epg:fetch-mitv', async (_, channelSlug: string) => {
        try {
            const fetch = (await import('node-fetch')).default
            // Use the async API endpoint that returns rendered HTML content
            const url = `https://mi.tv/br/async/channel/${channelSlug}/-300`
            console.log('[EPG IPC] Fetching mi.tv async API:', url)
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            })

            if (!response.ok) {
                console.log('[EPG IPC] mi.tv returned:', response.status)
                return { success: false, error: `HTTP ${response.status}` }
            }

            const html = await response.text()
            console.log('[EPG IPC] mi.tv Response length:', html.length)
            return { success: true, html }
        } catch (error: any) {
            console.error('[EPG IPC] mi.tv Error:', error.message)
            return { success: false, error: error.message }
        }
    })

    // Generic fetch URL handler (bypasses CORS for external URLs)
    ipcMain.handle('fetch-url', async (_, url: string) => {
        try {
            const fetch = (await import('node-fetch')).default
            console.log('[Fetch URL] Fetching:', url.substring(0, 100))
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*'
                }
            })

            if (!response.ok) {
                console.log('[Fetch URL] Response failed:', response.status)
                return { success: false, error: `HTTP ${response.status}` }
            }

            const text = await response.text()
            console.log('[Fetch URL] Response length:', text.length)
            return { success: true, data: text }
        } catch (error: any) {
            console.error('[Fetch URL] Error:', error.message)
            return { success: false, error: error.message }
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
                        console.log('[EPG Cache] Cache valid, age:', Math.round(cacheAge / 3600000), 'hours')
                        cacheValid = true
                    } else {
                        console.log('[EPG Cache] Cache old, downloading fresh (age:', Math.round(cacheAge / 60000), 'min)')
                    }
                } catch (e) {
                    console.log('[EPG Cache] No cache found, will download fresh')
                }
            } else {
                console.log('[EPG Cache] Force refresh requested')
            }

            // If cache is valid (within 24 hours), return cached data
            if (cacheValid) {
                try {
                    const data = await fs.readFile(cacheFile, 'utf-8')
                    console.log('[EPG Cache] Returning cached data, length:', data.length)
                    return { success: true, data, fromCache: true }
                } catch (e) {
                    console.log('[EPG Cache] Cache file read failed, will download fresh')
                }
            }

            // Download fresh data
            console.log('[EPG Cache] Downloading from:', url)
            const fetch = (await import('node-fetch')).default
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/xml, text/xml, */*'
                }
            })

            if (!response.ok) {
                console.error('[EPG Cache] Download failed:', response.status)

                // Try to return stale cache if download fails
                try {
                    const data = await fs.readFile(cacheFile, 'utf-8')
                    console.log('[EPG Cache] Returning stale cache due to download failure')
                    return { success: true, data, fromCache: true, stale: true }
                } catch (e) {
                    return { success: false, error: `Download failed: HTTP ${response.status}` }
                }
            }

            const data = await response.text()
            console.log('[EPG Cache] Downloaded data, length:', data.length)

            // Save to cache
            await fs.writeFile(cacheFile, data, 'utf-8')
            await fs.writeFile(metaFile, JSON.stringify({
                timestamp: Date.now(),
                url: url,
                size: data.length
            }), 'utf-8')

            console.log('[EPG Cache] Saved to cache:', cacheFile)
            return { success: true, data, fromCache: false }

        } catch (error: any) {
            console.error('[EPG Cache] Error:', error.message)
            return { success: false, error: error.message }
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
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })
    ipcMain.handle('streams:get-vod-url', async (_, { streamId, container }) => {
        try {
            console.log('[Download] get-vod-url called with:', { streamId, container })
            const auth = store.get('auth')
            if (!auth.url || !auth.username || !auth.password) {
                return { success: false, error: 'Not authenticated' }
            }

            const client = new XtreamClient(auth.url, auth.username, auth.password)
            const containerExt = container || 'mp4'
            console.log('[Download] Using container extension:', containerExt)
            const url = client.getVodStreamUrl(Number(streamId), containerExt)
            console.log('[Download] Generated VOD URL:', url.replace(auth.password, '***'))

            return { success: true, url }
        } catch (error: any) {
            return { success: false, error: error.message }
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

            return { success: true, url }
        } catch (error: any) {
            return { success: false, error: error.message }
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

            return { success: true, url }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    })

    // OpenSubtitles API proxy (bypass CORS)
    ipcMain.handle('opensubtitles:request', async (_, { endpoint, method, body }) => {
        try {
            const fetch = (await import('node-fetch')).default
            const baseUrl = 'https://api.opensubtitles.com/api/v1'
            const apiKey = 'SG2i7zzvvhSdqYbgFRVDPqb8vQkJMDs9'

            const headers: Record<string, string> = {
                'Api-Key': apiKey,
                'Content-Type': 'application/json',
                'User-Agent': 'NeoStream IPTV v2.9.0'
            }

            // Add Authorization header if provided in body
            if (body?.authToken) {
                headers['Authorization'] = `Bearer ${body.authToken}`
                delete body.authToken
            }

            const options: any = {
                method: method || 'GET',
                headers
            }

            if (body && method === 'POST') {
                options.body = JSON.stringify(body)
            }

            const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`
            console.log(`[OpenSubtitles] ${method} ${endpoint}`)

            const response = await fetch(url, options)
            const data = await response.json()

            return {
                success: response.ok,
                status: response.status,
                data
            }
        } catch (error: any) {
            console.error('[OpenSubtitles] Error:', error.message)
            return { success: false, error: error.message }
        }
    })

    console.log('IPC Handlers initialized')
}
