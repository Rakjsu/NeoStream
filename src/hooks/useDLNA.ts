import { useState, useCallback, useEffect } from 'react';

export interface DLNADevice {
    id: string;
    name: string;
    type: 'dlna';
    host: string;
    port?: number;
    location?: string;
    source: 'discovered' | 'manual';
    online: boolean;
}

export function useDLNA(videoUrl: string, videoTitle: string) {
    const [devices, setDevices] = useState<DLNADevice[]>([]);
    const [isCasting, setIsCasting] = useState(false);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [currentDevice, setCurrentDevice] = useState<DLNADevice | null>(null);
    const [error, setError] = useState<string | null>(null);

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
                    location: d.location,
                    source: d.source || 'manual',
                    online: d.online !== false
                }));
                setDevices(dlnaDevices);
            }
        } catch (error) {
            console.error('❌ DLNA load error:', error);
        }
    }, []);

    // Discover devices on network
    const discoverDevices = useCallback(async () => {
        setIsDiscovering(true);
        setError(null);

        try {
            const result = await window.ipcRenderer.invoke('dlna:discover');
            if (result.success) {
                const dlnaDevices: DLNADevice[] = result.devices.map((d: any) => ({
                    id: d.id,
                    name: d.name,
                    type: 'dlna' as const,
                    host: d.host,
                    port: d.port,
                    location: d.location,
                    source: d.source || 'discovered',
                    online: d.online !== false
                }));
                setDevices(dlnaDevices);
                            } else {
                setError(result.error || 'Discovery failed');
            }
        } catch (error: any) {
            console.error('❌ DLNA discover error:', error);
            setError(error.message || 'Discovery error');
        } finally {
            setIsDiscovering(false);
        }
    }, []);

    // Add manual device
    const addDevice = async (name: string, ip: string, port: number = 8080) => {
        setError(null);
        try {
            const result = await window.ipcRenderer.invoke('dlna:add-device', {
                name,
                ip,
                port
            });

            if (result.success) {
                                await loadDevices();
                return true;
            }
            setError(result.error || 'Failed to add device');
            return false;
        } catch (error: any) {
            console.error('❌ DLNA add device error:', error);
            setError(error.message || 'Add device failed');
            return false;
        }
    };

    // Remove device
    const removeDevice = async (deviceId: string) => {
        try {
            const result = await window.ipcRenderer.invoke('dlna:remove-device', { deviceId });
            if (result.success) {
                await loadDevices();
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ DLNA remove device error:', error);
            return false;
        }
    };

    // Load devices on mount
    useEffect(() => {
        loadDevices();
    }, [loadDevices]);

    // Cast to device
    const castToDevice = async (device: DLNADevice) => {
        setError(null);
        try {
            const result = await window.ipcRenderer.invoke('dlna:cast', {
                deviceId: device.id,
                url: videoUrl,
                title: videoTitle
            });

            if (result.success) {
                setIsCasting(true);
                setCurrentDevice(device);
                                return true;
            } else {
                setError(result.error || 'Cast failed');
                return false;
            }
        } catch (error: any) {
            console.error('❌ DLNA cast error:', error);
            setError(error.message || 'Cast error');
            return false;
        }
    };

    // Stop casting
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
        isDiscovering,
        currentDevice,
        error,
        discoverDevices,
        castToDevice,
        stopCasting,
        addDevice,
        removeDevice,
        loadDevices
    };
}
