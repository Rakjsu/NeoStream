// DLNA/UPnP IPC Handlers - Auto Discovery + Manual Entry
// Enhanced DLNA casting with SSDP discovery

import { ipcMain } from 'electron';
import { createRequire } from 'module';
import dgram from 'dgram';
import http from 'http';
import os from 'os';
import { randomUUID } from 'crypto';
import { getProviderHttpsAgent } from './certificatePolicy';

const require = createRequire(import.meta.url);

interface DlnaDevice {
    id: string
    name: string
    host: string
    port?: number
    location?: string
    type?: string
    manufacturer?: string
    modelName?: string
    isSamsung?: boolean
    online?: boolean
    source?: string
}

interface SsdpHeaders {
    ST?: string
    USN?: string
    SERVER?: string
    LOCATION?: string
    st?: string
    usn?: string
    server?: string
    location?: string
}

interface SsdpPeer {
    on(event: 'found', callback: (headers: SsdpHeaders, address: string) => void): void
    search(target: string): void
}

interface NativeSsdpResponse {
    headers: SsdpHeaders
    address: string
}

interface MediaRendererClientInstance {
    on(event: 'error', callback: (error: Error) => void): void
    load(url: string, options: unknown, callback: (error?: Error | null) => void): void
    stop(callback: (error?: Error | null) => void): void
}

type MediaRendererClientConstructor = new (location: string) => MediaRendererClientInstance;

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

let MediaRendererClient: MediaRendererClientConstructor | null = null;
let ssdp: SsdpPeer | null = null;
const discoveredDevices: Map<string, DlnaDevice> = new Map();
let manualDevices: DlnaDevice[] = [];
let isDiscovering = false;
let ssdpListenerRegistered = false;
let proxyServer: http.Server | null = null;
let proxyPort: number | null = null;
// token -> upstream URL, with creation time so stale entries can be pruned.
// Entries are NOT removed on first read (devices re-request playlists/segments
// repeatedly during a cast session), so without pruning this grows unbounded.
const proxyUrls: Map<string, { url: string; createdAt: number }> = new Map();
const PROXY_URL_TTL_MS = 60 * 60 * 1000; // 1 hour
const PROXY_URL_MAX_ENTRIES = 5000;

function pruneProxyUrls(): void {
    const now = Date.now()
    for (const [token, entry] of proxyUrls) {
        if (now - entry.createdAt > PROXY_URL_TTL_MS) proxyUrls.delete(token)
    }
    // Safety valve: drop oldest entries if a long session rewrites huge playlists.
    if (proxyUrls.size > PROXY_URL_MAX_ENTRIES) {
        const excess = proxyUrls.size - PROXY_URL_MAX_ENTRIES
        let removed = 0
        for (const token of proxyUrls.keys()) {
            proxyUrls.delete(token)
            if (++removed >= excess) break
        }
    }
}

function getLocalAddressForDevice(deviceHost: string): string {
    const normalizedDeviceHost = normalizeHost(deviceHost)
    const interfaces = os.networkInterfaces()
    const candidates = Object.values(interfaces)
        .flat()
        .filter((address): address is os.NetworkInterfaceInfo =>
            Boolean(address) && address.family === 'IPv4' && !address.internal
        )

    const deviceParts = normalizedDeviceHost.split('.')
    if (deviceParts.length === 4) {
        const sameSubnet = candidates.find((address) => {
            const addressParts = address.address.split('.')
            return addressParts[0] === deviceParts[0] &&
                addressParts[1] === deviceParts[1] &&
                addressParts[2] === deviceParts[2]
        })

        if (sameSubnet) return sameSubnet.address
    }

    return candidates[0]?.address || '127.0.0.1'
}

