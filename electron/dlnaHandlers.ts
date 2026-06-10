// DLNA/UPnP IPC Handlers - Auto Discovery + Manual Entry
// Enhanced DLNA casting with SSDP discovery

import { ipcMain } from 'electron';
import { createRequire } from 'module';
import dgram from 'dgram';
import http from 'http';
import os from 'os';
import { randomUUID } from 'crypto';
import { getProviderHttpsAgent } from './certificatePolicy';
import log from './logger';

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

interface NativeSsdpResponse {
    headers: SsdpHeaders
    address: string
}

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const discoveredDevices: Map<string, DlnaDevice> = new Map();
let manualDevices: DlnaDevice[] = [];
let isDiscovering = false;
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

// DLNA "features" advertised both in the AVTransport protocolInfo and in the
// HTTP responses. OP=01 (range seek), CI=0 (no conversion), FLAGS bits for
// streaming-mode + background transfer. Samsung/LG renderers probe for these
// (HEAD or GET with getcontentFeatures.dlna.org: 1) and refuse with UPnP 704
// when the server doesn't answer like a DLNA media server.
const DLNA_FEATURES = 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000'

const AVTRANSPORT_SERVICE = 'urn:schemas-upnp-org:service:AVTransport:1'

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

// location (device description URL) -> resolved AVTransport control URL
const controlUrlCache: Map<string, string> = new Map()

async function getAvTransportControlUrl(location: string): Promise<string> {
    const cached = controlUrlCache.get(location)
    if (cached) return cached

    const fetch = (await import('node-fetch')).default
    const response = await fetch(location, { headers: { 'User-Agent': 'NeoStream IPTV DLNA/1.0' } })
    if (!response.ok) {
        throw new Error(`Device description unavailable (HTTP ${response.status})`)
    }
    const xml = await response.text()

    // Find the <service> block for AVTransport and its <controlURL>.
    const serviceBlock = xml.split(/<service>/i)
        .find((block) => block.includes(AVTRANSPORT_SERVICE))
    const controlPath = serviceBlock ? getXmlTagValue(serviceBlock, 'controlURL') : undefined
    if (!controlPath) {
        throw new Error('Device does not expose an AVTransport control URL')
    }

    const controlUrl = new URL(controlPath, location).toString()
    controlUrlCache.set(location, controlUrl)
    return controlUrl
}

// Raw SOAP caller for AVTransport actions.
//
// We intentionally do NOT use upnp-mediarenderer-client / upnp-device-client:
// 1. load() calls ConnectionManager#PrepareForConnection first, which Samsung
//    TVs advertise but refuse with UPnP 704 "Local restrictions", killing the
//    cast before SetAVTransportURI even runs.
// 2. upnp-device-client sets Content-Length to xml.length (UTF-16 code
//    units, not bytes), so any multibyte title — e.g. CJK series names —
//    truncates the SOAP body and the TV answers 402 "Invalid Args".
function sendAvTransportAction(
    controlUrl: string,
    action: string,
    paramsXml: string,
    timeoutMs = 10000
): Promise<string> {
    const envelope = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${AVTRANSPORT_SERVICE}">${paramsXml}</u:${action}></s:Body></s:Envelope>`
    const body = Buffer.from(envelope, 'utf8')
    const parsed = new URL(controlUrl)

    return new Promise((resolve, reject) => {
        const request = http.request({
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            timeout: timeoutMs,
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                'SOAPAction': `"${AVTRANSPORT_SERVICE}#${action}"`,
                'Content-Length': body.length,
                'User-Agent': 'NeoStream IPTV DLNA/1.0',
                'Connection': 'close'
            }
        }, (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8')
                const errorCode = getXmlTagValue(text, 'errorCode')
                const errorDescription = getXmlTagValue(text, 'errorDescription')
                if (errorCode) {
                    reject(new Error(`${errorDescription || 'UPnP error'} (${errorCode})`))
                } else if (response.statusCode && response.statusCode >= 400) {
                    reject(new Error(`HTTP ${response.statusCode} from device for ${action}`))
                } else {
                    resolve(text)
                }
            })
        })

        request.on('error', reject)
        request.on('timeout', () => {
            request.destroy()
            reject(new Error('Connection timeout - Check if TV is on and DLNA is enabled'))
        })
        request.end(body)
    })
}

