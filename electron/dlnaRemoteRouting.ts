/**
 * Phone-remote → DLNA session command planning — PURE (no SOAP/electron), so
 * the action mapping and the volume math are unit-testable. The executor in
 * dlnaHandlers turns each plan into the actual UPnP calls.
 *
 * Mirrors castRemoteRouting (Chromecast): the same wire actions, but DLNA has
 * no queue (next/previous fall through to the renderer) and volume is 0..100.
 */

export type DlnaPlan =
    | { kind: 'toggle' }
    | { kind: 'stop' }
    | { kind: 'seekRelative'; seconds: number }
    | { kind: 'setVolume'; level: number }
    | { kind: 'volumeStep'; delta: number }
    | { kind: 'muteToggle' }
    | { kind: 'noop' }

/**
 * Map a wire action to a UPnP plan, or null when the session cannot consume
 * it (unknown action / queue skip) and the caller should fall through.
 * `value` carries the seek delta, the setVolume level (0..1) — same slot the
 * Chromecast router uses.
 */
export function planDlnaCommand(action: string, value: number | undefined): DlnaPlan | null {
    const num = typeof value === 'number' && Number.isFinite(value) ? value : undefined
    switch (action) {
        case 'togglePlay': return { kind: 'toggle' }
        case 'stop': return { kind: 'stop' }
        case 'seek':
            // Invalid delta is consumed as a no-op (never leaks to the local player).
            return num === undefined ? { kind: 'noop' } : { kind: 'seekRelative', seconds: num }
        case 'setVolume':
            // Wire level is 0..1 (like Chromecast); DLNA speaks 0..100.
            return num === undefined ? { kind: 'noop' } : { kind: 'setVolume', level: clampVolume(Math.round(num * 100)) }
        case 'volumeUp': return { kind: 'volumeStep', delta: 10 }
        case 'volumeDown': return { kind: 'volumeStep', delta: -10 }
        case 'mute': return { kind: 'muteToggle' }
        default:
            return null // next/previous/subtitle/setAudioTrack: not for DLNA
    }
}

export function clampVolume(level: number): number {
    return Math.max(0, Math.min(100, Math.round(level)))
}

/** Next volume after a ± step. */
export function stepVolume(current: number, delta: number): number {
    return clampVolume(current + delta)
}

/**
 * Mute toggle target: 0 when audible (remembering the level), else the
 * remembered pre-mute level (sane default when nothing was remembered).
 */
export function muteTarget(current: number, preMute: number): { level: number; preMute: number } {
    if (current > 0) return { level: 0, preMute: current }
    return { level: clampVolume(preMute > 0 ? preMute : 30), preMute }
}

// ------------------------------------------------ DLNA status → phone state --

export interface DlnaStatusRaw {
    /** UPnP CurrentTransportState (PLAYING/PAUSED_PLAYBACK/TRANSITIONING/…). */
    state: string
    position: number
    duration: number
    /** 0..100, or null when the renderer refuses GetVolume. */
    volume: number | null
    title: string
    deviceName: string
}

/**
 * Map a DLNA status snapshot onto the SAME field shape the phone already
 * renders for Chromecast (castTime/castDuration/castVolume 0..1/…), so the
 * page needs no changes to show DLNA progress.
 */
export function dlnaStateFields(status: DlnaStatusRaw): {
    casting: true
    castPlaying: boolean
    castTime: number
    castDuration: number
    castTitle: string
    castVolume: number | null
    castDevice: string
} {
    return {
        casting: true,
        castPlaying: status.state === 'PLAYING' || status.state === 'TRANSITIONING',
        castTime: Math.max(0, status.position || 0),
        castDuration: Math.max(0, status.duration || 0),
        castTitle: status.title,
        castVolume: status.volume === null ? null : clampVolume(status.volume) / 100,
        castDevice: status.deviceName,
    }
}
