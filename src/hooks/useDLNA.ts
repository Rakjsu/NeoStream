import { useState, useCallback, useEffect } from 'react';

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

    // Load saved devices
    const loadDevices = useCallback(async () => {
        try {
            const result = await window.ipcRenderer.invoke('dlna:get-devices');
            if (result.success) {
                const dlnaDevices: DLNADevice[] = result.devices.map((d: any) => ({
                    id: d.id,
                    name: d.name,
                    type: 'dlna' as const,
                    host: d.host,
                    port: d.port,
                    available: true
                }));
                setDevices(dlnaDevices);
            }
        } catch (error) {
            console.error('❌ DLNA load error:', error);
        }
    }, []);

    // Add manual device
    const addDevice = async (name: string, ip: string, port: number = 8080) => {
        try {
            const result = await window.ipcRenderer.invoke('dlna:add-device', {
                name,
                ip,
                port
            });

            if (result.success) {
                console.log('✅ Device added:', result.device);
                await loadDevices();
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ DLNA add device error:', error);
            return false;
        }
    };

    // Load devices on mount
    useEffect(() => {
        loadDevices();
    }, [loadDevices]);

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
            } else {
                alert(`Erro ao transmitir: ${result.error}`);
            }
        } catch (error) {
            console.error('❌ DLNA cast error:', error);
            alert('Erro ao transmitir para o dispositivo');
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

    // Dummy discover function for compatibility
    const discoverDevices = async () => {
        await loadDevices();
    };

    return {
        devices,
        isCasting,
        currentDevice,
        discoverDevices,
        castToDevice,
        stopCasting,
        addDevice,
        loadDevices
    };
}
