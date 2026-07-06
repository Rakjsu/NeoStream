// DLNA/UPnP IPC Handlers - Auto Discovery + Manual Entry
// Enhanced DLNA casting with SSDP discovery

import { ipcMain } from 'electron';
import { createRequire } from 'module';
import { spawn, type ChildProcess } from 'child_process';
import dgram from 'dgram';
import http from 'http';
import os from 'os';
import { randomUUID } from 'crypto';
import { getProviderHttpsAgent } from './certificatePolicy';
import log from './logger';
import {
    DLNA_FEATURES,
    AVTRANSPORT_SERVICE,
    RENDERING_CONTROL_SERVICE,
    type SsdpHeaders,
    escapeXml,
    getXmlTagValue,
    getHeader,
    parseSsdpMessage,
    looksLikeMediaRenderer,
    createSearchMessage,
    getMimeForUrl,
    needsRemux,
    toCastableLiveUrl,
    buildDidl,
    buildSoapEnvelope,
    parseUpnpFault,
    parseUpnpTime,
    formatUpnpTime,
    vttToSrt,
    rewritePlaylistUris,
} from './dlnaProtocol';
import { planDlnaCommand, clampVolume, stepVolume, muteTarget, type DlnaStatusRaw } from './dlnaRemoteRouting';

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

interface NativeSsdpResponse {
    headers: SsdpHeaders
    address: string
}

// Active cast session — set on successful dlna:cast, cleared on stop/new cast.
interface CastSession {
    deviceId: string
    location: string
    avTransportUrl: string
    renderingControlUrl: string | null
    title: string
}
let castSession: CastSession | null = null;

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

// token -> SRT subtitle content served at /dlna-sub/<token>.srt
const proxySubtitles: Map<string, { srt: string; createdAt: number }> = new Map();
// token -> raw WebVTT served at /cast-sub/<token>.vtt (Chromecast text track)
const castSubtitles: Map<string, { vtt: string; createdAt: number }> = new Map();
// token -> upstream URL remuxed by ffmpeg at /dlna-transcode/<token>
const transcodeUrls: Map<string, { url: string; createdAt: number }> = new Map();
const activeTranscodes: Set<ChildProcess> = new Set();

function resolveFfmpegPath(): string | null {
    try {
        const ffmpegPath = require('ffmpeg-static') as string | null;
        if (!ffmpegPath) return null;
        // Inside a packaged app the binary lives in app.asar.unpacked.
        return ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    } catch {
        return null;
    }
}

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

function createProxyUrl(upstreamUrl: string, deviceHost: string): string {
    const token = randomUUID()
    pruneProxyUrls()
    proxyUrls.set(token, { url: upstreamUrl, createdAt: Date.now() })
    return `http://${getLocalAddressForDevice(deviceHost)}:${proxyPort}/dlna-proxy/${token}?deviceHost=${encodeURIComponent(deviceHost)}`
}

function rewritePlaylist(playlist: string, baseUrl: string, deviceHost: string): string {
    return rewritePlaylistUris(playlist, baseUrl, (absoluteUrl) => createProxyUrl(absoluteUrl, deviceHost))
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

// location|serviceType -> resolved control URL
const controlUrlCache: Map<string, string> = new Map()

async function getServiceControlUrl(location: string, serviceType: string): Promise<string> {
    const cacheKey = `${location}|${serviceType}`
    const cached = controlUrlCache.get(cacheKey)
    if (cached) return cached

    const fetch = (await import('node-fetch')).default
    // LAN device description: quick timeout so a powered-off TV fails fast.
    const response = await fetch(location, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'NeoStream IPTV DLNA/1.0' } })
    if (!response.ok) {
        throw new Error(`Device description unavailable (HTTP ${response.status})`)
    }
    const xml = await response.text()

    const serviceBlock = xml.split(/<service>/i)
        .find((block) => block.includes(serviceType))
    const controlPath = serviceBlock ? getXmlTagValue(serviceBlock, 'controlURL') : undefined
    if (!controlPath) {
        throw new Error(`Device does not expose a control URL for ${serviceType}`)
    }

    const controlUrl = new URL(controlPath, location).toString()
    controlUrlCache.set(cacheKey, controlUrl)
    return controlUrl
}

