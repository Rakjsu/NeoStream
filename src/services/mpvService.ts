/**
 * EXPERIMENTAL — MPV playback engine PoC.
 *
 * Thin renderer-side wrapper over the mpv:* IPC channels exposed by
 * electron/mpvPlayer.ts. Whether MPV is *used* is decided by the
 * `mpvEnabled` flag in playbackService (per-profile playback settings).
 */

export interface MpvStatus {
    running: boolean;
    timePos: number | null;
    duration: number | null;
    paused: boolean;
    eofReached: boolean;
    volume: number | null;
    fullscreen: boolean;
}

export interface MpvAvailability {
    path: string | null;
    configuredPath: string | null;
}

export interface MpvPlayResult {
    success: boolean;
    reason?: string;
}

class MpvService {
    /** Resolved mpv path (configured > PATH > common install dirs) or null. */
    async getAvailability(): Promise<MpvAvailability> {
        try {
            const result = await window.ipcRenderer.invoke('mpv:available');
            return {
                path: result?.path ?? null,
                configuredPath: result?.configuredPath ?? null,
            };
        } catch (error) {
            console.warn('[MPV] availability check failed:', error);
            return { path: null, configuredPath: null };
        }
    }

    /**
     * Launch mpv glued over the app window (pseudo-embedded, main-side
     * geometry follow). Never throws — inspect `success`/`reason`.
     */
    async play(url: string, title?: string, startSeconds?: number): Promise<MpvPlayResult> {
        try {
            const result = await window.ipcRenderer.invoke('mpv:play', { url, title, start: startSeconds });
            return result ?? { success: false, reason: 'no-response' };
        } catch (error) {
            console.warn('[MPV] play failed:', error);
            return { success: false, reason: 'ipc-error' };
        }
    }

    async pause(): Promise<void> {
        await window.ipcRenderer.invoke('mpv:pause').catch(() => undefined);
    }

    async resume(): Promise<void> {
        await window.ipcRenderer.invoke('mpv:resume').catch(() => undefined);
    }

    async seek(seconds: number): Promise<void> {
        await window.ipcRenderer.invoke('mpv:seek', { seconds }).catch(() => undefined);
    }

    /** Set the player volume (0..100). */
    async setVolume(volume: number): Promise<void> {
        await window.ipcRenderer.invoke('mpv:set-volume', { volume }).catch(() => undefined);
    }

    /** Toggle the mpv window in/out of fullscreen. */
    async setFullscreen(fullscreen: boolean): Promise<void> {
        await window.ipcRenderer.invoke('mpv:set-fullscreen', { fullscreen }).catch(() => undefined);
    }

    async stop(): Promise<void> {
        await window.ipcRenderer.invoke('mpv:stop').catch(() => undefined);
    }

    /** Polled status snapshot ({ running:false, ... } when nothing is playing). */
    async getStatus(): Promise<MpvStatus | null> {
        try {
            const status = await window.ipcRenderer.invoke('mpv:status');
            return status ?? null;
        } catch {
            return null;
        }
    }

    /** Persist a user-chosen mpv.exe path (empty clears it). Returns the re-resolved path. */
    async setPath(path: string): Promise<string | null> {
        try {
            const result = await window.ipcRenderer.invoke('mpv:set-path', { path });
            return result?.path ?? null;
        } catch (error) {
            console.warn('[MPV] set-path failed:', error);
            return null;
        }
    }
}

export const mpvService = new MpvService();
