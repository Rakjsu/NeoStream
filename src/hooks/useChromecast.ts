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

export function useChromecast(videoUrl: string, videoTitle: string, isLive = false) {
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
                live: isLive
            }) as CastCommandResult;
            setIsCasting(result.success);
            return result.success;
        } catch (error) {
            console.error('❌ Chromecast cast error:', error);
            return false;
        }
    }, [videoUrl, videoTitle, isLive]);

    const stopCasting = useCallback(async () => {
        await window.ipcRenderer.invoke('cast:stop').catch(() => undefined);
        setIsCasting(false);
    }, []);

    return { devices, discoverDevices, castToDevice, stopCasting, isCasting };
}
