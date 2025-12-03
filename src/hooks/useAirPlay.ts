import { useState, useEffect, useCallback } from 'react';

export interface AirPlayDevice {
    id: string;
    name: string;
    type: 'airplay';
    host: string;
    port: number;
    model: string;
    available: boolean;
}

export function useAirPlay(videoUrl: string, videoTitle: string) {
    const [devices, setDevices] = useState<AirPlayDevice[]>([]);
    const [isCasting, setIsCasting] = useState(false);
    const [currentDevice, setCurrentDevice] = useState<AirPlayDevice | null>(null);

    // Discover AirPlay devices via IPC
    const discoverDevices = useCallback(async () => {
        try {
            const result = await window.ipcRenderer.invoke('airplay:discover');
            if (result.success) {
                const airplayDevices: AirPlayDevice[] = result.devices.map((d: any) => ({
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
        discoverDevices();

        // Refresh every 30 seconds
        const interval = setInterval(discoverDevices, 30000);
        return () => clearInterval(interval);
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
                console.log('✅ Casting to AirPlay device:', device.name);
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
