/**
 * Chromecast IPC (main process): mDNS discovery + one active CastSession.
 *
 * Discovery mirrors the AirPlay handler: bonjour-service browsing
 * `_googlecast._tcp`, device names from the TXT record's `fn` field.
 */

import { ipcMain } from 'electron'
import { Bonjour, type Browser, type Service } from 'bonjour-service'
import log from './logger'
import { CastSession, type CastMediaInput, type CastMediaMeta } from './castClient'
import { registerCastSubtitleVtt, isLoopbackUrl, createLanProxyUrlFor } from './dlnaHandlers'

interface CastDevice {
    id: string
    name: string
    host: string
    model: string
}

let bonjour: Bonjour | null = null
let browser: Browser | null = null
const devices = new Map<string, CastDevice>()
let activeSession: CastSession | null = null

function deviceFromService(service: Service): CastDevice | null {
    const host = service.addresses?.find(addr => addr.includes('.'))
    if (!host) return null
    const txt = (service.txt ?? {}) as Record<string, string>
    return {
        id: service.fqdn || `${host}:googlecast`,
        name: txt.fn || service.name || host,
        host,
        model: txt.md || 'Chromecast',
    }
}

function stopActiveSession(): void {
    activeSession?.close()
    activeSession = null
}

// Remembered volume so the phone's 🔇 can toggle back on.
let preMuteVolume = 0.3

/** True while a Chromecast session is playing (used by the phone remote). */
export function isCastSessionActive(): boolean {
    return activeSession?.isActive ?? false
}

/** Snapshot of the active cast for the phone's progress bar (0s/0s when idle). */
export function getCastStatus(): { active: boolean; playing: boolean; currentTime: number; duration: number; title: string; hasQueue: boolean } {
    const s = activeSession
    if (!s?.isActive) return { active: false, playing: false, currentTime: 0, duration: 0, title: '', hasQueue: false }
    const status = s.status
    // What's playing: current queue item (episode) or the single-load meta.
    const currentItem = status.queue.find(item => item.itemId === status.currentItemId)
    return {
        active: true,
        playing: status.playing ?? false,
        currentTime: Math.max(0, status.currentTime ?? 0),
        duration: Math.max(0, status.duration ?? 0),
        title: currentItem?.title || status.meta?.title || '',
        hasQueue: status.queue.length > 1,
    }
}

/**
 * Route a phone-remote transport command to the active cast session, so the
 * same buttons that drive the local player drive the Chromecast when one is
 * casting. Returns true if a live session handled it (else the caller falls
 * back to the renderer's media:control). Seek is relative (± seconds), matching
 * the phone's -30/+30 buttons; cast seek is absolute, so we add to currentTime.
 */
export function castRemoteControl(action: string, seconds?: number): boolean {
    const s = activeSession
    if (!s || !s.isActive) return false
    const vol = s.status.volume ?? 0.5
    switch (action) {
        case 'togglePlay': if (s.status.playing) s.pause(); else s.resume(); break
        case 'stop': stopActiveSession(); break
        case 'seek':
            if (typeof seconds === 'number' && Number.isFinite(seconds)) {
                s.seek(Math.max(0, (s.status.currentTime ?? 0) + seconds))
            }
            break
        case 'next':
        case 'previous':
            // Queue cast (season/playlist): ⏮/⏭ skip episodes on the TV. With
            // no queue the action falls through to the renderer (channel zap).
            if ((s.status.queue?.length ?? 0) > 1) {
                s.queueSkip(action === 'next' ? 'next' : 'prev')
                break
            }
            return false
        case 'volumeUp': s.setVolume(Math.min(1, vol + 0.1)); break
        case 'volumeDown': s.setVolume(Math.max(0, vol - 0.1)); break
        case 'mute':
            if (vol > 0) { preMuteVolume = vol; s.setVolume(0) }
            else s.setVolume(preMuteVolume)
            break
        default: return false
    }
    return true
}

