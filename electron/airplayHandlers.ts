// AirPlay IPC Handlers for Electron Main Process
// Implementation with airplay-protocol

import { ipcMain } from 'electron';
import { createRequire } from 'module';

import log from './logger'
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
    log.info('[AirPlay] airplay-protocol loaded successfully');
} catch (error) {
    log.error('[AirPlay] Failed to load airplay-protocol:', error);
}

export function setupAirPlayHandlers() {
    // Setup device discovery if browser exists
    if (airplayBrowser) {
        airplayBrowser.on('deviceOn', (device) => {
            log.info('[AirPlay] Device found:', device.name);
            discoveredDevices.set(device.id, device);
        });

        airplayBrowser.on('deviceOff', (device) => {
            log.info('[AirPlay] Device offline:', device.name);
            discoveredDevices.delete(device.id);
        });

        airplayBrowser.start();
    }

    // Discover AirPlay devices
    ipcMain.handle('airplay:discover', async () => {
        try {
            log.info('[AirPlay] Discovery requested');

            if (!airplayBrowser) {
                log.warn('[AirPlay] AirPlay not available');
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

            log.info(`[AirPlay] Found ${devices.length} devices`);

            return {
                success: true,
                devices
            };
        } catch (error: unknown) {
            log.error('[AirPlay] Discovery error:', error);
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
            log.info('[AirPlay] Cast requested:', { deviceId, title });

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
                        log.error('[AirPlay] Play error:', err);
                        reject(err);
                    } else {
                        log.info('[AirPlay] Playing on device');
                        resolve(true);
                    }
                });
            });

            return {
                success: true
            };
        } catch (error: unknown) {
            log.error('[AirPlay] Cast error:', error);
            return {
                success: false,
                error: getErrorMessage(error)
            };
        }
    });

    // Stop AirPlay casting
    ipcMain.handle('airplay:stop', async (_, { deviceId }) => {
        try {
            log.info('[AirPlay] Stop requested:', deviceId);

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
                        log.error('[AirPlay] Stop error:', err);
                        reject(err);
                    } else {
                        log.info('[AirPlay] Stopped successfully');
                        resolve(true);
                    }
                });
            });

            return {
                success: true
            };
        } catch (error: unknown) {
            log.error('[AirPlay] Stop error:', error);
            return {
                success: false,
                error: getErrorMessage(error)
            };
        }
    });

    log.info('[AirPlay] IPC Handlers initialized');
}