function getMimeForUrl(url: string, fallback?: string | null): string {
    const cleanUrl = url.split('?')[0].toLowerCase()
    if (cleanUrl.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
    if (cleanUrl.endsWith('.ts')) return 'video/MP2T'
    if (cleanUrl.endsWith('.mp4')) return 'video/mp4'
    if (cleanUrl.endsWith('.mkv')) return 'video/x-matroska'
    if (cleanUrl.endsWith('.avi')) return 'video/x-msvideo'
    if (cleanUrl.endsWith('.m4s')) return 'video/iso.segment'
    if (cleanUrl.endsWith('.aac')) return 'audio/aac'
    if (cleanUrl.endsWith('.vtt')) return 'text/vtt'
    return fallback || 'video/mp4'
}

function toAbsoluteUrl(uri: string, baseUrl: string): string {
    try {
        return new URL(uri, baseUrl).toString()
    } catch {
        return uri
    }
}

function createProxyUrl(upstreamUrl: string, deviceHost: string): string {
    const token = randomUUID()
    pruneProxyUrls()
    proxyUrls.set(token, { url: upstreamUrl, createdAt: Date.now() })
    return `http://${getLocalAddressForDevice(deviceHost)}:${proxyPort}/dlna-proxy/${token}?deviceHost=${encodeURIComponent(deviceHost)}`
}

function rewritePlaylist(playlist: string, baseUrl: string, deviceHost: string): string {
    return playlist.split(/\r?\n/).map((line) => {
        const trimmed = line.trim()
        if (!trimmed) return line

        if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
                const absoluteUrl = toAbsoluteUrl(uri, baseUrl)
                return `URI="${createProxyUrl(absoluteUrl, deviceHost)}"`
            })
        }

        return createProxyUrl(toAbsoluteUrl(trimmed, baseUrl), deviceHost)
    }).join('\n')
}

async function fetchUpstream(url: string, range?: string) {
    const fetch = (await import('node-fetch')).default
    return fetch(url, {
        agent: getProviderHttpsAgent(url),
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            ...(range ? { Range: range } : {})
        }
    })
}

async function ensureProxyServer(): Promise<number> {
    if (proxyServer && proxyPort) return proxyPort

    proxyServer = http.createServer(async (request, response) => {
        try {
            const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
            const token = requestUrl.pathname.replace('/dlna-proxy/', '')
            const upstreamUrl = proxyUrls.get(token)?.url

            if (!upstreamUrl) {
                response.writeHead(404)
                response.end('Not found')
                return
            }

            const upstreamResponse = await fetchUpstream(upstreamUrl, request.headers.range)
            if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
                response.writeHead(upstreamResponse.status)
                response.end(await upstreamResponse.text())
                return
            }

            const contentType = upstreamResponse.headers.get('content-type')
            if (upstreamUrl.includes('.m3u8') || contentType?.includes('mpegurl') || contentType?.includes('vnd.apple')) {
                const deviceHost = requestUrl.searchParams.get('deviceHost') || request.headers.host?.split(':')[0] || ''
                const playlist = await upstreamResponse.text()
                const rewritten = rewritePlaylist(playlist, upstreamUrl, deviceHost)
                response.writeHead(200, {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Access-Control-Allow-Origin': '*'
                })
                response.end(rewritten)
                return
            }

            response.writeHead(upstreamResponse.status, {
                'Content-Type': getMimeForUrl(upstreamUrl, contentType),
                'Content-Length': upstreamResponse.headers.get('content-length') || undefined,
                'Content-Range': upstreamResponse.headers.get('content-range') || undefined,
                'Accept-Ranges': upstreamResponse.headers.get('accept-ranges') || 'bytes',
                'Access-Control-Allow-Origin': '*'
            })
            if (upstreamResponse.body) {
                // If the upstream stream dies mid-transfer the headers are already
                // sent — just tear the socket down instead of writeHead-ing again.
                upstreamResponse.body.on('error', (error: Error) => {
                    console.warn('[DLNA] Proxy upstream stream error:', error.message)
                    response.destroy()
                })
                response.on('close', () => {
                    // Device hung up; stop pulling from upstream.
                    upstreamResponse.body?.destroy?.()
                })
                upstreamResponse.body.pipe(response)
            } else {
                response.end()
            }
        } catch (error) {
            if (response.headersSent) {
                response.destroy()
            } else {
                response.writeHead(500)
                response.end(getErrorMessage(error))
            }
        }
    })

    await new Promise<void>((resolve, reject) => {
        proxyServer?.once('error', reject)
        proxyServer?.listen(0, '0.0.0.0', () => resolve())
    })

    const address = proxyServer.address()
    if (typeof address === 'object' && address?.port) {
        proxyPort = address.port
        console.log('[DLNA] Local media proxy started on port', proxyPort)
        return proxyPort
    }

    throw new Error('Failed to start DLNA media proxy')
}

