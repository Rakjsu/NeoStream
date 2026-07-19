import { useState, useEffect } from 'react';
import { movieProgressService } from '../services/movieProgressService';
import { watchProgressService } from '../services/watchProgressService';
import { CastControls } from './CastControls';

interface CastMeta {
    contentId: string;
    contentType?: 'movie' | 'series' | 'live';
    season?: number;
    episode?: number;
    title?: string;
}

interface ActiveSession {
    type: 'chromecast' | 'airplay';
    deviceId: string;
    deviceName: string;
}

/**
 * A small, always-mounted "Transmitindo na TV" pill (app root, page-independent).
 * It also gives the cast-reconnect capability a home: on startup it asks the
 * main process to re-adopt a Chromecast session that survived an app restart
 * (only the Default Media Receiver — never hijacks Netflix/YouTube). The full
 * transport controls stay in the player's CastControls; this is just presence
 * + a quick Stop, visible from any screen.
 *
 * Since it already polls cast:get-status, it's also where cast playback is
 * mirrored into the local watch history (movies/episodes), so what you watch on
 * the TV shows up in "continuar assistindo" — surviving reconnects, because the
 * session keeps the content identity (meta) across a dropped socket.
 *
 * Item 25: the pill also covers the AirPlay session (airplay:status) — the
 * Chromecast session wins when both exist, since only it carries meta/queue.
 */
export function GlobalCastIndicator() {
    const [session, setSession] = useState<ActiveSession | null>(null);

    useEffect(() => {
        let cancelled = false;
        // Resume control of a cast still running after a restart (best-effort).
        void window.ipcRenderer.invoke('cast:reconnect').catch(() => undefined);

        // Only swap state when something changed, so the 2s poll doesn't
        // re-render (and remount-flicker) the mini-remote.
        const update = (next: ActiveSession | null) => setSession(prev => (
            prev?.type === next?.type
                && prev?.deviceId === next?.deviceId
                && prev?.deviceName === next?.deviceName
                ? prev : next
        ));

        const poll = async () => {
            const result = await window.ipcRenderer.invoke('cast:get-status').catch(() => null) as
                { success?: boolean; active?: boolean; deviceName?: string;
                  currentTime?: number | null; duration?: number | null; meta?: CastMeta | null } | null;
            if (cancelled) return;
            const active = !!(result?.success && result.active);
            if (active) {
                update({ type: 'chromecast', deviceId: 'chromecast', deviceName: result!.deviceName || 'Chromecast' });

                // Mirror cast position into the local history (movies / episodes).
                const meta = result?.meta;
                const cur = result?.currentTime ?? 0, dur = result?.duration ?? 0;
                if (meta?.contentId && meta.contentType !== 'live' && dur > 0 && cur > 0) {
                    if (meta.contentType === 'series' && meta.season != null && meta.episode != null) {
                        watchProgressService.saveVideoTime(meta.contentId, meta.season, meta.episode, cur, dur);
                    } else if (meta.contentType !== 'series') {
                        movieProgressService.saveMovieTime(meta.contentId, meta.title || '', cur, dur);
                    }
                }
                return;
            }

            // No Chromecast — the pill also adopts an active AirPlay session.
            const airplay = await window.ipcRenderer.invoke('airplay:status').catch(() => null) as
                { success?: boolean; active?: boolean; deviceId?: string; deviceName?: string } | null;
            if (cancelled) return;
            if (airplay?.success && airplay.active) {
                update({ type: 'airplay', deviceId: airplay.deviceId || 'airplay', deviceName: airplay.deviceName || 'AirPlay' });
            } else {
                update(null);
            }
        };
        void poll();
        // 2s so the remote appears promptly after a cast starts anywhere.
        const id = setInterval(() => void poll(), 2000);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    if (!session) return null;

    // The FULL mini-remote (play/pause, seek, ⏮/⏭, 💬, 🔊, queue, stop) lives
    // here at the app root, so it survives closing the player, navigating and
    // even playing something else locally — the cast never loses its controls.
    // Keyed by backend so switching Chromecast↔AirPlay remounts fresh state.
    return (
        <CastControls
            key={session.type}
            deviceId={session.deviceId}
            deviceName={session.deviceName}
            deviceType={session.type}
            onSessionEnded={() => setSession(null)}
        />
    );
}
