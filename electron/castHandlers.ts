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
import { routeCastCommand } from './castRemoteRouting'
import { registerCastSubtitleVtt, isLoopbackUrl, createLanProxyUrlFor } from './dlnaHandlers'
import { getErrorMessage } from './errorMessage'

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

// cast:reconnect roda na montagem do indicador global, muitas vezes ANTES de o
// mDNS ter ouvido alguém. Mapa vazio: cutuca e espera o primeiro 'up' (teto
// DISCOVERY_WAIT_MS) e mais um respiro pros outros aparelhos da casa (D097).
const DISCOVERY_WAIT_MS = 5000
const DISCOVERY_SETTLE_MS = 1500
const deviceWaiters = new Set<() => void>()

function waitForDevices(): Promise<void> {
    if (devices.size > 0) return Promise.resolve()
    browser?.update()
    return new Promise<void>((resolve) => {
        const done = () => {
            clearTimeout(timer)
            deviceWaiters.delete(done)
            if (devices.size === 0) { resolve(); return }
            setTimeout(resolve, DISCOVERY_SETTLE_MS)
        }
        const timer = setTimeout(done, DISCOVERY_WAIT_MS)
        deviceWaiters.add(done)
    })
}

/**
 * Tenta adotar, em paralelo, a sessão do receptor de mídia em cada candidato;
 * fica com o primeiro que responder. Toda tentativa que não vence é fechada —
 * inclusive a que ainda vai dar certo depois (senão o socket e o heartbeat
 * dela ficavam presos num slot de conexão da TV). Fechar não para o que a TV
 * perdedora está tocando: o close() não faz o STOP chegar lá (preso em
 * castAttachDesisteNaHora.test.ts).
 */
async function attachFirstRunning(candidates: CastDevice[]): Promise<{ device: CastDevice; session: CastSession }> {
    let winner: CastSession | null = null
    const attempts = candidates.map(async (device) => {
        const session = new CastSession(device.host, device.name)
        try {
            await session.attach()
        } catch (error) {
            session.close() // idempotente: mata heartbeat + socket da tentativa
            throw error
        }
        if (winner && winner !== session) {
            session.close()
            throw new Error('outro aparelho respondeu antes')
        }
        winner = session
        return { device, session }
    })
    return await Promise.any(attempts)
}

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
export function getCastStatus(): {
    active: boolean; playing: boolean; currentTime: number; duration: number;
    title: string; hasQueue: boolean; subtitleAvailable: boolean; subtitleEnabled: boolean;
    volume: number | null; audioTracks: { trackId: number; name: string; language: string }[];
    activeAudioTrackId: number | null;
    deviceName: string;
} {
    const s = activeSession
    if (!s?.isActive) {
        return {
            active: false, playing: false, currentTime: 0, duration: 0,
            title: '', hasQueue: false, subtitleAvailable: false, subtitleEnabled: true,
            volume: null, audioTracks: [], activeAudioTrackId: null, deviceName: '',
        }
    }
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
        subtitleAvailable: status.subtitleAvailable,
        subtitleEnabled: status.subtitleEnabled,
        volume: status.volume,
        audioTracks: status.audioTracks,
        activeAudioTrackId: status.activeAudioTrackId,
        deviceName: status.deviceName,
    }
}

/**
 * Route a phone-remote transport command to the active cast session, so the
 * same buttons that drive the local player drive the Chromecast when one is
 * casting. Returns true if a live session handled it (else the caller falls
 * back to the renderer's media:control). The branching itself lives in
 * castRemoteRouting.ts (pure, unit-tested); this owns the module state.
 */
export function castRemoteControl(action: string, seconds?: number): boolean {
    const s = activeSession
    if (!s || !s.isActive) return false
    const result = routeCastCommand(s, action, seconds, preMuteVolume)
    preMuteVolume = result.preMuteVolume
    if (result.stop) stopActiveSession()
    return result.handled
}

