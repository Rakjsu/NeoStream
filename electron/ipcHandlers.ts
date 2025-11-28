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

    console.log('IPC Handlers initialized')
}
