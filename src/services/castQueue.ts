/**
 * Shared Chromecast QUEUE_LOAD helper. Callers resolve the play URLs (VOD,
 * episodes, whatever) and hand a flat list here; this discovers the first
 * Chromecast on the LAN and enqueues it. Used by the "Assistir Depois" page
 * and by casting a whole series season.
 */

export interface CastQueueItem {
    url: string
    title: string
    /** Optional WebVTT text (main serves it on the LAN for the device). */
    subtitleVtt?: string
    subtitleLanguage?: string
}

export type CastQueueResult =
    | { status: 'no-device' }
    | { status: 'empty' }
    | { status: 'error'; deviceName?: string }
    | { status: 'ok'; count: number; deviceName: string }

interface DiscoverResult {
    success: boolean
    devices?: { id: string; name: string }[]
}

/**
 * Discover a Chromecast and QUEUE_LOAD the resolved items on it. Items without
 * a URL are dropped (a failed resolve upstream). Never throws — returns a
 * discriminated result the caller turns into a message.
 */
export async function castResolvedQueue(items: CastQueueItem[]): Promise<CastQueueResult> {
    const discover = await window.ipcRenderer.invoke('cast:discover').catch(() => null) as DiscoverResult | null
    const device = discover?.devices?.[0]
    if (!device) return { status: 'no-device' }

    const queue = items.filter(i => i.url)
    if (queue.length === 0) return { status: 'empty' }

    const result = await window.ipcRenderer.invoke('cast:play-queue', { deviceId: device.id, items: queue })
        .catch(() => null) as { success: boolean; count?: number } | null
    if (!result?.success) return { status: 'error', deviceName: device.name }
    return { status: 'ok', count: result.count ?? queue.length, deviceName: device.name }
}