function dlnaHeaders(extra: Record<string, string | undefined>): Record<string, string> {
    const headers: Record<string, string> = {
        'transferMode.dlna.org': 'Streaming',
        'contentFeatures.dlna.org': DLNA_FEATURES,
        'Access-Control-Allow-Origin': '*'
    }
    // Drop undefined values — writeHead throws on them (live TS streams have
    // no Content-Length, for example).
    for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined) headers[key] = value
    }
    return headers
}

async function ensureProxyServer(): Promise<number> {
    if (proxyServer && proxyPort) return proxyPort

    proxyServer = http.createServer(async (request, response) => {
        try {
            const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
            const token = requestUrl.pathname.replace('/dlna-proxy/', '')
            const upstreamUrl = proxyUrls.get(token)?.url
            log.info(`[DLNA] Proxy ${request.method} token=${token.slice(0, 8)}… range=${request.headers.range || '-'} known=${Boolean(upstreamUrl)}`)

            if (!upstreamUrl) {
                response.writeHead(404)
                response.end('Not found')
                return
            }

            // TVs probe with HEAD (often with getcontentFeatures.dlna.org: 1)
            // before committing to play. Answer headers-only without pulling
            // the whole stream from the provider.
            if (request.method === 'HEAD') {
                const probe = await fetchUpstream(upstreamUrl, 'bytes=0-0')
                const totalSize = probe.headers.get('content-range')?.split('/')[1]
                    || probe.headers.get('content-length')
                    || undefined
                probe.body?.destroy?.()
                response.writeHead(200, dlnaHeaders({
                    'Content-Type': getMimeForUrl(upstreamUrl, probe.headers.get('content-type')),
                    'Content-Length': totalSize,
                    'Accept-Ranges': 'bytes'
                }))
                response.end()
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
                response.writeHead(200, dlnaHeaders({
                    'Content-Type': 'application/vnd.apple.mpegurl'
                }))
                response.end(rewritten)
                return
            }

            response.writeHead(upstreamResponse.status, dlnaHeaders({
                'Content-Type': getMimeForUrl(upstreamUrl, contentType),
                'Content-Length': upstreamResponse.headers.get('content-length') || undefined,
                'Content-Range': upstreamResponse.headers.get('content-range') || undefined,
                'Accept-Ranges': upstreamResponse.headers.get('accept-ranges') || 'bytes'
            }))
            if (upstreamResponse.body) {
                // If the upstream stream dies mid-transfer the headers are already
                // sent — just tear the socket down instead of writeHead-ing again.
                upstreamResponse.body.on('error', (error: Error) => {
                    log.warn('[DLNA] Proxy upstream stream error:', error.message)
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
        log.info('[DLNA] Local media proxy started on port', proxyPort)
        return proxyPort
    }

    throw new Error('Failed to start DLNA media proxy')
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
            log.info('[DLNA] Loaded', manualDevices.length, 'saved devices');
        }
    } catch (error) {
        log.error('[DLNA] Error loading saved devices:', error);
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
        log.info('[DLNA] Saved', manualDevices.length, 'devices');
    } catch (error) {
        log.error('[DLNA] Error saving devices:', error);
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

function localIPv4Addresses(): string[] {
    return Object.values(os.networkInterfaces())
        .flat()
        .filter((address): address is os.NetworkInterfaceInfo =>
            Boolean(address) && address.family === 'IPv4' && !address.internal
        )
        .map((address) => address.address)
}

async function nativeSsdpSearch(targets: string[], timeoutMs = 5000): Promise<NativeSsdpResponse[]> {
    return new Promise((resolve) => {
        const responses = new Map<string, NativeSsdpResponse>()
        const sockets: dgram.Socket[] = []
        const timers: NodeJS.Timeout[] = []
        let settled = false

        const finish = () => {
            if (settled) return
            settled = true
            timers.forEach(clearTimeout)
            for (const socket of sockets) {
                try {
                    socket.close()
                } catch {
                    // Socket may already be closed.
                }
            }
            resolve(Array.from(responses.values()))
        }

        const onMessage = (buffer: Buffer, remote: dgram.RemoteInfo) => {
            const headers = parseSsdpMessage(buffer.toString('utf8'))
            if (!looksLikeMediaRenderer(headers)) return

            const location = getHeader(headers, 'LOCATION')
            const usn = getHeader(headers, 'USN')
            const key = location || usn || `${remote.address}:${remote.port}`
            responses.set(key, {
                headers,
                address: remote.address
            })
        }

        // One socket per local IPv4 interface: on multi-homed machines
        // (VPN/virtual adapters) a single 0.0.0.0 socket multicasts out the
        // default-route interface, which is often not the LAN where the TV is.
        const localAddresses = localIPv4Addresses()
        const bindAddresses = localAddresses.length > 0 ? localAddresses : ['0.0.0.0']

        for (const localAddress of bindAddresses) {
            const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
            sockets.push(socket)

            socket.on('message', onMessage)
            socket.on('error', (error) => {
                log.warn(`[DLNA] Native SSDP error on ${localAddress}:`, getErrorMessage(error))
            })

            socket.bind(0, localAddress, () => {
                try {
                    socket.setBroadcast(true)
                    socket.setMulticastTTL(4)
                    if (localAddress !== '0.0.0.0') socket.setMulticastInterface(localAddress)
                } catch {
                    // Some network adapters do not allow multicast options.
                }

                // SSDP is lossy UDP — devices routinely miss a single M-SEARCH.
                // Re-send each target a few times across the search window.
                const sendAll = () => {
                    if (settled) return
                    for (const target of targets) {
                        const message = Buffer.from(createSearchMessage(target))
                        socket.send(message, 0, message.length, 1900, '239.255.255.250')
                        socket.send(message, 0, message.length, 1900, '255.255.255.255')
                    }
                }

                sendAll()
                timers.push(setTimeout(sendAll, 700))
                timers.push(setTimeout(sendAll, 1800))
            })
        }

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

// Discover DLNA devices via native SSDP M-SEARCH (dgram).
// peer-ssdp was removed: it exports createPeer(), not Peer, so the previous
// `new SSDP()` threw on load and a guard then skipped discovery entirely —
// the search button returned an empty list instantly.
async function discoverDevices(): Promise<DlnaDevice[]> {
    if (isDiscovering) {
        return Array.from(discoveredDevices.values());
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

        const responses = await nativeSsdpSearch(searchTargets)
        responses.forEach(({ headers, address }) => {
            if (!looksLikeMediaRenderer(headers)) return
            const device = createDiscoveredDevice(headers, address)
            upsertDiscoveredDevice(device)
            log.info('[DLNA] SSDP found device:', device.name, 'at', device.host)
        })

        await Promise.all(Array.from(discoveredDevices.values()).map((device) =>
            enrichDeviceFromDescription(device).then(upsertDiscoveredDevice)
        ))

        log.info('[DLNA] Discovery complete. Found', discoveredDevices.size, 'devices');
        return Array.from(discoveredDevices.values());
    } catch (error) {
        log.error('[DLNA] Discovery error:', error);
        return [];
    } finally {
        isDiscovering = false;
    }
}

export function setupDLNAHandlers() {
    // Load saved devices on startup
    loadSavedDevices();

    // Discover devices
    ipcMain.handle('dlna:discover', async () => {
        try {
            log.info('[DLNA] Starting device discovery...');
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
            log.error('[DLNA] Discover error:', error);
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
            log.info('[DLNA] Adding manual device:', { name, ip, port });
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
            log.error('[DLNA] Add device error:', error);
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
            log.info('[DLNA] Cast requested:', { deviceId, title });

            // Find device (from manual or discovered)
            let device = manualDevices.find(d => d.id === deviceId);
            if (!device) {
                device = discoveredDevices.get(deviceId);
            }

            if (!device) {
                throw new Error('Device not found. Please add it first.');
            }

            const location = device.location || `http://${device.host}:${device.port || 9197}/dmr`;
            log.info('[DLNA] Connecting to:', location);

            const controlUrl = await getAvTransportControlUrl(location);

            // Samsung's DLNA player does not decode HLS playlists ("file not
            // supported" on the TV OSD). Xtream panels expose the same live
            // channel as a continuous MPEG-TS stream at the .ts variant of the
            // URL, which DLNA renderers play fine — prefer it for casting.
            let streamUrl = url;
            if (/\/live\//i.test(url) && /\.m3u8(\?|$)/i.test(url)) {
                streamUrl = url.replace(/\.m3u8(\?|$)/i, '.ts$1');
                log.info(`[DLNA] Live HLS detected; casting MPEG-TS variant instead: ${streamUrl}`);
            }

            // Always route remote streams through the local proxy. IPTV
            // providers often reject the TV's direct request (single-connection
            // limits, User-Agent checks, self-signed HTTPS) and the TV then
            // reports UPnP 704 ("format not supported" / "local restrictions").
            // Through the proxy the TV fetches from this machine, which talks
            // to the provider with the app's HTTPS agent and headers.
            const isRemoteHttp = /^https?:\/\//i.test(streamUrl)
            if (isRemoteHttp) {
                await ensureProxyServer()
            }
            const castUrl = isRemoteHttp
                ? createProxyUrl(streamUrl, device.host)
                : streamUrl

            const tryLoad = async (mime: string) => {
                const protocolInfo = `http-get:*:${mime}:${DLNA_FEATURES}`;
                const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/"><item id="0" parentID="-1" restricted="false"><upnp:class>object.item.videoItem.movie</upnp:class><dc:title>${escapeXml(title || 'Video')}</dc:title><res protocolInfo="${protocolInfo}">${escapeXml(castUrl)}</res></item></DIDL-Lite>`;

                log.info(`[DLNA] tryLoad mime=${mime} castUrl=${castUrl} title=${JSON.stringify(title)}`);

                try {
                    await sendAvTransportAction(controlUrl, 'SetAVTransportURI',
                        `<InstanceID>0</InstanceID><CurrentURI>${escapeXml(castUrl)}</CurrentURI><CurrentURIMetaData>${escapeXml(didl)}</CurrentURIMetaData>`);
                    try {
                        await sendAvTransportAction(controlUrl, 'Play',
                            '<InstanceID>0</InstanceID><Speed>1</Speed>');
                    } catch (playError) {
                        // Samsung renderers auto-play on SetAVTransportURI; an
                        // explicit Play that lands while TRANSITIONING returns
                        // 701 "Transition not available" even though playback
                        // is starting. Check the real transport state before
                        // declaring failure.
                        if (!/\b701\b/.test(getErrorMessage(playError))) throw playError;
                        log.warn('[DLNA] Play returned 701; checking transport state...');
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        const info = await sendAvTransportAction(controlUrl, 'GetTransportInfo',
                            '<InstanceID>0</InstanceID>');
                        const state = getXmlTagValue(info, 'CurrentTransportState') || '';
                        log.info(`[DLNA] Transport state after 701: ${state}`);
                        if (!/PLAYING|TRANSITIONING/i.test(state)) throw playError;
                    }
                    log.info(`[DLNA] Media loaded successfully (mime=${mime})`);
                } catch (err) {
                    log.error(`[DLNA] Cast error (mime=${mime}):`, err);
                    throw err;
                }
            };

            const primaryMime = getMimeForUrl(streamUrl);
            try {
                await tryLoad(primaryMime);
            } catch (firstError) {
                // Picky renderers refuse container-specific mimes (x-matroska
                // etc.) but accept a generic video/mp4 and sniff the stream.
                const message = getErrorMessage(firstError);
                if (primaryMime !== 'video/mp4' && /\b704\b|restrict|format/i.test(message)) {
                    log.warn(`[DLNA] ${primaryMime} refused (${message}); retrying as video/mp4`);
                    await tryLoad('video/mp4');
                } else {
                    throw firstError;
                }
            }

            return { success: true };
        } catch (error: unknown) {
            log.error('[DLNA] Cast error:', error);
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
            log.info('[DLNA] Stop requested:', deviceId);

            let device = manualDevices.find(d => d.id === deviceId);
            if (!device) {
                device = discoveredDevices.get(deviceId);
            }

            if (!device) {
                throw new Error('Device not found');
            }

            const location = device.location || `http://${device.host}:${device.port || 9197}/dmr`;
            const controlUrl = await getAvTransportControlUrl(location);
            await sendAvTransportAction(controlUrl, 'Stop', '<InstanceID>0</InstanceID>');

            return { success: true };
        } catch (error: unknown) {
            log.error('[DLNA] Stop error:', error);
            return {
                success: false,
                error: getErrorMessage(error)
            };
        }
    });

    log.info('[DLNA] IPC Handlers initialized with auto-discovery');
}
