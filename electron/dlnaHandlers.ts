// DLNA/UPnP IPC Handlers - Auto Discovery + Manual Entry
// Enhanced DLNA casting with SSDP discovery

import { ipcMain } from 'electron';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let MediaRendererClient: any = null;
let ssdp: any = null;
let discoveredDevices: Map<string, any> = new Map();
let manualDevices: any[] = [];
let isDiscovering = false;

// Initialize dependencies
try {
    MediaRendererClient = require('upnp-mediarenderer-client');
    console.log('[DLNA] upnp-mediarenderer-client loaded successfully');
} catch (error) {
    console.error('[DLNA] Failed to load upnp-mediarenderer-client:', error);
}

try {
    const SSDP = require('peer-ssdp').Peer;
    ssdp = new SSDP();
    console.log('[DLNA] SSDP peer loaded successfully');
} catch (error) {
    console.error('[DLNA] Failed to load SSDP:', error);
}

// Load saved devices from disk
function loadSavedDevices(): void {
    try {
        const fs = require('fs');
        const path = require('path');
        const { app } = require('electron');
        const savePath = path.join(app.getPath('userData'), 'dlna-devices.json');

        if (fs.existsSync(savePath)) {
            const data = fs.readFileSync(savePath, 'utf8');
            manualDevices = JSON.parse(data);
            console.log('[DLNA] Loaded', manualDevices.length, 'saved devices');
        }
    } catch (error) {
        console.error('[DLNA] Error loading saved devices:', error);
    }
}

// Save devices to disk
function saveDevices(): void {
    try {
        const fs = require('fs');
        const path = require('path');
        const { app } = require('electron');
        const savePath = path.join(app.getPath('userData'), 'dlna-devices.json');

        fs.writeFileSync(savePath, JSON.stringify(manualDevices, null, 2));
        console.log('[DLNA] Saved', manualDevices.length, 'devices');
    } catch (error) {
        console.error('[DLNA] Error saving devices:', error);
    }
}

// Discover DLNA devices using SSDP
async function discoverDevices(): Promise<any[]> {
    return new Promise((resolve) => {
        if (!ssdp || isDiscovering) {
            resolve(Array.from(discoveredDevices.values()));
            return;
        }

        isDiscovering = true;
        discoveredDevices.clear();

        try {
            ssdp.on('found', (headers: any, address: string) => {
                if (headers.ST && headers.ST.includes('MediaRenderer')) {
                    const device = {
                        id: `discovered-${address}`,
                        name: headers.SERVER || `Smart TV (${address})`,
                        host: address,
                        location: headers.LOCATION,
                        type: 'discovered',
                        online: true
                    };
                    discoveredDevices.set(device.id, device);
                    console.log('[DLNA] Found device:', device.name, 'at', address);
                }
            });

            // Search for MediaRenderer devices
            ssdp.search('urn:schemas-upnp-org:device:MediaRenderer:1');

            // Stop discovery after 5 seconds
            setTimeout(() => {
                isDiscovering = false;
                console.log('[DLNA] Discovery complete. Found', discoveredDevices.size, 'devices');
                resolve(Array.from(discoveredDevices.values()));
            }, 5000);
        } catch (error) {
            console.error('[DLNA] Discovery error:', error);
            isDiscovering = false;
            resolve([]);
        }
    });
}

