import { useState, useEffect, useCallback } from 'react';

// Chromecast devices via the main-process castv2 client (castHandlers.ts).
// Mirrors useAirPlay's surface so CastDeviceSelector treats all cast targets
// the same way.

export interface ChromecastDevice {
    id: string;
    name: string;
    type: 'chromecast';
    host: string;
    model: string;
    available: boolean;
}

interface CastDiscoverResult {
    success: boolean;
    devices: { id: string; name: string; host: string; model: string }[];
}

interface CastCommandResult {
    success: boolean;
    error?: string;
}

/** Content identity + start position, so a cast can resume and record history. */
export interface CastContext {
    startPosition?: number;
    contentId?: string;
    contentType?: 'movie' | 'series' | 'live';
    season?: number;
    episode?: number;
}

export function useChromecast(videoUrl: string, videoTitle: string, isLive = false, subtitleVtt?: string | null, castContext?: CastContext) {
    const [devices, setDevices] = useState<ChromecastDevice[]>([]);
    const [isCasting, setIsCasting] = useState(false);

    const discoverDevices = useCallback(async () => {
        try {
            const result = await window.ipcRenderer.invoke('cast:discover') as CastDiscoverResult;
            if (result.success) {
                setDevices(result.devices.map(d => ({
                    id: d.id,
                    name: d.name,
                    type: 'chromecast' as const,
                    host: d.host,
                    model: d.model,
                    available: true
                })));
            }
        } catch (error) {
            console.error('❌ Chromecast discovery error:', error);
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => { void discoverDevices(); }, 0);
        const interval = setInterval(() => { void discoverDevices(); }, 10000);
        return () => {
            clearTimeout(timer);
            clearInterval(interval);
        };
    }, [discoverDevices]);

    const castToDevice = useCallback(async (device: ChromecastDevice): Promise<boolean> => {
        try {
            const result = await window.ipcRenderer.invoke('cast:play', {
                deviceId: device.id,
                url: videoUrl,
                title: videoTitle,
                live: isLive,
                subtitleVtt: subtitleVtt || undefined,
                // Resume position + content identity (so the cast records progress).
                startPosition: castContext?.startPosition && castContext.startPosition > 5 ? castContext.startPosition : undefined,
                meta: castContext?.contentId
                    ? {
                        contentId: castContext.contentId,
                        contentType: castContext.contentType,
                        season: castContext.season,
                        episode: castContext.episode,
                        title: videoTitle,
                    }
                    : undefined,
            }) as CastCommandResult;
            setIsCasting(result.success);
            return result.success;
        } catch (error) {
            console.error('❌ Chromecast cast error:', error);
            return false;
        }
    }, [videoUrl, videoTitle, isLive, subtitleVtt, castContext]);

    const stopCasting = useCallback(async () => {
        await window.ipcRenderer.invoke('cast:stop').catch(() => undefined);
        setIsCasting(false);
    }, []);

    // Resume control of a cast still running after the app restarted. Returns
    // the adopted device (for the caller to show the mini-remote), or null.
    const reconnect = useCallback(async (): Promise<{ id: string; name: string } | null> => {
        const result = await window.ipcRenderer.invoke('cast:reconnect').catch(() => null) as
            { success: boolean; active?: boolean; deviceId?: string; deviceName?: string } | null;
        if (result?.success && result.active && result.deviceId) {
            setIsCasting(true);
            return { id: result.deviceId, name: result.deviceName ?? 'Chromecast' };
        }
        return null;
    }, []);

    return { devices, discoverDevices, castToDevice, stopCasting, reconnect, isCasting };
}

/** Mini-remote adapter for Chromecast sessions (mirrors useDLNA.castControls). */
export const chromecastControls = {
    pause: () => window.ipcRenderer.invoke('cast:pause') as Promise<{ success: boolean }>,
    resume: () => window.ipcRenderer.invoke('cast:resume') as Promise<{ success: boolean }>,
    seek: (seconds: number) => window.ipcRenderer.invoke('cast:seek', { seconds }) as Promise<{ success: boolean }>,
    setVolume: (volume: number) =>
        window.ipcRenderer.invoke('cast:set-volume', { level: volume / 100 }) as Promise<{ success: boolean }>,
    // deviceId kept for signature parity with castControls (session is global).
    stop: (deviceId: string) => {
        void deviceId;
        return window.ipcRenderer.invoke('cast:stop') as Promise<{ success: boolean }>;
    },
    getStatus: async () => {
        const result = await window.ipcRenderer.invoke('cast:get-status') as {
            success: boolean; active?: boolean; playing?: boolean; mediaState?: string | null;
            currentTime?: number | null; duration?: number | null; volume?: number | null; deviceName?: string;
            queue?: { itemId: number; title: string }[]; currentItemId?: number | null;
        };
        if (!result.success || !result.active) {
            return { success: false, error: 'No active cast session' };
        }
        return {
            success: true,
            state: result.mediaState ?? (result.playing ? 'PLAYING' : 'PAUSED'),
            position: result.currentTime ?? 0,
            duration: result.duration ?? 0,
            volume: typeof result.volume === 'number' ? Math.round(result.volume * 100) : null,
            title: result.deviceName ?? '',
            deviceId: 'chromecast',
            queue: Array.isArray(result.queue) ? result.queue : [],
            currentItemId: result.currentItemId ?? null,
        };
    },
    queueJump: (itemId: number) =>
        window.ipcRenderer.invoke('cast:queue-jump', { itemId }) as Promise<{ success: boolean }>,
};
