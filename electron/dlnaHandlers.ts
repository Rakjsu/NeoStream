// DLNA/UPnP IPC Handlers - Manual Device Entry
// Reliable DLNA casting without discovery issues

import { ipcMain } from 'electron';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let MediaRendererClient: any = null;
let manualDevices: any[] = [];

// Initialize upnp-mediarenderer-client
try {
    MediaRendererClient = require('upnp-mediarenderer-client');
    console.log('[DLNA] upnp-mediarenderer-client loaded successfully');
} catch (error) {
    console.error('[DLNA] Failed to load upnp-mediarenderer-client:', error);
}

export function setupDLNAHandlers() {
    // Add manual device
    ipcMain.handle('dlna:add-device', async (_, { name, ip, port }) => {
        try {
            console.log('[DLNA] Adding manual device:', { name, ip, port });

            const device = {
                id: `manual-${ip}`,
                name: name || `TV (${ip})`,
                host: ip,
                port: port || 8080,
                location: `http://${ip}:${port || 8080}/dmr`
            };

            // Test connection
            if (MediaRendererClient) {
                try {
                    const client = new MediaRendererClient(device.location);
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 3000);
                        client.on('connected', () => {
                            clearTimeout(timeout);
                            console.log('[DLNA] Device connected successfully');
                            resolve(true);
                        });
                        client.on('error', (err: any) => {
                            clearTimeout(timeout);
                            reject(err);
                        });
                    });
                } catch (err) {
                    console.warn('[DLNA] Connection test failed, but adding anyway:', err);
                }
            }

            // Add to list
            manualDevices = manualDevices.filter(d => d.id !== device.id);
            manualDevices.push(device);

            // Save to localStorage via renderer
            return {
                success: true,
                device: {
                    id: device.id,
                    name: device.name,
                    host: device.host,
                    port: device.port
                }
            };
        } catch (error: any) {
            console.error('[DLNA] Add device error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    // Get manual devices
    ipcMain.handle('dlna:get-devices', async () => {
        return {
            success: true,
            devices: manualDevices.map(d => ({
                id: d.id,
                name: d.name,
                host: d.host,
                port: d.port
            }))
        };
    });

    // Cast media to DLNA device
    ipcMain.handle('dlna:cast', async (_, { deviceId, url, title }) => {
        try {
            console.log('[DLNA] Cast requested:', { deviceId, title });

            if (!MediaRendererClient) {
                throw new Error('DLNA not available');
            }

            const device = manualDevices.find(d => d.id === deviceId);
            if (!device) {
                throw new Error('Device not found. Please add it first.');
            }

            console.log('[DLNA] Connecting to:', device.location);
            const client = new MediaRendererClient(device.location);

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

    // Stop casting
    ipcMain.handle('dlna:stop', async (_, { deviceId }) => {
        try {
            console.log('[DLNA] Stop requested:', deviceId);

            const device = manualDevices.find(d => d.id === deviceId);
            if (!device) {
                throw new Error('Device not found');
            }

            const client = new MediaRendererClient(device.location);

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

    console.log('[DLNA] IPC Handlers initialized (manual entry mode)');
}
