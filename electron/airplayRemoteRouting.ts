/**
 * Phone-remote → AirPlay session command planning — PURE, same spirit as
 * castRemoteRouting (Chromecast) and dlnaRemoteRouting (DLNA).
 *
 * The classic AirPlay video protocol speaks HTTP: POST /rate?value=0|1
 * (pause/resume), GET /scrub → "duration/position", POST /scrub?position=S
 * (absolute seek) and POST /stop. There is NO volume control in this protocol
 * (that's the RAOP audio side), so volume actions return null and keep the
 * old behaviour (local player).
 */

export type AirplayPlan =
    | { kind: 'rate'; value: 0 | 1 }
    | { kind: 'seekRelative'; seconds: number }
    | { kind: 'stop' }
    | { kind: 'noop' }

/**
 * Map a wire action to an AirPlay plan, or null when this protocol can't
 * consume it. `playing` is the locally-tracked transport state (the protocol
 * has no cheap "is playing" query, so the session remembers the last rate).
 */
export function planAirplayCommand(action: string, value: number | undefined, playing: boolean): AirplayPlan | null {
    switch (action) {
        case 'togglePlay':
            return { kind: 'rate', value: playing ? 0 : 1 }
        case 'stop':
            return { kind: 'stop' }
        case 'seek': {
            const num = typeof value === 'number' && Number.isFinite(value) ? value : undefined
            // Invalid delta is consumed as a no-op (never leaks to the local player).
            return num === undefined ? { kind: 'noop' } : { kind: 'seekRelative', seconds: num }
        }
        default:
            return null // volume/mute/subtitle/audio/queue: not in this protocol
    }
}

/** Parse the GET /scrub body ("duration: 123.4\nposition: 56.7"). */
export function parseScrub(body: string): { duration: number; position: number } {
    const num = (name: string) => {
        const match = new RegExp(`${name}:\\s*([\\d.]+)`).exec(body)
        const parsed = match ? Number(match[1]) : NaN
        return Number.isFinite(parsed) ? parsed : 0
    }
    return { duration: num('duration'), position: num('position') }
}

// ---------------------------------------------- AirPlay status → phone state --

export interface AirplayStatusRaw {
    position: number
    duration: number
    /** Locally-tracked transport state (the protocol has no cheap query). */
    playing: boolean
    title: string
    deviceName: string
}

/**
 * Same field shape the phone renders for Chromecast/DLNA. AirPlay video has
 * no volume control, so castVolume stays null (slider hidden).
 */
export function airplayStateFields(status: AirplayStatusRaw): {
    casting: true
    castPlaying: boolean
    castTime: number
    castDuration: number
    castTitle: string
    castVolume: null
    castDevice: string
} {
    return {
        casting: true,
        castPlaying: status.playing,
        castTime: Math.max(0, status.position || 0),
        castDuration: Math.max(0, status.duration || 0),
        castTitle: status.title,
        castVolume: null,
        castDevice: status.deviceName,
    }
}
