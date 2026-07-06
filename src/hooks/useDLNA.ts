import { useState, useCallback, useEffect } from 'react';

export interface DLNADevice {
    id: string;
    name: string;
    type: 'dlna';
    host: string;
    port?: number;
    location?: string;
    manufacturer?: string;
    modelName?: string;
    isSamsung?: boolean;
    source: 'discovered' | 'manual';
    online: boolean;
}

interface DLNADeviceResult {
    id: string;
    name: string;
    host: string;
    port?: number;
    location?: string;
    manufacturer?: string;
    modelName?: string;
    isSamsung?: boolean;
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
        manufacturer: device.manufacturer,
        modelName: device.modelName,
        isSamsung: device.isSamsung,
        source: device.source || fallbackSource,
        online: device.online !== false
    };
}

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

export interface CastQueueEntry {
    itemId: number;
    title: string;
}

export interface CastStatus {
    state: string;
    position: number;
    duration: number;
    volume: number | null;
    title: string;
    deviceId: string;
    /** Present only for a Chromecast queue (QUEUE_LOAD); empty otherwise. */
    queue?: CastQueueEntry[];
    currentItemId?: number | null;
}

interface CastStatusResult extends Partial<CastStatus> {
    success: boolean;
    error?: string;
}

export function useDLNA(videoUrl: string, videoTitle: string, subtitleVtt?: string | null) {
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
    const addDevice = async (name: string, ip: string, port: number = 9197) => {
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

    // Load devices on mount (deferred: loadDevices flips loading state on entry)
    useEffect(() => {
        queueMicrotask(() => { void loadDevices(); });
    }, [loadDevices]);

    // Cast to device
    const castToDevice = async (device: DLNADevice) => {
        setError(null);
        try {
            const result = await window.ipcRenderer.invoke('dlna:cast', {
                deviceId: device.id,
                url: videoUrl,
                title: videoTitle,
                subtitleVtt: subtitleVtt || undefined
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

// ===== Cast remote-control helpers (active session lives in the main process) =====

export const castControls = {
    pause: () => window.ipcRenderer.invoke('dlna:pause') as Promise<DLNACommandResult>,
    resume: () => window.ipcRenderer.invoke('dlna:resume') as Promise<DLNACommandResult>,
    seek: (seconds: number) => window.ipcRenderer.invoke('dlna:seek', { seconds }) as Promise<DLNACommandResult>,
    setVolume: (volume: number) => window.ipcRenderer.invoke('dlna:set-volume', { volume }) as Promise<DLNACommandResult>,
    stop: (deviceId: string) => window.ipcRenderer.invoke('dlna:stop', { deviceId }) as Promise<DLNACommandResult>,
    getStatus: () => window.ipcRenderer.invoke('dlna:get-status') as Promise<CastStatusResult>,
    // DLNA has no queue — no-ops, kept for signature parity with chromecastControls.
    queueJump: (): Promise<DLNACommandResult> => Promise.resolve({ success: false }),
    queueSkip: (): Promise<DLNACommandResult> => Promise.resolve({ success: false }),
};
