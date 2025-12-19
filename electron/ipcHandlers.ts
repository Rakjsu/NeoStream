import { ipcMain } from 'electron'
import { XtreamClient } from './xtreamClient'
import store from './store'

export function setupIpcHandlers() {
    ipcMain.handle('ping', () => 'pong')

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