export function setupCastHandlers(): void {
    try {
        bonjour = new Bonjour()
        browser = bonjour.find({ type: 'googlecast', protocol: 'tcp' })
        browser.on('up', (service: Service) => {
            const device = deviceFromService(service)
            if (!device) return
            devices.set(device.id, device)
            for (const wake of [...deviceWaiters]) wake()
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
        // Declarada FORA do try para que o catch consiga fecha-la: o
        // `connectTransport()` ja abriu o socket TLS e ja armou o heartbeat de
        // 5 s ANTES do passo que falha (o LAUNCH estoura em 15 s). Sem o
        // close(), cada tentativa frustrada fica presa num dos poucos slots de
        // conexao do Chromecast, e depois de algumas a TV recusa o app. Quando
        // a falha vem do LOAD recusado, pior: ai o `reloadMedia` ja esta
        // armado, entao o socket abandonado ainda dispara `attemptReconnect()`
        // ao cair — sessao fantasma voltando sem ninguem no comando.
        let session: CastSession | null = null
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
            session = new CastSession(device.host, device.name)
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
            session?.close() // idempotente: mata heartbeat + socket da tentativa
            log.error('[Cast] play failed:', error)
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('cast:play-queue', async (_e, payload: { deviceId?: string; items?: { url?: string; title?: string; contentType?: string; subtitleVtt?: string; subtitleLanguage?: string; startTime?: number; meta?: CastMediaMeta }[] }) => {
        // Mesmo motivo do cast:play: o QUEUE_LOAD tambem vem depois do
        // transporte estar de pe, entao o catch precisa alcancar a sessao.
        let session: CastSession | null = null
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
            session = new CastSession(device.host, device.name)
            await session.startQueue(items)
            activeSession = session
            return { success: true, count: items.length }
        } catch (error) {
            session?.close() // idempotente: mata heartbeat + socket da tentativa
            log.error('[Cast] play-queue failed:', error)
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('cast:queue-skip', (_e, { direction }: { direction?: 'next' | 'prev' }) => {
        if (direction === 'next' || direction === 'prev') activeSession?.queueSkip(direction)
        return { success: activeSession !== null }
    })

    // Resume control of a cast that's still running after the app restarted:
    // attach to a device that has the Default Media Receiver playing (no LAUNCH,
    // so it never grabs Netflix/YouTube). Best-effort — silent when nothing's on.
    //
    // Sem deviceId, experimenta TODOS os aparelhos (em paralelo; o attach
    // desiste na hora quando a TV diz que não tem receptor de mídia) — antes
    // era o `[0]` do mapa, ou seja, quem o mDNS ouviu primeiro (D097).
    ipcMain.handle('cast:reconnect', async (_e, opts: { deviceId?: string } = {}) => {
        if (activeSession?.isActive) {
            return { success: true, active: true, deviceName: activeSession.deviceName, ...activeSession.status }
        }
        await waitForDevices()
        const candidates = opts?.deviceId
            ? [devices.get(String(opts.deviceId))].filter((d): d is CastDevice => !!d)
            : [...devices.values()]
        if (candidates.length === 0) return { success: false, error: 'Nenhum dispositivo' }
        // O caminho mais frequente: o indicador global chama cast:reconnect
        // em toda montagem e quase nunca ha algo tocando.
        try {
            const { device, session } = await attachFirstRunning(candidates)
            // Um cast:play/play-queue que terminou enquanto a retomada corria
            // e o que o usuario pediu agora: nao atropelar.
            if (activeSession?.isActive) {
                session.close()
                return { success: true, active: true, ...activeSession.status }
            }
            activeSession = session
            return { success: true, active: true, deviceId: device.id, ...session.status, deviceName: device.name }
        } catch (error) {
            // Promise.any rejeita com AggregateError: o motivo util e o de cada aparelho.
            const reasons = error instanceof AggregateError ? error.errors : [error]
            const first = reasons[0]
            // NAO e o getErrorMessage no log: aqui o fallback e o proprio erro, e
            // o logger imprime o objeto inteiro. Trocar por String(error) daria
            // "[object Object]" no log — menos informacao, nao mais.
            log.info('[Cast] nada pra retomar em', candidates.map(d => d.name).join(', '), '-',
                reasons.map(r => (r instanceof Error ? r.message : r)))
            return { success: false, error: getErrorMessage(first) }
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

    // Toggle the WebVTT subtitle track mid-playback (EDIT_TRACKS_INFO).
    ipcMain.handle('cast:set-subtitle', (_e, { enabled }: { enabled?: boolean }) => {
        if (typeof enabled === 'boolean') activeSession?.setSubtitleEnabled(enabled)
        return { success: activeSession !== null }
    })

    // Switch the audio rendition (only HLS multi-audio ever offers any).
    ipcMain.handle('cast:set-audio-track', (_e, { trackId }: { trackId?: number }) => {
        if (typeof trackId === 'number' && Number.isFinite(trackId)) activeSession?.setAudioTrack(trackId)
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
