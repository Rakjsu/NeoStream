import { useState, useEffect, useCallback } from 'react';
import type { CastStatus } from './useDLNA';

export interface AirPlayDevice {
    id: string;
    name: string;
    type: 'airplay';
    host: string;
    port: number;
    model: string;
    available: boolean;
}

interface AirPlayDeviceResult {
    id: string;
    name: string;
    host: string;
    port?: number;
    model?: string;
}

interface AirPlayDiscoverResult {
    success: boolean;
    devices: AirPlayDeviceResult[];
}

export function useAirPlay(videoUrl: string, videoTitle: string) {
    const [devices, setDevices] = useState<AirPlayDevice[]>([]);
    const [isCasting, setIsCasting] = useState(false);
    const [currentDevice, setCurrentDevice] = useState<AirPlayDevice | null>(null);

    // Discover AirPlay devices via IPC
    const discoverDevices = useCallback(async () => {
        try {
            const result = await window.ipcRenderer.invoke('airplay:discover') as AirPlayDiscoverResult;
            if (result.success) {
                const airplayDevices: AirPlayDevice[] = result.devices.map((d) => ({
                    id: d.id,
                    name: d.name,
                    type: 'airplay' as const,
                    host: d.host,
                    port: d.port || 7000,
                    model: d.model || 'Unknown',
                    available: true
                }));
                setDevices(airplayDevices);
            }
        } catch (error) {
            console.error('❌ AirPlay discovery error:', error);
        }
    }, []);

    // Start discovery on mount
    useEffect(() => {
        const discoveryTimeout = setTimeout(() => {
            void discoverDevices();
        }, 0);

        // Refresh every 30 seconds
        const interval = setInterval(discoverDevices, 30000);
        return () => {
            clearTimeout(discoveryTimeout);
            clearInterval(interval);
        };
    }, [discoverDevices]);

    const castToDevice = async (device: AirPlayDevice) => {
        try {
            const result = await window.ipcRenderer.invoke('airplay:cast', {
                deviceId: device.id,
                url: videoUrl,
                title: videoTitle
            });

            if (result.success) {
                setIsCasting(true);
                setCurrentDevice(device);
                            }
        } catch (error) {
            console.error('❌ AirPlay cast error:', error);
        }
    };

    const stopCasting = async () => {
        if (!currentDevice) return;

        try {
            await window.ipcRenderer.invoke('airplay:stop', {
                deviceId: currentDevice.id
            });
            setIsCasting(false);
            setCurrentDevice(null);
        } catch (error) {
            console.error('❌ AirPlay stop error:', error);
        }
    };

    return {
        devices,
        isCasting,
        currentDevice,
        discoverDevices,
        castToDevice,
        stopCasting
    };
}

// ===== Item 25: transporte da sessão AirPlay no próprio desktop ==============

export interface AirplayStatusResult {
    success: boolean;
    active?: boolean;
    playing?: boolean;
    position?: number;
    duration?: number;
    title?: string;
    deviceId?: string;
    deviceName?: string;
}

/**
 * Mapeia a resposta do airplay:status pro shape que o CastControls consome
 * (mesmo contrato do DLNA/Chromecast). PURO — testado em useAirPlay.test.ts.
 */
export function mapAirplayStatus(result: AirplayStatusResult | null):
    Partial<CastStatus> & { success: boolean; error?: string } {
    if (!result?.success || !result.active) {
        return { success: false, error: 'No active cast session' };
    }
    return {
        success: true,
        state: result.playing ? 'PLAYING' : 'PAUSED_PLAYBACK',
        position: result.position ?? 0,
        duration: result.duration ?? 0,
        // O protocolo AirPlay de vídeo não tem volume (isso é o lado RAOP) —
        // null esconde o slider no mini-remoto.
        volume: null,
        title: result.title || '',
        deviceId: result.deviceId || 'airplay',
        queue: [],
        currentItemId: null,
        subtitleAvailable: false,
        audioTracks: [],
    };
}

// Mesma assinatura de castControls/chromecastControls — o CastControls troca
// de backend só pelo deviceType.
export const airplayControls = {
    pause: () => window.ipcRenderer.invoke('airplay:set-playing', { playing: false }) as Promise<{ success: boolean }>,
    resume: () => window.ipcRenderer.invoke('airplay:set-playing', { playing: true }) as Promise<{ success: boolean }>,
    seek: (seconds: number) => window.ipcRenderer.invoke('airplay:seek', { seconds }) as Promise<{ success: boolean }>,
    // Sem volume/fila/legenda/áudio neste protocolo — no-ops de paridade.
    setVolume: (): Promise<{ success: boolean }> => Promise.resolve({ success: false }),
    stop: (deviceId: string) => window.ipcRenderer.invoke('airplay:stop', { deviceId }) as Promise<{ success: boolean }>,
    getStatus: async () => mapAirplayStatus(await window.ipcRenderer.invoke('airplay:status') as AirplayStatusResult),
    queueJump: (): Promise<{ success: boolean }> => Promise.resolve({ success: false }),
    queueSkip: (): Promise<{ success: boolean }> => Promise.resolve({ success: false }),
    setSubtitleEnabled: (): Promise<{ success: boolean }> => Promise.resolve({ success: false }),
    setAudioTrack: (): Promise<{ success: boolean }> => Promise.resolve({ success: false }),
};