// Raw SOAP caller for UPnP service actions.
//
// We intentionally do NOT use upnp-mediarenderer-client / upnp-device-client:
// 1. load() calls ConnectionManager#PrepareForConnection first, which Samsung
//    TVs advertise but refuse with UPnP 704 "Local restrictions", killing the
//    cast before SetAVTransportURI even runs.
// 2. upnp-device-client sets Content-Length to xml.length (UTF-16 code
//    units, not bytes), so any multibyte title — e.g. CJK series names —
//    truncates the SOAP body and the TV answers 402 "Invalid Args".
function sendUpnpAction(
    controlUrl: string,
    serviceType: string,
    action: string,
    paramsXml: string,
    timeoutMs = 10000
): Promise<string> {
    const body = Buffer.from(buildSoapEnvelope(serviceType, action, paramsXml), 'utf8')
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
                'SOAPAction': `"${serviceType}#${action}"`,
                'Content-Length': body.length,
                'User-Agent': 'NeoStream IPTV DLNA/1.0',
                'Connection': 'close'
            }
        }, (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8')
                const fault = parseUpnpFault(text)
                if (fault) {
                    reject(new Error(`${fault.description} (${fault.code})`))
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

const sendAvTransportAction = (controlUrl: string, action: string, paramsXml: string, timeoutMs = 10000) =>
    sendUpnpAction(controlUrl, AVTRANSPORT_SERVICE, action, paramsXml, timeoutMs)

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

            // Chromecast subtitle route: raw WebVTT (Cast wants text/vtt).
            if (requestUrl.pathname.startsWith('/cast-sub/')) {
                const subToken = requestUrl.pathname.replace('/cast-sub/', '').replace(/\.vtt$/i, '')
                const subtitle = castSubtitles.get(subToken)
                if (!subtitle) {
                    response.writeHead(404)
                    response.end('Not found')
                    return
                }
                const vttBuffer = Buffer.from(subtitle.vtt, 'utf8')
                response.writeHead(200, {
                    'Content-Type': 'text/vtt;charset=utf-8',
                    'Content-Length': String(vttBuffer.length),
                    'Access-Control-Allow-Origin': '*'
                })
                response.end(request.method === 'HEAD' ? undefined : vttBuffer)
                return
            }

            // Subtitle route: serve stored SRT content.
            if (requestUrl.pathname.startsWith('/dlna-sub/')) {
                const subToken = requestUrl.pathname.replace('/dlna-sub/', '').replace(/\.srt$/i, '')
                const subtitle = proxySubtitles.get(subToken)
                log.info(`[DLNA] Proxy ${request.method} subtitle token=${subToken.slice(0, 8)}… known=${Boolean(subtitle)}`)
                if (!subtitle) {
                    response.writeHead(404)
                    response.end('Not found')
                    return
                }
                const srtBuffer = Buffer.from(subtitle.srt, 'utf8')
                response.writeHead(200, dlnaHeaders({
                    'Content-Type': 'text/srt;charset=utf-8',
                    'Content-Length': String(srtBuffer.length)
                }))
                response.end(request.method === 'HEAD' ? undefined : srtBuffer)
                return
            }

            // Transcode route: remux upstream to MPEG-TS via ffmpeg.
            if (requestUrl.pathname.startsWith('/dlna-transcode/')) {
                const tToken = requestUrl.pathname.replace('/dlna-transcode/', '')
                const entry = transcodeUrls.get(tToken)
                log.info(`[DLNA] Proxy ${request.method} transcode token=${tToken.slice(0, 8)}… known=${Boolean(entry)}`)
                if (!entry) {
                    response.writeHead(404)
                    response.end('Not found')
                    return
                }
                response.writeHead(200, dlnaHeaders({ 'Content-Type': 'video/MP2T' }))
                if (request.method === 'HEAD') {
                    response.end()
                    return
                }

                const ffmpegPath = resolveFfmpegPath()
                if (!ffmpegPath) {
                    response.destroy()
                    return
                }
                // Remux only (-c copy): container conversion without re-encoding,
                // cheap enough for any machine. The TV gets a TS stream it can
                // play regardless of the source container (MKV/AVI).
                const ffmpeg = spawn(ffmpegPath, [
                    '-hide_banner', '-loglevel', 'error',
                    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    '-i', entry.url,
                    '-c', 'copy',
                    '-f', 'mpegts',
                    'pipe:1'
                ], { stdio: ['ignore', 'pipe', 'pipe'] })
                activeTranscodes.add(ffmpeg)

                ffmpeg.stdout.pipe(response)
                ffmpeg.stderr.on('data', (chunk: Buffer) => {
                    log.warn('[DLNA] ffmpeg:', chunk.toString().trim())
                })
                const cleanup = () => {
                    activeTranscodes.delete(ffmpeg)
                    try { ffmpeg.kill('SIGKILL') } catch { /* already dead */ }
                }
                response.on('close', cleanup)
                ffmpeg.on('exit', () => {
                    activeTranscodes.delete(ffmpeg)
                    response.end()
                })
                return
            }

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
            signal: AbortSignal.timeout(10000),
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
    ipcMain.handle('dlna:cast', async (_, { deviceId, url, title, subtitleVtt }) => {
        try {
            log.info('[DLNA] Cast requested:', { deviceId, title, hasSubtitle: Boolean(subtitleVtt) });

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

            const avTransportUrl = await getServiceControlUrl(location, AVTRANSPORT_SERVICE);
            const renderingControlUrl = await getServiceControlUrl(location, RENDERING_CONTROL_SERVICE)
                .catch(() => null);

            // Samsung's DLNA player does not decode HLS playlists ("file not
            // supported" on the TV OSD); Xtream live channels are cast as
            // their continuous MPEG-TS variant instead.
            const streamUrl = toCastableLiveUrl(url);
            if (streamUrl !== url) {
                log.info(`[DLNA] Live HLS detected; casting MPEG-TS variant instead: ${streamUrl}`);
            }

            // Always route remote streams through the local proxy. IPTV
            // providers often reject the TV's direct request (single-connection
            // limits, User-Agent checks, self-signed HTTPS) and the TV then
            // reports UPnP 704 ("format not supported" / "local restrictions").
            // MKV/AVI containers additionally go through an ffmpeg remux to
            // MPEG-TS, which renderers play regardless of source container.
            const isRemoteHttp = /^https?:\/\//i.test(streamUrl)
            if (isRemoteHttp) {
                await ensureProxyServer()
            }

            const useTranscode = isRemoteHttp && needsRemux(streamUrl) && resolveFfmpegPath() !== null;
            let castUrl = streamUrl;
            let effectiveMime = getMimeForUrl(streamUrl);
            if (useTranscode) {
                const tToken = randomUUID();
                transcodeUrls.set(tToken, { url: streamUrl, createdAt: Date.now() });
                castUrl = `http://${getLocalAddressForDevice(device.host)}:${proxyPort}/dlna-transcode/${tToken}`;
                effectiveMime = 'video/MP2T';
                log.info(`[DLNA] ${streamUrl.split('?')[0].slice(-12)} container needs remux; casting via ffmpeg MPEG-TS`);
            } else if (isRemoteHttp) {
                castUrl = createProxyUrl(streamUrl, device.host);
            }

            // Subtitle: store SRT (converted from the renderer's VTT) and
            // reference it in the DIDL via Samsung's sec:CaptionInfoEx.
            let subtitleUrl: string | undefined;
            if (typeof subtitleVtt === 'string' && subtitleVtt.trim() && isRemoteHttp) {
                const subToken = randomUUID();
                proxySubtitles.set(subToken, { srt: vttToSrt(subtitleVtt), createdAt: Date.now() });
                subtitleUrl = `http://${getLocalAddressForDevice(device.host)}:${proxyPort}/dlna-sub/${subToken}.srt`;
                log.info('[DLNA] Subtitle attached to cast');
            }

            const tryLoad = async (mime: string) => {
                const didl = buildDidl({ title: title || 'Video', mediaUrl: castUrl, mime, subtitleUrl });
                log.info(`[DLNA] tryLoad mime=${mime} castUrl=${castUrl} title=${JSON.stringify(title)}`);

                try {
                    await sendAvTransportAction(avTransportUrl, 'SetAVTransportURI',
                        `<InstanceID>0</InstanceID><CurrentURI>${escapeXml(castUrl)}</CurrentURI><CurrentURIMetaData>${escapeXml(didl)}</CurrentURIMetaData>`);
                    try {
                        await sendAvTransportAction(avTransportUrl, 'Play',
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
                        const info = await sendAvTransportAction(avTransportUrl, 'GetTransportInfo',
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

            try {
                await tryLoad(effectiveMime);
            } catch (firstError) {
                // Picky renderers refuse container-specific mimes (x-matroska
                // etc.) but accept a generic video/mp4 and sniff the stream.
                const message = getErrorMessage(firstError);
                if (effectiveMime !== 'video/mp4' && /\b704\b|restrict|format/i.test(message)) {
                    log.warn(`[DLNA] ${effectiveMime} refused (${message}); retrying as video/mp4`);
                    await tryLoad('video/mp4');
                } else {
                    throw firstError;
                }
            }

            castSession = {
                deviceId,
                location,
                avTransportUrl,
                renderingControlUrl,
                title: title || 'Video'
            };

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
            const controlUrl = await getServiceControlUrl(location, AVTRANSPORT_SERVICE);
            await sendAvTransportAction(controlUrl, 'Stop', '<InstanceID>0</InstanceID>');

            castSession = null;
            for (const ffmpeg of activeTranscodes) {
                try { ffmpeg.kill('SIGKILL') } catch { /* already dead */ }
            }
            activeTranscodes.clear();

            return { success: true };
        } catch (error: unknown) {
            log.error('[DLNA] Stop error:', error);
            return {
                success: false,
                error: getErrorMessage(error)
            };
        }
    });

    // ===== Cast remote-control: pause / resume / seek / volume / status =====

    const requireSession = (): CastSession => {
        if (!castSession) throw new Error('No active cast session');
        return castSession;
    };

    ipcMain.handle('dlna:pause', async () => {
        try {
            const session = requireSession();
            await sendAvTransportAction(session.avTransportUrl, 'Pause', '<InstanceID>0</InstanceID>');
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('dlna:resume', async () => {
        try {
            const session = requireSession();
            await sendAvTransportAction(session.avTransportUrl, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>');
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('dlna:seek', async (_, { seconds }) => {
        try {
            const session = requireSession();
            const target = formatUpnpTime(Number(seconds) || 0);
            await sendAvTransportAction(session.avTransportUrl, 'Seek',
                `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${target}</Target>`);
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('dlna:set-volume', async (_, { volume }) => {
        try {
            const session = requireSession();
            if (!session.renderingControlUrl) throw new Error('Device does not expose RenderingControl');
            const level = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
            await sendUpnpAction(session.renderingControlUrl, RENDERING_CONTROL_SERVICE, 'SetVolume',
                `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${level}</DesiredVolume>`);
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('dlna:get-status', async () => {
        try {
            const session = requireSession();
            const status = await fetchDlnaSessionStatus(session);
            return { success: true, deviceId: session.deviceId, ...status };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    log.info('[DLNA] IPC Handlers initialized with auto-discovery');
}

/** True for URLs only this machine can reach (loopback). */
export function isLoopbackUrl(url: string): boolean {
    return /^https?:\/\/(127\.|localhost([:/]|$))/i.test(url)
}

/**
 * Wrap any upstream URL in the LAN proxy (Chromecast/AirPlay can then reach
 * loopback sources like the rescue-transcode HLS). Playlists get their
 * segment URIs rewritten by the proxy route, same as DLNA casting.
 */
export async function createLanProxyUrlFor(upstreamUrl: string, deviceHost: string): Promise<string> {
    await ensureProxyServer()
    return createProxyUrl(upstreamUrl, deviceHost)
}

/**
 * Serve a WebVTT subtitle on the LAN for a Chromecast text track. Reuses the
 * DLNA proxy server; returns the URL reachable from the device's subnet.
 */
export async function registerCastSubtitleVtt(vtt: string, deviceHost: string): Promise<string> {
    const port = await ensureProxyServer()
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36)
    castSubtitles.set(token, { vtt, createdAt: Date.now() })
    // Same 30-min sweep policy as the SRT map (small strings, low risk).
    for (const [key, entry] of castSubtitles) {
        if (Date.now() - entry.createdAt > 30 * 60_000) castSubtitles.delete(key)
    }
    return `http://${getLocalAddressForDevice(deviceHost)}:${port}/cast-sub/${token}.vtt`
}

// ===== Phone-remote transport for the active DLNA session ====================
// Mirrors castRemoteControl (Chromecast): the web-remote server tries the
// Chromecast session first, then this. Plans are pure (dlnaRemoteRouting);
// the SOAP execution is fire-and-forget — the phone has no DLNA progress UI
// yet, so failures just log.

let preMuteDlnaVolume = 30

export function isDlnaSessionActive(): boolean {
    return castSession !== null
}

/** Transport state + position + volume of one session (three SOAP calls). */
async function fetchDlnaSessionStatus(session: CastSession): Promise<DlnaStatusRaw> {
    const [transportInfo, positionInfo] = await Promise.all([
        sendAvTransportAction(session.avTransportUrl, 'GetTransportInfo', '<InstanceID>0</InstanceID>', 5000),
        sendAvTransportAction(session.avTransportUrl, 'GetPositionInfo', '<InstanceID>0</InstanceID>', 5000),
    ])
    let volume: number | null = null
    if (session.renderingControlUrl) {
        try {
            const volumeInfo = await sendUpnpAction(session.renderingControlUrl, RENDERING_CONTROL_SERVICE,
                'GetVolume', '<InstanceID>0</InstanceID><Channel>Master</Channel>', 5000)
            const parsed = Number(getXmlTagValue(volumeInfo, 'CurrentVolume'))
            volume = Number.isFinite(parsed) ? parsed : null
        } catch {
            // Volume is best-effort; some renderers refuse GetVolume.
        }
    }
    return {
        title: session.title,
        state: getXmlTagValue(transportInfo, 'CurrentTransportState') || 'UNKNOWN',
        position: parseUpnpTime(getXmlTagValue(positionInfo, 'RelTime')),
        duration: parseUpnpTime(getXmlTagValue(positionInfo, 'TrackDuration')),
        volume,
    }
}

/**
 * Snapshot for the phone remote's state broadcast — null when no session or
 * when the renderer stopped answering (session likely gone).
 */
export async function getDlnaStatusSnapshot(): Promise<DlnaStatusRaw | null> {
    const session = castSession
    if (!session) return null
    try {
        return await fetchDlnaSessionStatus(session)
    } catch {
        return null
    }
}

async function getDlnaVolume(session: CastSession): Promise<number> {
    if (!session.renderingControlUrl) throw new Error('Device does not expose RenderingControl')
    const info = await sendUpnpAction(session.renderingControlUrl, RENDERING_CONTROL_SERVICE,
        'GetVolume', '<InstanceID>0</InstanceID><Channel>Master</Channel>', 5000)
    const parsed = Number(getXmlTagValue(info, 'CurrentVolume'))
    if (!Number.isFinite(parsed)) throw new Error('GetVolume sem CurrentVolume')
    return parsed
}

async function setDlnaVolume(session: CastSession, level: number): Promise<void> {
    if (!session.renderingControlUrl) throw new Error('Device does not expose RenderingControl')
    await sendUpnpAction(session.renderingControlUrl, RENDERING_CONTROL_SERVICE, 'SetVolume',
        `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${clampVolume(level)}</DesiredVolume>`)
}

/**
 * Route a phone-remote transport command to the active DLNA session. Returns
 * true when a live session consumed the action (the SOAP round-trips run in
 * the background); false lets the caller fall through to the renderer.
 */
export function dlnaRemoteControl(action: string, value?: number): boolean {
    const session = castSession
    if (!session) return false
    const plan = planDlnaCommand(action, value)
    if (!plan) return false

    const run = async () => {
        switch (plan.kind) {
            case 'toggle': {
                const info = await sendAvTransportAction(session.avTransportUrl, 'GetTransportInfo', '<InstanceID>0</InstanceID>', 5000)
                const state = getXmlTagValue(info, 'CurrentTransportState')
                if (state === 'PLAYING') {
                    await sendAvTransportAction(session.avTransportUrl, 'Pause', '<InstanceID>0</InstanceID>')
                } else {
                    await sendAvTransportAction(session.avTransportUrl, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>')
                }
                return
            }
            case 'stop':
                await sendAvTransportAction(session.avTransportUrl, 'Stop', '<InstanceID>0</InstanceID>')
                castSession = null
                // Same teardown as dlna:stop — rescue transcodes die with the cast.
                for (const ffmpeg of activeTranscodes) {
                    try { ffmpeg.kill('SIGKILL') } catch { /* already dead */ }
                }
                activeTranscodes.clear()
                return
            case 'seekRelative': {
                const pos = await sendAvTransportAction(session.avTransportUrl, 'GetPositionInfo', '<InstanceID>0</InstanceID>', 5000)
                const current = parseUpnpTime(getXmlTagValue(pos, 'RelTime'))
                const target = formatUpnpTime(Math.max(0, current + plan.seconds))
                await sendAvTransportAction(session.avTransportUrl, 'Seek',
                    `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${target}</Target>`)
                return
            }
            case 'setVolume':
                await setDlnaVolume(session, plan.level)
                return
            case 'volumeStep': {
                const current = await getDlnaVolume(session)
                await setDlnaVolume(session, stepVolume(current, plan.delta))
                return
            }
            case 'muteToggle': {
                const current = await getDlnaVolume(session)
                const next = muteTarget(current, preMuteDlnaVolume)
                preMuteDlnaVolume = next.preMute
                await setDlnaVolume(session, next.level)
                return
            }
            case 'noop':
                return
        }
    }
    void run().catch((error: unknown) => log.warn('[DLNA] comando do controle web falhou:', getErrorMessage(error)))
    return true
}
