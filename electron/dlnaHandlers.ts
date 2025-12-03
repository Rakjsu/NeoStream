// DLNA/UPnP IPC Handlers for Electron Main Process
// Using peer-ssdp for better device discovery

import { ipcMain } from 'electron';
import { createRequire } from 'module';

// Create require for CommonJS modules in ES module context
const require = createRequire(import.meta.url);

let ssdp: any = null;
let discoveredDevices: any[] = [];

// Initialize peer-ssdp
try {
    const { Peer } = require('peer-ssdp');
    ssdp = new Peer();
    console.log('[DLNA] peer-ssdp loaded successfully');

    // Start listening for devices
    ssdp.on('found', (device: any) => {
        console.log('[DLNA] Device found via SSDP:', {
            name: device.headers?.SERVER || device.headers?.['X-User-Agent'] || 'Unknown',
            location: device.headers?.LOCATION,
            usn: device.headers?.USN
        });
    });

    ssdp.start();
} catch (error) {
    console.error('[DLNA] Failed to load peer-ssdp:', error);
}

export function setupDLNAHandlers() {
    // Discover DLNA devices on network
    ipcMain.handle('dlna:discover', async () => {
        try {
            console.log('[DLNA] Starting device discovery with peer-ssdp...');

            if (!ssdp) {
                console.warn('[DLNA] SSDP not available');
                return {
                    success: true,
                    devices: []
                };
            }

            // Clear previous devices
            discoveredDevices = [];

            // Search for UPnP devices
            return new Promise((resolve) => {
                const foundDevices: any[] = [];

                const deviceListener = (headers: any, address: any) => {
                    console.log('[DLNA] Device discovered:', {
                        headers,
                        address
                    });

                    const location = headers.LOCATION || headers.location;
                    if (!location) return;

                    const name = headers.SERVER || headers['X-User-Agent'] || headers.server || 'Unknown Device';
                    const usn = headers.USN || headers.usn;

                    // Check if it's a media device
                    const st = headers.ST || headers.st || '';
                    const isMediaDevice = st.includes('MediaRenderer') ||
                        st.includes('MediaServer') ||
                        name.toLowerCase().includes('samsung') ||
                        name.toLowerCase().includes('tv');

                    if (isMediaDevice || location) {
                        console.log('[DLNA] Found compatible device:', {
                            name,
                            location,
                            type: st
                        });

                        const device = {
                            id: usn || `dlna-${Date.now()}`,
                            name: name,
                            host: location ? new URL(location).hostname : address.address,
                            port: location ? new URL(location).port || 1900 : 1900,
                            location: location,
                            type: st,
                            headers: headers
                        };

                        // Avoid duplicates
                        if (!foundDevices.find(d => d.id === device.id)) {
                            foundDevices.push(device);
                        }
                    }
                };

                ssdp.on('found', deviceListener);

                // Search for all SSDP devices
                console.log('[DLNA] Searching for ssdp:all...');
                ssdp.search({
                    ST: 'ssdp:all'
                });

                // Also search specifically for media renderers
                setTimeout(() => {
                    console.log('[DLNA] Searching for MediaRenderer...');
                    ssdp.search({
                        ST: 'urn:schemas-upnp-org:device:MediaRenderer:1'
                    });
                }, 1000);

                // Complete after 6 seconds
                setTimeout(() => {
                    ssdp.removeListener('found', deviceListener);
                    discoveredDevices = foundDevices;
                    console.log(`[DLNA] Discovery complete. Found ${foundDevices.length} devices`);

                    resolve({
                        success: true,
                        devices: foundDevices.map(d => ({
                            id: d.id,
                            name: d.name,
                            host: d.host,
                            port: d.port
                        }))
                    });
                }, 6000);
            });
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

            const device = discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                throw new Error('Device not found');
            }

            // Create media renderer client
            const MediaRendererClient = require('upnp-mediarenderer-client');
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

    // Stop casting to DLNA device
    ipcMain.handle('dlna:stop', async (_, { deviceId }) => {
        try {
            console.log('[DLNA] Stop requested:', deviceId);

            const device = discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                throw new Error('Device not found');
            }

            const MediaRendererClient = require('upnp-mediarenderer-client');
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

    console.log('[DLNA] IPC Handlers initialized with peer-ssdp');
}
