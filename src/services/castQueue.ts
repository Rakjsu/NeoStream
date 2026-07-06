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
    /** Seconds into this item to start at (resume mid-episode). */
    startTime?: number
    /** Identity echoed in cast status while this item plays (watch history). */
    meta?: {
        contentId: string
        contentType?: 'movie' | 'series' | 'live'
        season?: number
        episode?: number
        title?: string
    }
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

interface SeriesInfoEpisode {
    id: number | string
    episode_num: number | string
    title?: string
    container_extension?: string
}

/**
 * Build the season's cast queue starting at `fromEpisode` (inclusive), so
 * casting one episode gives ⏮/⏭ the rest of the season to move through.
 * Resolves each episode's play URL; failed resolves are skipped. Returns an
 * empty list when the series/season can't be resolved (caller falls back to
 * a single cast). Never throws.
 */
export async function buildSeasonTailQueue(
    seriesId: string,
    season: number,
    fromEpisode: number,
): Promise<CastQueueItem[]> {
    const info = await window.ipcRenderer.invoke('series:get-info', { seriesId }).catch(() => null) as
        { success: boolean; info?: { episodes?: Record<string, SeriesInfoEpisode[]> } } | null
    const eps = info?.success ? (info.info?.episodes?.[String(season)] ?? []) : []
    const tail = eps.filter(ep => Number(ep.episode_num) >= fromEpisode)
        .sort((a, b) => Number(a.episode_num) - Number(b.episode_num))
    if (tail.length === 0) return []

    const { episodeDisplayTitle } = await import('../utils/seriesEpisodes')
    const queue: CastQueueItem[] = []
    for (const ep of tail) {
        const res = await window.ipcRenderer.invoke('streams:get-series-url', {
            streamId: ep.id,
            container: ep.container_extension || 'mp4',
        }).catch(() => null) as { success: boolean; url?: string } | null
        if (!res?.success || !res.url) continue
        const epNum = Number(ep.episode_num)
        const title = episodeDisplayTitle(ep.title || '', epNum)
        queue.push({
            url: res.url,
            title: `T${season}:E${epNum} · ${title}`,
            meta: { contentId: seriesId, contentType: 'series', season, episode: epNum, title },
        })
    }
    return queue
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
