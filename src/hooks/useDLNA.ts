import { useState, useEffect, useCallback } from 'react';

// Note: node-upnp works in Node.js backend, not browser
// For Electron, we'll need IPC communication

export interface DLNADevice {
    id: string;
    name: string;
    type: 'dlna';
    host: string;
    port: number;
    available: boolean;
}

export function useDLNA(videoUrl: string, videoTitle: string) {
    const [devices, setDevices] = useState<DLNADevice[]>([]);
    const [isCasting, setIsCasting] = useState(false);
    const [currentDevice, setCurrentDevice] = useState<DLNADevice | null>(null);

    // Discover DLNA devices via IPC
    const discoverDevices = useCallback(async () => {
        try {
            // Request device discovery from main process
            const result = await window.ipcRenderer.invoke('dlna:discover');
            if (result.success) {
                const dlnaDevices: DLNADevice[] = result.devices.map((d: any) => ({
                    id: d.id || `dlna-${d.name}`,
                    name: d.name,
                    type: 'dlna' as const,
                    host: d.host,
                    port: d.port || 1900,
                    available: true
                }));
                setDevices(dlnaDevices);
            }
        } catch (error) {
            console.error('❌ DLNA discovery error:', error);
        }
    }, []);

    // Start discovery on mount
    useEffect(() => {
        discoverDevices();

        // Refresh every 30 seconds
        const interval = setInterval(discoverDevices, 30000);
        return () => clearInterval(interval);
    }, [discoverDevices]);

    const castToDevice = async (device: DLNADevice) => {
        try {
            const result = await window.ipcRenderer.invoke('dlna:cast', {
                deviceId: device.id,
                url: videoUrl,
                title: videoTitle
            });

            if (result.success) {
                setIsCasting(true);
                setCurrentDevice(device);
                console.log('✅ Casting to DLNA device:', device.name);
            }
        } catch (error) {
            console.error('❌ DLNA cast error:', error);
        }
    };

    const stopCasting = async () => {
        if (!currentDevice) return;

        try {
            await window.ipcRenderer.invoke('dlna:stop', {
                deviceId: currentDevice.id
            });
            setIsCasting(false);
            setCurrentDevice(null);
        } catch (error) {
            console.error('❌ DLNA stop error:', error);
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
