// AirPlay IPC Handlers for Electron Main Process
// Implementation with airplay-protocol

import { ipcMain } from 'electron';
import { createRequire } from 'module';

// Create require for CommonJS modules in ES module context
const require = createRequire(import.meta.url);

interface AirPlayDevice {
    id: string
    name?: string
    host: string
    port?: number
    model?: string
    features?: unknown
}

interface AirPlayBrowser {
    on(event: 'deviceOn' | 'deviceOff', callback: (device: AirPlayDevice) => void): void
    start(): void
}

interface AirPlayClient {
    play(url: string, startPosition: number, callback: (error?: Error | null) => void): void
    stop(callback: (error?: Error | null) => void): void
}

interface AirPlayModule {
    createBrowser(): AirPlayBrowser
    createDevice(host: string, port?: number): AirPlayClient
}

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

let airplayBrowser: AirPlayBrowser | null = null;
const discoveredDevices: Map<string, AirPlayDevice> = new Map();

// Initialize airplay
try {
    const airplay = require('airplay-protocol') as AirPlayModule;
    airplayBrowser = airplay.createBrowser();
    console.log('[AirPlay] airplay-protocol loaded successfully');
} catch (error) {
    console.error('[AirPlay] Failed to load airplay-protocol:', error);
}

export function setupAirPlayHandlers() {
    // Setup device discovery if browser exists
    if (airplayBrowser) {
        airplayBrowser.on('deviceOn', (device) => {
            console.log('[AirPlay] Device found:', device.name);
            discoveredDevices.set(device.id, device);
        });

        airplayBrowser.on('deviceOff', (device) => {
            console.log('[AirPlay] Device offline:', device.name);
            discoveredDevices.delete(device.id);
        });

        airplayBrowser.start();
    }

    // Discover AirPlay devices
    ipcMain.handle('airplay:discover', async () => {
        try {
            console.log('[AirPlay] Discovery requested');

            if (!airplayBrowser) {
                console.warn('[AirPlay] AirPlay not available');
                return {
                    success: true,
                    devices: []
                };
            }

            // Wait a bit for discovery
            await new Promise(resolve => setTimeout(resolve, 2000));

            const devices = Array.from(discoveredDevices.values()).map((device) => ({
                id: device.id,
                name: device.name || 'AirPlay Device',
                host: device.host,
                port: device.port || 7000,
                model: device.model || 'Unknown',
                features: device.features
            }));

            console.log(`[AirPlay] Found ${devices.length} devices`);

            return {
                success: true,
                devices
            };
        } catch (error: unknown) {
            console.error('[AirPlay] Discovery error:', error);
            return {
                success: false,
                error: getErrorMessage(error),
                devices: []
            };
        }
    });

    // Cast media to AirPlay device
    ipcMain.handle('airplay:cast', async (_, { deviceId, url, title }) => {
        try {
            console.log('[AirPlay] Cast requested:', { deviceId, title });

            if (!airplayBrowser) {
                throw new Error('AirPlay not available');
            }

            const device = discoveredDevices.get(deviceId);
            if (!device) {
                throw new Error('Device not found');
            }

            // Create device client
            const airplay = require('airplay-protocol') as AirPlayModule;
            const client = airplay.createDevice(device.host, device.port);

            // Play video
            await new Promise((resolve, reject) => {
                client.play(url, 0, (err) => {
                    if (err) {
                        console.error('[AirPlay] Play error:', err);
                        reject(err);
                    } else {
                        console.log('[AirPlay] Playing on device');
                        resolve(true);
                    }
                });
            });

            return {
                success: true
            };
        } catch (error: unknown) {
            console.error('[AirPlay] Cast error:', error);
            return {
                success: false,
                error: getErrorMessage(error)
            };
        }
    });

    // Stop AirPlay casting
    ipcMain.handle('airplay:stop', async (_, { deviceId }) => {
        try {
            console.log('[AirPlay] Stop requested:', deviceId);

            if (!airplayBrowser) {
                throw new Error('AirPlay not available');
            }

            const device = discoveredDevices.get(deviceId);
            if (!device) {
                throw new Error('Device not found');
            }

            const airplay = require('airplay-protocol') as AirPlayModule;
            const client = airplay.createDevice(device.host, device.port);

            await new Promise((resolve, reject) => {
                client.stop((err) => {
                    if (err) {
                        console.error('[AirPlay] Stop error:', err);
                        reject(err);
                    } else {
                        console.log('[AirPlay] Stopped successfully');
                        resolve(true);
                    }
                });
            });

            return {
                success: true
            };
        } catch (error: unknown) {
            console.error('[AirPlay] Stop error:', error);
            return {
                success: false,
                error: getErrorMessage(error)
            };
        }
    });

    console.log('[AirPlay] IPC Handlers initialized');
}
