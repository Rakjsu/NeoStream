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

interface DLNADeviceResult {
    id: string;
    name: string;
    host: string;
    port?: number;
    location?: string;
    source?: 'discovered' | 'manual';
    online?: boolean;
}

interface DLNADevicesResult {
    success: boolean;
    devices: DLNADeviceResult[];
    error?: string;
}

interface DLNACommandResult {
    success: boolean;
    error?: string;
}

function toDLNADevice(device: DLNADeviceResult, fallbackSource: DLNADevice['source']): DLNADevice {
    return {
        id: device.id,
        name: device.name,
        type: 'dlna',
        host: device.host,
        port: device.port,
        location: device.location,
        source: device.source || fallbackSource,
        online: device.online !== false
    };
}

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
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
            const result = await window.ipcRenderer.invoke('dlna:get-devices') as DLNADevicesResult;
            if (result.success) {
                const dlnaDevices = result.devices.map((d) => toDLNADevice(d, 'manual'));
                setDevices(dlnaDevices);
            }
        } catch (error) {
            console.error('DLNA load error:', error);
        }
    }, []);

    // Discover devices on network
    const discoverDevices = useCallback(async () => {
        setIsDiscovering(true);
        setError(null);

        try {
            const result = await window.ipcRenderer.invoke('dlna:discover') as DLNADevicesResult;
            if (result.success) {
                const dlnaDevices = result.devices.map((d) => toDLNADevice(d, 'discovered'));
                setDevices(dlnaDevices);
            } else {
                setError(result.error || 'Discovery failed');
            }
        } catch (error: unknown) {
            console.error('DLNA discover error:', error);
            setError(getErrorMessage(error, 'Discovery error'));
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
            }) as DLNACommandResult;

            if (result.success) {
                await loadDevices();
                return true;
            }

            setError(result.error || 'Failed to add device');
            return false;
        } catch (error: unknown) {
            console.error('DLNA add device error:', error);
            setError(getErrorMessage(error, 'Add device failed'));
            return false;
        }
    };

    // Remove device
    const removeDevice = async (deviceId: string) => {
        try {
            const result = await window.ipcRenderer.invoke('dlna:remove-device', { deviceId }) as DLNACommandResult;
            if (result.success) {
                await loadDevices();
                return true;
            }
            return false;
        } catch (error) {
            console.error('DLNA remove device error:', error);
            return false;
        }
    };

    // Load devices on mount
    useEffect(() => {
        void loadDevices();
    }, [loadDevices]);

    // Cast to device
    const castToDevice = async (device: DLNADevice) => {
        setError(null);
        try {
            const result = await window.ipcRenderer.invoke('dlna:cast', {
                deviceId: device.id,
                url: videoUrl,
                title: videoTitle
            }) as DLNACommandResult;

            if (result.success) {
                setIsCasting(true);
                setCurrentDevice(device);
                return true;
            }

            setError(result.error || 'Cast failed');
            return false;
        } catch (error: unknown) {
            console.error('DLNA cast error:', error);
            setError(getErrorMessage(error, 'Cast error'));
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
            console.error('DLNA stop error:', error);
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
