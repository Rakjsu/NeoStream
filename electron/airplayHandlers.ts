// AirPlay IPC Handlers for Electron Main Process
//
// Discovery: bonjour-service (mDNS browse of _airplay._tcp / _raop._tcp).
// Playback: the AirPlay video HTTP protocol is a tiny plain-HTTP API on
// port 7000 (POST /play with Content-Location, POST /stop), so we talk to
// it directly with node:http instead of pulling in the abandoned
// airplay-protocol package (whose dependency chain carried unfixable
// lodash/xmldom CVEs — and whose v2 API didn't even match the
// createBrowser/createDevice calls the previous code made).

import { ipcMain } from 'electron';
import http from 'http';
import { Bonjour, type Browser, type Service } from 'bonjour-service';

import log from './logger'
import { planAirplayCommand, parseScrub, type AirplayStatusRaw } from './airplayRemoteRouting';
import { isLoopbackUrl, createLanProxyUrlFor } from './dlnaHandlers'

interface AirPlayDevice {
    id: string
    name?: string
    host: string
    port?: number
    model?: string
    features?: unknown
}

const AIRPLAY_DEFAULT_PORT = 7000;

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

let bonjour: Bonjour | null = null;
let airplayBrowser: Browser | null = null;
const discoveredDevices: Map<string, AirPlayDevice> = new Map();

function serviceToDevice(service: Service): AirPlayDevice | null {
    const host = service.addresses?.find(addr => addr.includes('.')) // prefer IPv4
        || service.addresses?.[0]
        || service.host;
    if (!host) return null;

    const txt = (service.txt || {}) as Record<string, string>;
    return {
        id: service.fqdn || `${host}:${service.port}`,
        name: service.name,
        host,
        port: service.port || AIRPLAY_DEFAULT_PORT,
        model: txt.model || txt.am || 'Unknown',
        features: txt.features
    };
}

// Minimal AirPlay video client: plain HTTP POST against the device.
function airplayRequest(
    device: AirPlayDevice,
    path: string,
    body?: string,
    contentType = 'text/parameters'
): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = http.request({
            host: device.host,
            port: device.port || AIRPLAY_DEFAULT_PORT,
            method: 'POST',
            path,
            timeout: 10000,
            headers: {
                'User-Agent': 'MediaControl/1.0',
                'Content-Type': contentType,
                'Content-Length': Buffer.byteLength(body || '')
            }
        }, (response) => {
            // Drain so the socket can close cleanly.
            response.resume();
            if (response.statusCode && response.statusCode < 300) {
                resolve();
            } else {
                reject(new Error(`AirPlay device responded ${response.statusCode} for ${path}`));
            }
        });

        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error('AirPlay request timeout'));
        });
        request.end(body || '');
    });
}