export function setupDLNAHandlers() {
    // Load saved devices on startup
    loadSavedDevices();

    // Discover devices
    ipcMain.handle('dlna:discover', async () => {
        try {
            console.log('[DLNA] Starting device discovery...');
            const discovered = await discoverDevices();

            // Combine discovered and manual devices
            const allDevices = [
                ...discovered.map(d => ({ ...d, source: 'discovered' })),
                ...manualDevices.map(d => ({ ...d, source: 'manual', online: true }))
            ];

            return {
                success: true,
                devices: allDevices
            };
        } catch (error: any) {
            console.error('[DLNA] Discover error:', error);
            return {
                success: false,
                error: error.message,
                devices: manualDevices.map(d => ({ ...d, source: 'manual', online: true }))
            };
        }
    });

    // Get all devices (without discovery)
    ipcMain.handle('dlna:get-devices', async () => {
        const allDevices = [
            ...Array.from(discoveredDevices.values()).map(d => ({ ...d, source: 'discovered' })),
            ...manualDevices.map(d => ({ ...d, source: 'manual', online: true }))
        ];

        return {
            success: true,
            devices: allDevices
        };
    });

    // Add manual device
    ipcMain.handle('dlna:add-device', async (_, { name, ip, port }) => {
        try {
            console.log('[DLNA] Adding manual device:', { name, ip, port });

            const device = {
                id: `manual-${ip}-${port || 8080}`,
                name: name || `TV (${ip})`,
                host: ip,
                port: port || 8080,
                location: `http://${ip}:${port || 8080}/dmr`
            };

            // Remove duplicate if exists
            manualDevices = manualDevices.filter(d => d.id !== device.id);
            manualDevices.push(device);

            // Save to disk
            saveDevices();

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

    // Remove device
    ipcMain.handle('dlna:remove-device', async (_, { deviceId }) => {
        try {
            manualDevices = manualDevices.filter(d => d.id !== deviceId);
            saveDevices();
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Cast media to DLNA device
    ipcMain.handle('dlna:cast', async (_, { deviceId, url, title }) => {
        try {
            console.log('[DLNA] Cast requested:', { deviceId, title });

            if (!MediaRendererClient) {
                throw new Error('DLNA client not available');
            }

            // Find device (from manual or discovered)
            let device = manualDevices.find(d => d.id === deviceId);
            if (!device) {
                device = discoveredDevices.get(deviceId);
            }

            if (!device) {
                throw new Error('Device not found. Please add it first.');
            }

            const location = device.location || `http://${device.host}:${device.port || 8080}/dmr`;
            console.log('[DLNA] Connecting to:', location);

            const client = new MediaRendererClient(location);

            // Determine content type based on URL
            let contentType = 'video/mp4';
            if (url.includes('.m3u8')) {
                contentType = 'application/x-mpegURL';
            } else if (url.includes('.ts')) {
                contentType = 'video/MP2T';
            }

            const options = {
                autoplay: true,
                contentType: contentType,
                metadata: {
                    title: title || 'Video',
                    type: 'video',
                    creator: 'NeoStream IPTV'
                }
            };

            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout - Check if TV is on and DLNA is enabled'));
                }, 10000);

                client.on('error', (err: any) => {
                    clearTimeout(timeout);
                    reject(err);
                });

                client.load(url, options, (err: any) => {
                    clearTimeout(timeout);
                    if (err) {
                        console.error('[DLNA] Cast error:', err);
                        reject(err);
                    } else {
                        console.log('[DLNA] Media loaded successfully');
                        resolve(true);
                    }
                });
            });

            return { success: true };
        } catch (error: any) {
            console.error('[DLNA] Cast error:', error);
            return {
                success: false,
                error: error.message || 'Failed to cast'
            };
        }
    });

    // Stop casting
    ipcMain.handle('dlna:stop', async (_, { deviceId }) => {
        try {
            console.log('[DLNA] Stop requested:', deviceId);

            let device = manualDevices.find(d => d.id === deviceId);
            if (!device) {
                device = discoveredDevices.get(deviceId);
            }

            if (!device) {
                throw new Error('Device not found');
            }

            const location = device.location || `http://${device.host}:${device.port || 8080}/dmr`;
            const client = new MediaRendererClient(location);

            await new Promise((resolve, reject) => {
                client.stop((err: any) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(true);
                    }
                });
            });

            return { success: true };
        } catch (error: any) {
            console.error('[DLNA] Stop error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    console.log('[DLNA] IPC Handlers initialized with auto-discovery');
}
