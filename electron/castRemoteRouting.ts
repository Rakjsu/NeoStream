/**
 * Phone-remote → cast session command routing — PURE (no electron import),
 * extracted from castHandlers so the branching (queue skip vs channel zap,
 * mute memory, subtitle availability) is unit-testable with a fake session.
 *
 * The caller (castHandlers) owns the module state: the active session, the
 * remembered pre-mute volume and the actual session teardown on 'stop'.
 */

/** The slice of CastSession the router needs (structural, satisfied by it). */
export interface RoutableCastSession {
    readonly status: {
        playing: boolean
        currentTime: number | null
        volume: number | null
        queue: { itemId: number }[]
        subtitleAvailable: boolean
        subtitleEnabled: boolean
    }
    pause(): void
    resume(): void
    seek(seconds: number): void
    setVolume(level: number): void
    queueSkip(direction: 'next' | 'prev'): void
    setSubtitleEnabled(enabled: boolean): void
}

export interface RouteResult {
    /** True when the cast session consumed the command (else the caller falls
     * back to the renderer's media:control — e.g. channel zap). */
    handled: boolean
    /** Pre-mute volume to remember for the next 🔇 toggle. */
    preMuteVolume: number
    /** The caller must tear the session down (user pressed stop). */
    stop?: boolean
}

export function routeCastCommand(
    s: RoutableCastSession,
    action: string,
    seconds: number | undefined,
    preMuteVolume: number,
): RouteResult {
    const vol = s.status.volume ?? 0.5
    switch (action) {
        case 'togglePlay':
            if (s.status.playing) s.pause(); else s.resume()
            return { handled: true, preMuteVolume }
        case 'stop':
            return { handled: true, preMuteVolume, stop: true }
        case 'seek':
            // Relative on the wire (phone's -30/+30); cast seek is absolute.
            if (typeof seconds === 'number' && Number.isFinite(seconds)) {
                s.seek(Math.max(0, (s.status.currentTime ?? 0) + seconds))
            }
            return { handled: true, preMuteVolume }
        case 'next':
        case 'previous':
            // Queue cast (season/playlist): ⏮/⏭ skip episodes on the TV. With
            // no queue the action falls through to the renderer (channel zap).
            if (s.status.queue.length > 1) {
                s.queueSkip(action === 'next' ? 'next' : 'prev')
                return { handled: true, preMuteVolume }
            }
            return { handled: false, preMuteVolume }
        case 'volumeUp':
            s.setVolume(Math.min(1, vol + 0.1))
            return { handled: true, preMuteVolume }
        case 'volumeDown':
            s.setVolume(Math.max(0, vol - 0.1))
            return { handled: true, preMuteVolume }
        case 'mute':
            if (vol > 0) {
                s.setVolume(0)
                return { handled: true, preMuteVolume: vol } // remember for unmute
            }
            s.setVolume(preMuteVolume)
            return { handled: true, preMuteVolume }
        case 'subtitle':
            // 💬 toggle from the phone — only meaningful when the current
            // media carries a track (the phone hides the button otherwise).
            if (!s.status.subtitleAvailable) return { handled: false, preMuteVolume }
            s.setSubtitleEnabled(!s.status.subtitleEnabled)
            return { handled: true, preMuteVolume }
        default:
            return { handled: false, preMuteVolume }
    }
}