export function setupCastHandlers(): void {
    try {
        bonjour = new Bonjour()
        browser = bonjour.find({ type: 'googlecast', protocol: 'tcp' })
        browser.on('up', (service: Service) => {
            const device = deviceFromService(service)
            if (device) devices.set(device.id, device)
        })
        browser.on('down', (service: Service) => {
            devices.delete(service.fqdn || '')
        })
        log.info('[Cast] mDNS discovery started (googlecast)')
    } catch (error) {
        log.warn('[Cast] mDNS discovery unavailable:', error)
    }

    ipcMain.handle('cast:discover', () => {
        browser?.update()
        return { success: true, devices: [...devices.values()] }
    })

    ipcMain.handle('cast:play', async (_e, payload: { deviceId?: string; url?: string; title?: string; contentType?: string; live?: boolean; subtitleVtt?: string; startPosition?: number; meta?: CastMediaMeta }) => {
        try {
            const device = devices.get(String(payload?.deviceId ?? ''))
            if (!device) return { success: false, error: 'Dispositivo não encontrado' }
            let url = String(payload?.url ?? '')
            if (!/^https?:\/\//.test(url)) return { success: false, error: 'URL inválida' }
            // Loopback sources (rescue transcode) ride the LAN proxy so the
            // device can actually reach them.
            if (isLoopbackUrl(url)) {
                url = await createLanProxyUrlFor(url, device.host)
            }

            // Current subtitle rides along as a WebVTT text track served on LAN.
            let subtitleUrl: string | undefined
            if (typeof payload?.subtitleVtt === 'string' && payload.subtitleVtt.trim()) {
                try {
                    subtitleUrl = await registerCastSubtitleVtt(payload.subtitleVtt, device.host)
                } catch (error) {
                    log.warn('[Cast] legenda indisponível para o cast:', error)
                }
            }

            stopActiveSession()
            const session = new CastSession(device.host, device.name)
            const media: CastMediaInput = {
                url,
                title: String(payload?.title ?? 'NeoStream'),
                contentType: String(payload?.contentType ?? (url.includes('.m3u8') ? 'application/x-mpegurl' : 'video/mp4')),
                live: payload?.live === true,
                subtitleUrl,
            }
            // Resume from the given position (history / where the player was) and
            // carry the content identity so the renderer can record watch progress.
            const startPosition = typeof payload?.startPosition === 'number' && payload.startPosition > 0 ? payload.startPosition : 0
            if (payload?.meta && payload.meta.contentId) session.setMeta(payload.meta)
            await session.start(media, media.live ? 0 : startPosition)
            activeSession = session
            return { success: true }
        } catch (error) {
            log.error('[Cast] play failed:', error)
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    ipcMain.handle('cast:play-queue', async (_e, payload: { deviceId?: string; items?: { url?: string; title?: string; contentType?: string; subtitleVtt?: string; subtitleLanguage?: string; startTime?: number; meta?: CastMediaMeta }[] }) => {
        try {
            const device = devices.get(String(payload?.deviceId ?? ''))
            if (!device) return { success: false, error: 'Dispositivo não encontrado' }
            const raw = (payload?.items ?? []).filter(i => typeof i?.url === 'string' && /^https?:\/\//.test(i.url))
            const items: CastMediaInput[] = []
            for (const i of raw) {
                // Each item's optional WebVTT rides the same LAN proxy as the
                // single LOAD; a failed registration just drops that subtitle.
                let subtitleUrl: string | undefined
                if (typeof i.subtitleVtt === 'string' && i.subtitleVtt.trim()) {
                    try {
                        subtitleUrl = await registerCastSubtitleVtt(i.subtitleVtt, device.host)
                    } catch (error) {
                        log.warn('[Cast] legenda da fila indisponível:', error)
                    }
                }
                items.push({
                    url: String(i.url),
                    title: String(i.title ?? 'NeoStream'),
                    contentType: String(i.contentType ?? (String(i.url).includes('.m3u8') ? 'application/x-mpegurl' : 'video/mp4')),
                    live: false,
                    subtitleUrl,
                    subtitleLanguage: typeof i.subtitleLanguage === 'string' ? i.subtitleLanguage : undefined,
                    // Resume mid-episode (the item the cast starts on) + identity
                    // so the status echoes which episode is playing (history).
                    startTime: typeof i.startTime === 'number' && i.startTime > 0 ? i.startTime : undefined,
                    meta: i.meta && i.meta.contentId ? i.meta : undefined,
                })
            }
            if (items.length === 0) return { success: false, error: 'Fila vazia' }

            stopActiveSession()
            const session = new CastSession(device.host, device.name)
            await session.startQueue(items)
            activeSession = session
            return { success: true, count: items.length }
        } catch (error) {
            log.error('[Cast] play-queue failed:', error)
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    ipcMain.handle('cast:queue-skip', (_e, { direction }: { direction?: 'next' | 'prev' }) => {
        if (direction === 'next' || direction === 'prev') activeSession?.queueSkip(direction)
        return { success: activeSession !== null }
    })

    // Resume control of a cast that's still running after the app restarted:
    // attach to a device that has the Default Media Receiver playing (no LAUNCH,
    // so it never grabs Netflix/YouTube). Best-effort — silent when nothing's on.
    ipcMain.handle('cast:reconnect', async (_e, opts: { deviceId?: string } = {}) => {
        if (activeSession?.isActive) {
            return { success: true, active: true, deviceName: activeSession.deviceName, ...activeSession.status }
        }
        const device = opts?.deviceId ? devices.get(String(opts.deviceId)) : [...devices.values()][0]
        if (!device) return { success: false, error: 'Nenhum dispositivo' }
        try {
            const session = new CastSession(device.host, device.name)
            await session.attach()
            activeSession = session
            return { success: true, active: true, deviceId: device.id, deviceName: device.name, ...session.status }
        } catch (error) {
            log.info('[Cast] nada pra retomar em', device.name, '-', error instanceof Error ? error.message : error)
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    ipcMain.handle('cast:queue-jump', (_e, { itemId }: { itemId?: number }) => {
        if (typeof itemId === 'number' && Number.isFinite(itemId)) activeSession?.queueJump(itemId)
        return { success: activeSession !== null }
    })

    ipcMain.handle('cast:pause', () => {
        activeSession?.pause()
        return { success: activeSession !== null }
    })

    ipcMain.handle('cast:resume', () => {
        activeSession?.resume()
        return { success: activeSession !== null }
    })

    ipcMain.handle('cast:seek', (_e, { seconds }: { seconds?: number }) => {
        if (typeof seconds === 'number' && Number.isFinite(seconds)) activeSession?.seek(Math.max(0, seconds))
        return { success: activeSession !== null }
    })

    ipcMain.handle('cast:stop', () => {
        stopActiveSession()
        return { success: true }
    })

    ipcMain.handle('cast:set-volume', (_e, { level }: { level?: number }) => {
        if (typeof level === 'number' && Number.isFinite(level)) activeSession?.setVolume(level)
        return { success: activeSession !== null }
    })

    ipcMain.handle('cast:get-status', () => {
        // Prompt fresh times for the NEXT poll; return what we have now.
        activeSession?.requestMediaStatus()
        return {
            success: true,
            active: activeSession?.isActive ?? false,
            ...(activeSession?.status ?? {}),
        }
    })

    log.info('[Cast] IPC handlers initialized')
}

export function teardownCast(): void {
    stopActiveSession()
    browser?.stop()
    bonjour?.destroy()
}