// Initialize dependencies
try {
    MediaRendererClient = require('upnp-mediarenderer-client') as MediaRendererClientConstructor;
    console.log('[DLNA] upnp-mediarenderer-client loaded successfully');
} catch (error) {
    console.error('[DLNA] Failed to load upnp-mediarenderer-client:', error);
}

try {
    const SSDP = require('peer-ssdp').Peer as new () => SsdpPeer;
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

function getHeader(headers: SsdpHeaders, key: 'ST' | 'USN' | 'SERVER' | 'LOCATION'): string | undefined {
    const lowerKey = key.toLowerCase() as keyof SsdpHeaders
    return headers[key] || headers[lowerKey]
}

function normalizeHost(host: string): string {
    return host.replace(/^\[|\]$/g, '').toLowerCase()
}

function getDeviceId(host: string, location?: string, usn?: string): string {
    if (usn) return `discovered-${usn.replace(/[^a-z0-9-:.]/gi, '-')}`
    if (location) return `discovered-${location.replace(/[^a-z0-9-:.]/gi, '-')}`
    return `discovered-${normalizeHost(host)}`
}

function getHostFromLocation(location?: string): string | null {
    if (!location) return null
    try {
        return normalizeHost(new URL(location).hostname)
    } catch {
        return null
    }
}

function getPortFromLocation(location?: string): number | undefined {
    if (!location) return undefined
    try {
        const parsed = new URL(location)
        return parsed.port ? Number(parsed.port) : undefined
    } catch {
        return undefined
    }
}

function getXmlTagValue(xml: string, tag: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'))
    return match?.[1]?.trim()
}

function looksLikeMediaRenderer(headers: SsdpHeaders): boolean {
    const target = `${getHeader(headers, 'ST') || ''} ${getHeader(headers, 'USN') || ''}`.toLowerCase()
    return target.includes('mediarenderer') || target.includes('avtransport') || target.includes('renderingcontrol')
}

function parseSsdpMessage(message: string): SsdpHeaders {
    return message.split(/\r?\n/).reduce<SsdpHeaders>((headers, line) => {
        const separatorIndex = line.indexOf(':')
        if (separatorIndex <= 0) return headers

        const key = line.slice(0, separatorIndex).trim().toUpperCase()
        const value = line.slice(separatorIndex + 1).trim()

        if (key === 'ST' || key === 'USN' || key === 'SERVER' || key === 'LOCATION') {
            headers[key] = value
        }

        return headers
    }, {})
}

function createSearchMessage(target: string): string {
    return [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 3',
        `ST: ${target}`,
        '',
        ''
    ].join('\r\n')
}

async function nativeSsdpSearch(targets: string[], timeoutMs = 5000): Promise<NativeSsdpResponse[]> {
    return new Promise((resolve) => {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
        const responses = new Map<string, NativeSsdpResponse>()
        let settled = false

        const finish = () => {
            if (settled) return
            settled = true
            try {
                socket.close()
            } catch {
                // Socket may already be closed.
            }
            resolve(Array.from(responses.values()))
        }

        socket.on('message', (buffer, remote) => {
            const headers = parseSsdpMessage(buffer.toString('utf8'))
            if (!looksLikeMediaRenderer(headers)) return

            const location = getHeader(headers, 'LOCATION')
            const usn = getHeader(headers, 'USN')
            const key = location || usn || `${remote.address}:${remote.port}`
            responses.set(key, {
                headers,
                address: remote.address
            })
        })

        socket.on('error', (error) => {
            console.warn('[DLNA] Native SSDP error:', getErrorMessage(error))
            finish()
        })

        socket.bind(0, '0.0.0.0', () => {
            try {
                socket.setBroadcast(true)
                socket.setMulticastTTL(4)
            } catch {
                // Some network adapters do not allow multicast options.
            }

            for (const target of targets) {
                const message = Buffer.from(createSearchMessage(target))
                socket.send(message, 0, message.length, 1900, '239.255.255.250')
                socket.send(message, 0, message.length, 1900, '255.255.255.255')
            }
        })

        setTimeout(finish, timeoutMs)
    })
}

function isSamsungDevice(device: Partial<DlnaDevice>, server?: string): boolean {
    return [device.name, device.manufacturer, device.modelName, server]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes('samsung'))
}