export function setupAirPlayHandlers() {
    try {
        bonjour = new Bonjour();
        airplayBrowser = bonjour.find({ type: 'airplay', protocol: 'tcp' });

        airplayBrowser.on('up', (service: Service) => {
            const device = serviceToDevice(service);
            if (device) {
                log.info('[AirPlay] Device found:', device.name, device.host);
                discoveredDevices.set(device.id, device);
            }
        });

        airplayBrowser.on('down', (service: Service) => {
            const device = serviceToDevice(service);
            if (device) {
                log.info('[AirPlay] Device offline:', device.name);
                discoveredDevices.delete(device.id);
            }
        });

        log.info('[AirPlay] mDNS discovery started (bonjour-service)');
    } catch (error) {
        log.error('[AirPlay] Failed to start mDNS discovery:', error);
    }

    // Discover AirPlay devices
    ipcMain.handle('airplay:discover', async () => {
        try {
            log.info('[AirPlay] Discovery requested');

            if (!airplayBrowser) {
                log.warn('[AirPlay] AirPlay not available');
                return { success: true, devices: [] };
            }

            // Nudge mDNS and give responses a moment to arrive.
            airplayBrowser.update();
            await new Promise(resolve => setTimeout(resolve, 2000));

            const devices = Array.from(discoveredDevices.values()).map((device) => ({
                id: device.id,
                name: device.name || 'AirPlay Device',
                host: device.host,
                port: device.port || AIRPLAY_DEFAULT_PORT,
                model: device.model || 'Unknown',
                features: device.features
            }));

            log.info(`[AirPlay] Found ${devices.length} devices`);

            return { success: true, devices };
        } catch (error: unknown) {
            log.error('[AirPlay] Discovery error:', error);
            return { success: false, error: getErrorMessage(error), devices: [] };
        }
    });

    // Cast media to AirPlay device
    ipcMain.handle('airplay:cast', async (_, { deviceId, url, title }) => {
        try {
            log.info('[AirPlay] Cast requested:', { deviceId, title });

            const device = discoveredDevices.get(deviceId);
            if (!device) {
                throw new Error('Device not found');
            }

            // Loopback sources (rescue transcode) ride the DLNA LAN proxy.
            if (typeof url === 'string' && isLoopbackUrl(url)) {
                url = await createLanProxyUrlFor(url, device.host);
            }

            await airplayRequest(
                device,
                '/play',
                `Content-Location: ${url}\nStart-Position: 0\n`
            );
            log.info('[AirPlay] Playing on device');
            // Track the session so the phone remote can drive this device.
            airplaySession = { device, title: String(title ?? ''), playing: true };

            return { success: true };
        } catch (error: unknown) {
            log.error('[AirPlay] Cast error:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });

    // Stop AirPlay casting
    ipcMain.handle('airplay:stop', async (_, { deviceId }) => {
        try {
            log.info('[AirPlay] Stop requested:', deviceId);

            const device = discoveredDevices.get(deviceId);
            if (!device) {
                throw new Error('Device not found');
            }

            await airplayRequest(device, '/stop');
            log.info('[AirPlay] Stopped successfully');
            if (airplaySession?.device.id === deviceId) airplaySession = null;

            return { success: true };
        } catch (error: unknown) {
            log.error('[AirPlay] Stop error:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });

    log.info('[AirPlay] IPC Handlers initialized');
}

// ===== Phone-remote transport for the active AirPlay session =================
// Third routing layer after Chromecast and DLNA. The protocol has no volume
// control (RAOP-only), so those actions fall through untouched.

let airplaySession: { device: AirPlayDevice; title: string; playing: boolean } | null = null;

export function isAirplaySessionActive(): boolean {
    return airplaySession !== null;
}

/**
 * Snapshot for the phone remote's state broadcast — position/duration come
 * from GET /scrub; null when no session or the device stopped answering.
 */
export async function getAirplayStatusSnapshot(): Promise<AirplayStatusRaw | null> {
    const session = airplaySession;
    if (!session) return null;
    try {
        const scrub = parseScrub(await airplayGet(session.device, '/scrub'));
        return {
            position: scrub.position,
            duration: scrub.duration,
            playing: session.playing,
            title: session.title,
            deviceName: session.device.name || '',
        };
    } catch {
        return null;
    }
}

/** GET on the AirPlay control port, returning the response body. */
function airplayGet(device: AirPlayDevice, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const request = http.request({
            host: device.host,
            port: device.port || AIRPLAY_DEFAULT_PORT,
            method: 'GET',
            path,
            timeout: 10000,
            headers: { 'User-Agent': 'MediaControl/1.0' },
        }, (response) => {
            let body = '';
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                if (response.statusCode && response.statusCode < 300) resolve(body);
                else reject(new Error(`AirPlay device responded ${response.statusCode} for ${path}`));
            });
        });
        request.on('error', reject);
        request.on('timeout', () => { request.destroy(); reject(new Error('AirPlay request timeout')); });
        request.end();
    });
}

/**
 * Route a phone-remote transport command to the active AirPlay session.
 * Returns true when consumed (HTTP runs in the background); false falls
 * through to the renderer.
 */
export function airplayRemoteControl(action: string, value?: number): boolean {
    const session = airplaySession;
    if (!session) return false;
    const plan = planAirplayCommand(action, value, session.playing);
    if (!plan) return false;

    const run = async () => {
        switch (plan.kind) {
            case 'rate':
                await airplayRequest(session.device, `/rate?value=${plan.value.toFixed(6)}`);
                session.playing = plan.value === 1;
                return;
            case 'seekRelative': {
                const scrub = parseScrub(await airplayGet(session.device, '/scrub'));
                const target = Math.max(0, scrub.position + plan.seconds);
                await airplayRequest(session.device, `/scrub?position=${target.toFixed(3)}`);
                return;
            }
            case 'stop':
                await airplayRequest(session.device, '/stop');
                airplaySession = null;
                return;
            case 'noop':
                return;
        }
    };
    void run().catch((error: unknown) => log.warn('[AirPlay] comando do controle web falhou:', getErrorMessage(error)));
    return true;
}
