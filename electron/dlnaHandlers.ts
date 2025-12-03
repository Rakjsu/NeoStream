// DLNA/UPnP IPC Handlers for Electron Main Process
// Full implementation with node-upnp

import { ipcMain } from 'electron';
import { createRequire } from 'module';

// Create require for CommonJS modules in ES module context
const require = createRequire(import.meta.url);

let upnp: any = null;
let discoveredDevices: any[] = [];

// Initialize node-upnp
try {
    upnp = require('node-upnp');
    console.log('[DLNA] node-upnp loaded successfully');
} catch (error) {
    console.error('[DLNA] Failed to load node-upnp:', error);
}

export function setupDLNAHandlers() {
    // Discover DLNA devices on network
    ipcMain.handle('dlna:discover', async () => {
        try {
            console.log('[DLNA] Starting device discovery...');

            if (!upnp) {
                console.warn('[DLNA] node-upnp not available');
                return {
                    success: true,
                    devices: []
                };
            }

            // Discover UPnP/DLNA devices
            const devices = await new Promise((resolve) => {
                const foundDevices: any[] = [];

                // node-upnp is a constructor, not factory
                const client = new upnp();

                const timeout = setTimeout(() => {
                    console.log(`[DLNA] Discovery complete. Found ${foundDevices.length} devices`);
                    if (client.destroy) client.destroy();
                    resolve(foundDevices);
                }, 5000); // 5 second discovery timeout

                client.on('device', (device: any) => {
                    // Log ALL devices for debugging
                    console.log('[DLNA] Device detected:', device);

                    // Filter for Media Renderers (TVs, speakers, etc.)
                    const deviceType = device.deviceType || device.type || '';
                    const hasRenderer = deviceType.includes('MediaRenderer') || device Type.includes('MediaServer');
                    const hasFriendlyName = !!device.friendlyName;

                    if (hasRenderer || hasFriendlyName) {
                        console.log('[DLNA] Found compatible device:', {
                            name: device.friendlyName || device.name,
                            type: deviceType,
                            manufacturer: device.manufacturer
                        });

                        foundDevices.push({
                            id: device.UDN || device.usn || `dlna-${device.friendlyName}`,
                            name: device.friendlyName || device.name || 'Unknown Device',
                            host: device.location ? new URL(device.location).hostname : '',
                            port: device.location ? new URL(device.location).port || 1900 : 1900,
                            type: deviceType,
                            manufacturer: device.manufacturer,
                            model: device.modelName || device.model,
                            device: device // Store full device object
                        });
                    }
                });

                client.on('error', (err: any) => {
                    console.error('[DLNA] Discovery error:', err);
                });

                // Start discovery
                console.log('[DLNA] Searching for devices...');
                client.search('ssdp:all');
            });

            discoveredDevices = devices as any[];

            return {
                success: true,
                devices: discoveredDevices.map(d => ({
                    id: d.id,
                    name: d.name,
                    host: d.host,
                    port: d.port,
                    manufacturer: d.manufacturer,
                    model: d.model
                }))
            };
        } catch (error: any) {
            console.error('[DLNA] Discovery error:', error);
            return {
                success: false,
                error: error.message,
                devices: []
            };
        }
    });

    // Cast media to DLNA device
    ipcMain.handle('dlna:cast', async (_, { deviceId, url, title }) => {
        try {
            console.log('[DLNA] Cast requested:', { deviceId, title });

            if (!upnp) {
                throw new Error('DLNA not available');
            }

            const device = discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                throw new Error('Device not found');
            }

            // Create media renderer client
            const MediaRendererClient = require('upnp-mediarenderer-client');
            const client = new MediaRendererClient(device.device.location);

            // Load media
            const options = {
                autoplay: true,
                contentType: 'video/mp4',
                metadata: {
                    title: title,
                    type: 'video',
                    creator: 'NeoStream IPTV'
                }
            };

            await new Promise((resolve, reject) => {
                client.load(url, options, (err: any) => {
                    if (err) {
                        console.error('[DLNA] Cast error:', err);
                        reject(err);
                    } else {
                        console.log('[DLNA] Media loaded successfully');
                        resolve(true);
                    }
                });
            });

            return {
                success: true
            };
        } catch (error: any) {
            console.error('[DLNA] Cast error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    // Stop casting to DLNA device
    ipcMain.handle('dlna:stop', async (_, { deviceId }) => {
        try {
            console.log('[DLNA] Stop requested:', deviceId);

            if (!upnp) {
                throw new Error('DLNA not available');
            }

            const device = discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                throw new Error('Device not found');
            }

            const MediaRendererClient = require('upnp-mediarenderer-client');
            const client = new MediaRendererClient(device.device.location);

            await new Promise((resolve, reject) => {
                client.stop((err: any) => {
                    if (err) {
                        console.error('[DLNA] Stop error:', err);
                        reject(err);
                    } else {
                        console.log('[DLNA] Stopped successfully');
                        resolve(true);
                    }
                });
            });

            return {
                success: true
            };
        } catch (error: any) {
            console.error('[DLNA] Stop error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    console.log('[DLNA] IPC Handlers initialized with node-upnp');
}