function createDiscoveredDevice(headers: SsdpHeaders, address: string): DlnaDevice {
    const location = getHeader(headers, 'LOCATION')
    const server = getHeader(headers, 'SERVER')
    const usn = getHeader(headers, 'USN')
    const host = getHostFromLocation(location) || normalizeHost(address)

    return {
        id: getDeviceId(host, location, usn),
        name: server || `Smart TV (${host})`,
        host,
        port: getPortFromLocation(location),
        location,
        type: 'discovered',
        online: true,
        isSamsung: isSamsungDevice({ name: server }, server)
    }
}

async function enrichDeviceFromDescription(device: DlnaDevice, server?: string): Promise<DlnaDevice> {
    if (!device.location) {
        return {
            ...device,
            isSamsung: isSamsungDevice(device, server)
        }
    }

    try {
        const fetch = (await import('node-fetch')).default
        const response = await fetch(device.location, {
            headers: {
                'User-Agent': 'NeoStream IPTV DLNA/1.0'
            }
        })

        if (!response.ok) {
            return {
                ...device,
                isSamsung: isSamsungDevice(device, server)
            }
        }

        const xml = await response.text()
        const friendlyName = getXmlTagValue(xml, 'friendlyName')
        const manufacturer = getXmlTagValue(xml, 'manufacturer')
        const modelName = getXmlTagValue(xml, 'modelName')
        const enriched = {
            ...device,
            name: friendlyName || device.name,
            manufacturer,
            modelName
        }

        return {
            ...enriched,
            isSamsung: isSamsungDevice(enriched, server)
        }
    } catch {
        return {
            ...device,
            isSamsung: isSamsungDevice(device, server)
        }
    }
}

function upsertDiscoveredDevice(device: DlnaDevice) {
    const locationHost = getHostFromLocation(device.location)
    const duplicate = Array.from(discoveredDevices.entries()).find(([, existing]) =>
        existing.location === device.location ||
        normalizeHost(existing.host) === normalizeHost(device.host) ||
        (locationHost && normalizeHost(existing.host) === locationHost)
    )

    if (duplicate) {
        discoveredDevices.set(duplicate[0], {
            ...duplicate[1],
            ...device,
            id: duplicate[1].id,
            name: device.name || duplicate[1].name,
            location: device.location || duplicate[1].location,
            port: device.port || duplicate[1].port
        })
        return
    }

    discoveredDevices.set(device.id, device)
}

async function resolveManualLocation(ip: string, port?: number): Promise<{ location: string; port: number; isSamsung?: boolean }> {
    const normalizedIp = normalizeHost(ip)
    const candidatePorts = Array.from(new Set([port, 9197, 7676, 8001, 8080].filter(Boolean))) as number[]
    const candidatePaths = ['/dmr', '/description.xml', '/DeviceDescription.xml', '/rootDesc.xml']

    for (const candidatePort of candidatePorts) {
        for (const path of candidatePaths) {
            const location = `http://${normalizedIp}:${candidatePort}${path}`
            const enriched = await enrichDeviceFromDescription({
                id: `manual-${normalizedIp}-${candidatePort}`,
                name: `TV (${normalizedIp})`,
                host: normalizedIp,
                port: candidatePort,
                location
            })

            if (enriched.manufacturer || enriched.modelName || enriched.name !== `TV (${normalizedIp})`) {
                return {
                    location,
                    port: candidatePort,
                    isSamsung: enriched.isSamsung
                }
            }
        }
    }

    const fallbackPort = port || 9197
    return {
        location: `http://${normalizedIp}:${fallbackPort}/dmr`,
        port: fallbackPort
    }
}

