// AirPlay IPC Handlers for Electron Main Process
// Implementation with airplay-protocol

import { ipcMain } from 'electron';
import { createRequire } from 'module';

// Create require for CommonJS modules in ES module context
const require = createRequire(import.meta.url);

let airplayBrowser: any = null;
let discoveredDevices: Map<string, any> = new Map();

// Initialize airplay
try {
    const airplay = require('airplay-protocol');
    airplayBrowser = airplay.createBrowser();
    console.log('[AirPlay] airplay-protocol loaded successfully');
} catch (error) {
    console.error('[AirPlay] Failed to load airplay-protocol:', error);
}

export function setupAirPlayHandlers() {
    // Setup device discovery if browser exists
    if (airplayBrowser) {
        airplayBrowser.on('deviceOn', (device: any) => {
            console.log('[AirPlay] Device found:', device.name);
            discoveredDevices.set(device.id, device);
        });

        airplayBrowser.on('deviceOff', (device: any) => {
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

            const devices = Array.from(discoveredDevices.values()).map((device: any) => ({
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
        } catch (error: any) {
            console.error('[AirPlay] Discovery error:', error);
            return {
                success: false,
                error: error.message,
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
            const airplay = require('airplay-protocol');
            const client = airplay.createDevice(device.host, device.port);

            // Play video
            await new Promise((resolve, reject) => {
                client.play(url, 0, (err: any) => {
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
        } catch (error: any) {
            console.error('[AirPlay] Cast error:', error);
            return {
                success: false,
                error: error.message
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

            const airplay = require('airplay-protocol');
            const client = airplay.createDevice(device.host, device.port);

            await new Promise((resolve, reject) => {
                client.stop((err: any) => {
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
        } catch (error: any) {
            console.error('[AirPlay] Stop error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    console.log('[AirPlay] IPC Handlers initialized');
}
