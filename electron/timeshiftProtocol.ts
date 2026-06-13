/**
 * Pure helpers for Xtream catch-up/timeshift (replay) URLs — no Electron, no
 * network, no state. The side-effectful parts (probe, ipcMain handler) live
 * in ipcHandlers.ts.
 *
 * Two URL forms are seen in the wild:
 *   a) {base}/timeshift/{user}/{pass}/{durationMin}/{start}/{id}.m3u8
 *   b) {base}/streaming/timeshift.php?username=..&password=..&stream={id}
 *        &start={start}&duration={durationMin}
 *
 * `start` is "YYYY-MM-DD:HH-MM" in the PROVIDER's local time — derive the
 * offset from the provider xmltv (providerEpg.getProviderUtcOffsetMinutes)
 * and fall back to the local machine offset.
 */
import { normalizeServerUrl } from './providerEpgProtocol'

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * Formats an instant (epoch ms) as the Xtream timeshift start string
 * "YYYY-MM-DD:HH-MM" in the provider's local time, given the provider's
 * UTC offset in minutes (e.g. -180 for UTC-3).
 */
export function formatTimeshiftStart(startMs: number, offsetMinutes: number): string {
    // Shift the instant by the offset and read the wall-clock via UTC getters.
    const local = new Date(startMs + offsetMinutes * 60 * 1000)
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
        + `:${pad(local.getUTCHours())}-${pad(local.getUTCMinutes())}`
}

/** Form (a): path-style timeshift URL ending in .m3u8. */
export function buildTimeshiftM3u8Url(
    serverUrl: string,
    username: string,
    password: string,
    streamId: number,
    start: string,
    durationMin: number
): string {
    const base = normalizeServerUrl(serverUrl)
    return `${base}/timeshift/${encodeURIComponent(username)}/${encodeURIComponent(password)}`
        + `/${durationMin}/${start}/${streamId}.m3u8`
}

/** Form (b): query-style streaming/timeshift.php URL. */
export function buildTimeshiftPhpUrl(
    serverUrl: string,
    username: string,
    password: string,
    streamId: number,
    start: string,
    durationMin: number
): string {
    const base = normalizeServerUrl(serverUrl)
    return `${base}/streaming/timeshift.php?username=${encodeURIComponent(username)}`
        + `&password=${encodeURIComponent(password)}`
        + `&stream=${encodeURIComponent(String(streamId))}`
        + `&start=${encodeURIComponent(start)}`
        + `&duration=${encodeURIComponent(String(durationMin))}`
}