// Discover DLNA devices using SSDP
async function discoverDevices(): Promise<DlnaDevice[]> {
    return new Promise((resolve) => {
        if (!ssdp || isDiscovering) {
            resolve(Array.from(discoveredDevices.values()));
            return;
        }

        isDiscovering = true;
        discoveredDevices.clear();

        try {
            const searchTargets = [
                'urn:schemas-upnp-org:device:MediaRenderer:1',
                'urn:schemas-upnp-org:service:AVTransport:1',
                'urn:schemas-upnp-org:service:RenderingControl:1',
                'ssdp:all'
            ]

            if (!ssdpListenerRegistered) {
                ssdp.on('found', (headers, address) => {
                    if (!looksLikeMediaRenderer(headers)) return

                    const server = getHeader(headers, 'SERVER')
                    const device = createDiscoveredDevice(headers, address)

                    upsertDiscoveredDevice(device)
                    void enrichDeviceFromDescription(device, server).then(upsertDiscoveredDevice)
                    console.log('[DLNA] Found device:', device.name, 'at', device.host);
                });
                ssdpListenerRegistered = true
            }

            searchTargets.forEach((target) => ssdp?.search(target));

            void nativeSsdpSearch(searchTargets).then((responses) => {
                responses.forEach(({ headers, address }) => {
                    const server = getHeader(headers, 'SERVER')
                    const device = createDiscoveredDevice(headers, address)
                    upsertDiscoveredDevice(device)
                    void enrichDeviceFromDescription(device, server).then(upsertDiscoveredDevice)
                    console.log('[DLNA] Native SSDP found device:', device.name, 'at', device.host)
                })
            })

            // Stop discovery after 5 seconds
            setTimeout(async () => {
                await Promise.all(Array.from(discoveredDevices.values()).map((device) =>
                    enrichDeviceFromDescription(device).then(upsertDiscoveredDevice)
                ))
                isDiscovering = false;
                console.log('[DLNA] Discovery complete. Found', discoveredDevices.size, 'devices');
                resolve(Array.from(discoveredDevices.values()));
            }, 7000);
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
        } catch (error: unknown) {
            console.error('[DLNA] Discover error:', error);
            return {
                success: false,
                error: getErrorMessage(error),
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
            const resolved = await resolveManualLocation(ip, port)

            const device = {
                id: `manual-${ip}-${resolved.port}`,
                name: name || (resolved.isSamsung ? `Samsung TV (${ip})` : `TV (${ip})`),
                host: ip,
                port: resolved.port,
                location: resolved.location,
                isSamsung: resolved.isSamsung
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
                    port: device.port,
                    location: device.location,
                    isSamsung: device.isSamsung
                }
            };
        } catch (error: unknown) {
            console.error('[DLNA] Add device error:', error);
            return {
                success: false,
                error: getErrorMessage(error)
            };
        }
    });

    // Remove device
    ipcMain.handle('dlna:remove-device', async (_, { deviceId }) => {
        try {
            manualDevices = manualDevices.filter(d => d.id !== deviceId);
            saveDevices();
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
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

            const location = device.location || `http://${device.host}:${device.port || 9197}/dmr`;
            console.log('[DLNA] Connecting to:', location);

            const client = new MediaRendererClient(location);

            // Always route remote streams through the local proxy. IPTV
            // providers often reject the TV's direct request (single-connection
            // limits, User-Agent checks, self-signed HTTPS) and the TV then
            // reports UPnP 704 ("format not supported" / "local restrictions").
            // Through the proxy the TV fetches from this machine, which talks
            // to the provider with the app's HTTPS agent and headers.
            const isRemoteHttp = /^https?:\/\//i.test(url)
            if (isRemoteHttp) {
                await ensureProxyServer()
            }
            const castUrl = isRemoteHttp
                ? createProxyUrl(url, device.host)
                : url

            const contentType = getMimeForUrl(url);

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

                client.on('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });

                client.load(castUrl, options, (err) => {
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
        } catch (error: unknown) {
            console.error('[DLNA] Cast error:', error);
            const message = getErrorMessage(error);
            let friendly = message;
            if (/\b704\b|restrict|format not supported|not implemented/i.test(message)) {
                friendly = url.includes('.m3u8')
                    ? 'A TV recusou este stream HLS (erro 704). Tente um filme/série (MP4) ou reproduza localmente.'
                    : 'A TV recusou o formato deste vídeo (erro 704). O container pode não ser suportado pela TV (ex.: MKV) — tente outra versão do conteúdo.';
            } else if (/timeout/i.test(message)) {
                friendly = 'Tempo esgotado — verifique se a TV está ligada, na mesma rede e com DLNA habilitado.';
            }
            return { success: false, error: friendly };
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

            const location = device.location || `http://${device.host}:${device.port || 9197}/dmr`;
            const client = new MediaRendererClient(location);

            await new Promise((resolve, reject) => {
                client.stop((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(true);
                    }
                });
            });

            return { success: true };
        } catch (error: unknown) {
            console.error('[DLNA] Stop error:', error);
            return {
                success: false,
                error: getErrorMessage(error)
            };
        }
    });

    console.log('[DLNA] IPC Handlers initialized with auto-discovery');
}
