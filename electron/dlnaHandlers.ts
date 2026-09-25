// DLNA/UPnP IPC Handlers - Auto Discovery + Manual Entry
// Enhanced DLNA casting with SSDP discovery

import { ipcMain } from 'electron';
import { createRequire } from 'module';
import { spawn, type ChildProcess } from 'child_process';
import dgram from 'dgram';
import http from 'http';
import type { Readable } from 'stream';
import os from 'os';
import { resolveProviderHttpsAgent } from './certificatePolicy';
import { getErrorMessage } from './errorMessage';
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
    isHttpLocation,
    isTrustedSsdpLocation,
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
import { planDlnaCommand, planDlnaStop, clampVolume, stepVolume, muteTarget, type DlnaStatusRaw } from './dlnaRemoteRouting';
import {
    novoRelogioDoFimDlna,
    marcarComandoDlna,
    registrarObservacaoDlna,
    type ObservacaoDlna,
} from './dlnaFimDaSessao';
import { isAllowedHost } from './localServerGuard';
import {
    MAX_PROXY_REDIRECTS,
    canAcceptTranscode,
    classifyProxyTarget,
    isTokenValid,
    newProxyToken,
    planUpstreamRedirect,
    tokensToRevoke,
    type ProxyTokenEntry,
} from './dlnaProxyGuard';
import { getCertificateSettings } from './certificatePolicy';
import { resolveFfmpegPath } from './ffmpegPath'

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
    deviceName: string
    location: string
    avTransportUrl: string
    renderingControlUrl: string | null
    title: string
}
let castSession: CastSession | null = null;
// Relogio que decide quando a sessao acabou SOZINHA na TV (dlnaFimDaSessao).
let fimDaSessaoDlna = novoRelogioDoFimDlna(0);

const discoveredDevices: Map<string, DlnaDevice> = new Map();
let manualDevices: DlnaDevice[] = [];
let isDiscovering = false;
let proxyServer: http.Server | null = null;
let proxyPort: number | null = null;
// token -> upstream URL. Entries are NOT removed on first read (devices
// re-request playlists/segments repeatedly during a cast session): a validade
// é por INATIVIDADE, renovada a cada acerto. É o que impede que um token
// capturado no SOAP em claro valha a sessão inteira do app.
const proxyUrls: Map<string, ProxyUrlEntry> = new Map();
const PROXY_URL_MAX_ENTRIES = 5000;

// token -> SRT subtitle content served at /dlna-sub/<token>.srt
const proxySubtitles: Map<string, SubtitleEntry> = new Map();
// token -> raw WebVTT served at /cast-sub/<token>.vtt (Chromecast text track)
const castSubtitles: Map<string, CastSubtitleEntry> = new Map();
// token -> upstream URL remuxed by ffmpeg at /dlna-transcode/<token>
const transcodeUrls: Map<string, ProxyUrlEntry> = new Map();
const activeTranscodes: Set<ChildProcess> = new Set();

interface ProxyUrlEntry extends ProxyTokenEntry { url: string }
interface SubtitleEntry extends ProxyTokenEntry { srt: string }
interface CastSubtitleEntry extends ProxyTokenEntry { vtt: string }

function newTokenEntry(deviceHost: string): ProxyTokenEntry {
    const now = Date.now()
    return { deviceHost, createdAt: now, lastUsedAt: now }
}

function pruneTokenMap<T extends ProxyTokenEntry>(map: Map<string, T>, now: number): void {
    for (const [token, entry] of map) {
        if (!isTokenValid(entry, now)) map.delete(token)
    }
}

/** Lookup que expira o token vencido e renova a validade do que está em uso. */
function useToken<T extends ProxyTokenEntry>(map: Map<string, T>, token: string): T | undefined {
    const now = Date.now()
    pruneTokenMap(map, now)
    const entry = map.get(token)
    if (!entry || !isTokenValid(entry, now)) return undefined
    entry.lastUsedAt = now
    return entry
}

// Stream longo (filme inteiro num range só, remux de horas) não volta ao
// lookup: fica marcado como em uso e renova a validade quando termina.
function beginStream(entry: ProxyTokenEntry | undefined): void {
    if (entry) entry.inFlight = (entry.inFlight ?? 0) + 1
}

function endStream(entry: ProxyTokenEntry | undefined): void {
    if (!entry) return
    entry.inFlight = Math.max(0, (entry.inFlight ?? 1) - 1)
    entry.lastUsedAt = Date.now()
}

/** Fim do cast daquele aparelho = fim dos tokens dele (o SOAP já vazou todos). */
function revokeDeviceTokens(deviceHost: string): void {
    let revoked = 0
    for (const map of [proxyUrls, transcodeUrls, proxySubtitles, castSubtitles] as Map<string, ProxyTokenEntry>[]) {
        for (const token of tokensToRevoke(map, deviceHost)) {
            map.delete(token)
            revoked++
        }
    }
    if (revoked > 0) log.info('[DLNA] Tokens revogados no stop:', revoked)
}

/** Hosts já reconhecidos como do provedor (além do host da própria playlist). */
function knownProviderHosts(): string[] {
    return getCertificateSettings().approvedProviderHosts
}

function pruneProxyUrls(): void {
    pruneTokenMap(proxyUrls, Date.now())
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
            address !== undefined && address.family === 'IPv4' && !address.internal
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

// URL escolhida pelo próprio app (stream do cast, HLS de resgate em loopback):
// não passa pelo confinamento de destino, que existe para o que vem da playlist.
function createProxyUrl(upstreamUrl: string, deviceHost: string): string {
    const token = newProxyToken()
    pruneProxyUrls()
    proxyUrls.set(token, { url: upstreamUrl, ...newTokenEntry(deviceHost) })
    return `http://${getLocalAddressForDevice(deviceHost)}:${proxyPort}/dlna-proxy/${token}?deviceHost=${encodeURIComponent(deviceHost)}`
}

// Cada URI da playlist do provedor decide seu destino: só o que é do provedor
// vira token do proxy (o resto viraria SSRF cega com o IP do desktop).
function rewritePlaylist(playlist: string, baseUrl: string, deviceHost: string): string {
    const providerHosts = knownProviderHosts()
    return rewritePlaylistUris(playlist, baseUrl, (absoluteUrl) => {
        const verdict = classifyProxyTarget(absoluteUrl, baseUrl, providerHosts)
        if (verdict === 'proxy') return createProxyUrl(absoluteUrl, deviceHost)
        if (verdict === 'passthrough') return absoluteUrl
        // Interno: nem o desktop busca nem a TV recebe (ela também alcança a LAN).
        // Token nunca registrado => o próprio proxy responde 404 e a playlist
        // continua estruturalmente válida.
        log.warn('[DLNA] URI da playlist recusada (destino interno):', absoluteUrl.slice(0, 120))
        return `http://${getLocalAddressForDevice(deviceHost)}:${proxyPort}/dlna-proxy/${newProxyToken()}`
    })
}

/**
 * O node-fetch v3 tipa o corpo como NodeJS.ReadableStream (sem destroy), mas
 * em runtime ele é um stream.Readable — é o destroy() que solta a conexão
 * com o provedor.
 */
function descartarCorpo(body: NodeJS.ReadableStream | null | undefined): void {
    (body as Readable | null | undefined)?.destroy?.()
}

async function fetchUpstream(url: string, range?: string) {
    const fetch = (await import('node-fetch')).default
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        ...(range ? { Range: range } : {})
    }

    // Redirecionamento é seguido à mão: o provedor manda o Location, e um 302
    // para 127.0.0.1/LAN recriaria a SSRF que o filtro da playlist fecha.
    let currentUrl = url
    for (let hop = 0; hop <= MAX_PROXY_REDIRECTS; hop++) {
        const response = await fetch(currentUrl, {
            // Agent do salto atual, com o da URL original como reserva: seguir
            // redirecionamento não pode ficar MAIS estrito no TLS do que antes.
            // `resolve` (assíncrono) porque a confiança em certificado inválido
            // passou a depender de consentimento por domínio.
            agent: (await resolveProviderHttpsAgent(currentUrl)) || (await resolveProviderHttpsAgent(url)),
            redirect: 'manual',
            headers
        })

        const plan = planUpstreamRedirect(currentUrl, response.status, response.headers.get('location'))
        if (plan.kind === 'stop') return response

        descartarCorpo(response.body)
        if (plan.kind === 'block') {
            throw new Error(`Redirecionamento recusado (${plan.reason})`)
        }
        currentUrl = plan.url
    }

    throw new Error('Redirecionamentos demais do provedor')
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
            // 🛡️ O proxy escuta em 0.0.0.0 e a TV/Chromecast sempre chega por IP
            // literal (é o endereço que vai no SetAVTransportURI). Um Host de
            // domínio só pode ser página que rebindou o DNS pra cá — recusa
            // antes de tocar em qualquer token. Origin NÃO é checado de
            // propósito: o receiver do Chromecast busca a legenda de uma origem
            // do Google, e barrá-lo mataria a legenda no cast.
            if (!isAllowedHost(request.headers.host, proxyPort)) {
                log.warn(`[DLNA] Proxy recusou Host suspeito: ${request.headers.host}`)
                response.writeHead(421)
                response.end()
                return
            }
            const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

            // Chromecast subtitle route: raw WebVTT (Cast wants text/vtt).
            if (requestUrl.pathname.startsWith('/cast-sub/')) {
                const subToken = requestUrl.pathname.replace('/cast-sub/', '').replace(/\.vtt$/i, '')
                const subtitle = useToken(castSubtitles, subToken)
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
                const subtitle = useToken(proxySubtitles, subToken)
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
                const entry = useToken(transcodeUrls, tToken)
                log.info(`[DLNA] Proxy ${request.method} transcode token=${tToken.slice(0, 8)}… known=${Boolean(entry)}`)
                if (!entry) {
                    response.writeHead(404)
                    response.end('Not found')
                    return
                }
                if (request.method === 'HEAD') {
                    response.writeHead(200, dlnaHeaders({ 'Content-Type': 'video/MP2T' }))
                    response.end()
                    return
                }

                const ffmpegPath = resolveFfmpegPath()
                if (!ffmpegPath) {
                    response.writeHead(503)
                    response.end('Transcoder unavailable')
                    return
                }
                // Teto de processos: cada GET aqui é um ffmpeg. Sem ele, algumas
                // centenas de conexões (vizinho de LAN ou TV maluca) saturam a
                // máquina. Recusa na hora em vez de enfileirar: a fila só
                // seguraria socket sem dado até a TV desistir, com o mesmo custo.
                if (!canAcceptTranscode(activeTranscodes.size)) {
                    log.warn('[DLNA] Remux recusado: teto de processos atingido', activeTranscodes.size)
                    response.writeHead(503, { 'Retry-After': '5' })
                    response.end('Too many transcodes')
                    return
                }
                response.writeHead(200, dlnaHeaders({ 'Content-Type': 'video/MP2T' }))
                beginStream(entry)
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
                    // windowsHide: sem ele, cada GET da TV pisca uma janela de
                    // console preta por cima do que estiver na tela do PC — e é
                    // um GET por faixa de áudio/legenda que a TV experimenta.
                    // Todos os outros spawns do projeto já passam isto.
                ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
                activeTranscodes.add(ffmpeg)

                ffmpeg.stdout.pipe(response)
                ffmpeg.stderr.on('data', (chunk: Buffer) => {
                    log.warn('[DLNA] ffmpeg:', chunk.toString().trim())
                })
                const cleanup = () => {
                    activeTranscodes.delete(ffmpeg)
                    endStream(entry)
                    try { ffmpeg.kill('SIGKILL') } catch { /* already dead */ }
                }
                response.on('close', cleanup)
                ffmpeg.on('exit', () => {
                    activeTranscodes.delete(ffmpeg)
                    response.end()
                })
                // 🧯 'error' do ChildProcess é ASSÍNCRONO e não tem nada a ver
                // com o try/catch daqui: ele avisa que o spawn em si falhou
                // (binário sumido ou movido pelo antivírus, EACCES, caminho
                // errado fora do asar — exatamente a classe de falha que o
                // resolveFfmpegPath já teve). EventEmitter que emite 'error'
                // sem ouvinte LANÇA: no processo principal isso é
                // uncaughtException, ou seja, a TV pedir um remux derrubava o
                // app inteiro — reprodução, DVR e downloads junto. E, sem o
                // destroy, a TV ficaria pendurada num 200 que nunca recebe um
                // byte.
                ffmpeg.on('error', (err) => {
                    log.error('[DLNA] falha ao iniciar o remux:', err)
                    cleanup()
                    if (!response.writableEnded) response.destroy()
                })
                return
            }

            const token = requestUrl.pathname.replace('/dlna-proxy/', '')
            const proxyEntry = useToken(proxyUrls, token)
            const upstreamUrl = proxyEntry?.url
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
                descartarCorpo(probe.body)
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
                // O corpo de erro do provedor costuma ecoar o caminho da
                // requisição — que no Xtream é /movie/USUARIO/SENHA/…. O proxy
                // escuta em 0.0.0.0, então quem tem o token teria a credencial
                // de graça. Detalhe só no log (redigido pelo transporte).
                log.warn(`[DLNA] Proxy upstream ${upstreamResponse.status}:`, (await upstreamResponse.text()).slice(0, 300))
                response.writeHead(upstreamResponse.status)
                response.end('upstream error')
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
                beginStream(proxyEntry)
                response.on('close', () => {
                    // Device hung up; stop pulling from upstream.
                    descartarCorpo(upstreamResponse.body)
                    endStream(proxyEntry)
                })
                upstreamResponse.body.pipe(response)
            } else {
                response.end()
            }
        } catch (error) {
            if (response.headersSent) {
                response.destroy()
            } else {
                // Corpo FIXO: a FetchError do node-fetch é montada como
                // "request to <URL COMPLETA> failed", e a URL upstream do Xtream
                // carrega usuário e senha no caminho. Devolver a mensagem crua
                // entregava a assinatura do dono a qualquer um na LAN que
                // tivesse um token do proxy e forçasse o upstream a falhar.
                log.warn('[DLNA] Proxy error:', getErrorMessage(error))
                response.writeHead(502)
                response.end('upstream error')
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

/**
 * Prazo do Stop de cortesia mandado a sessao ANTERIOR. Curto de proposito: a
 * TV velha pode estar desligada ou fora da rede, e o cast novo nao pode ficar
 * preso nos 10 s do SOAP normal esperando um aparelho que nao responde mais.
 */
const PREVIOUS_SESSION_STOP_TIMEOUT_MS = 1500

/**
 * Encerramento LOCAL de um cast DLNA: sessao esquecida, remux morto e tokens
 * do aparelho revogados. Era o mesmo bloco copiado em tres lugares
 * (`dlna:stop`, o `stop` do controle pelo celular e agora o comeco de um
 * cast novo).
 *
 * Matar TODO o `activeTranscodes` e heranca do `dlna:stop` e continua aqui:
 * esse Set so recebe os ffmpeg da rota /dlna-transcode/, e o unico lugar que
 * emite token dessa rota e o proprio `dlna:cast` — Chromecast e AirPlay usam
 * /dlna-proxy/, sem ffmpeg. Ou seja: nao ha remux de outro protocolo pra
 * matar por engano.
 */
function releaseDlnaLocalResources(tokenHost: string): void {
    castSession = null
    for (const ffmpeg of activeTranscodes) {
        try { ffmpeg.kill('SIGKILL') } catch { /* already dead */ }
    }
    activeTranscodes.clear()
    revokeDeviceTokens(tokenHost)
}

/**
 * Encerra a sessao DLNA viva antes de outra comecar — o que o `cast:play` do
 * Chromecast ja faz com `stopActiveSession()`.
 *
 * Sem isto, mandar o segundo video para OUTRA TV so sobrescrevia o
 * `castSession`: a primeira continuava tocando, o ffmpeg dela continuava
 * puxando o stream e os tokens do proxy daquele aparelho continuavam valendo
 * — duas TVs e duas conexoes no provedor.
 *
 * Duas ressalvas, nesta ordem:
 *  - o Stop vai com prazo curto e dentro de try/catch: TV desligada nao pode
 *    derrubar (nem segurar) o cast novo;
 *  - quando o alvo e o MESMO aparelho, nao ha Stop. O SetAVTransportURI
 *    seguinte ja troca o que esta tocando, e um Stop no meio so apaga a tela
 *    (em renderer Samsung ainda convida o 701 na volta). O encerramento local
 *    acontece assim mesmo, ANTES de o cast novo criar os tokens dele.
 */
async function stopActiveDlnaSession(nextDeviceId?: string): Promise<void> {
    const session = castSession
    if (!session) return

    if (session.deviceId !== nextDeviceId) {
        try {
            await sendAvTransportAction(session.avTransportUrl, 'Stop',
                '<InstanceID>0</InstanceID>', PREVIOUS_SESSION_STOP_TIMEOUT_MS)
        } catch (error: unknown) {
            log.warn('[DLNA] Stop da sessao anterior falhou (TV desligada?):', getErrorMessage(error))
        }
    }

    releaseDlnaLocalResources(getHostFromLocation(session.location) || '')
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
            address !== undefined && address.family === 'IPv4' && !address.internal
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
    const advertised = getHeader(headers, 'LOCATION')
    // O aparelho continua na lista (nada some da tela de transmitir), mas um
    // LOCATION que não é http(s) OU que aponta para um host diferente de quem
    // respondeu o M-SEARCH é descartado: sem ele nada é buscado sozinho e o
    // "aparelho" forjado não recebe a URL do provedor num clique.
    const location = isTrustedSsdpLocation(advertised, address) ? advertised : undefined
    if (advertised && !location) {
        log.warn('[DLNA] LOCATION recusado (não bate com o remetente):', advertised, 'de', address)
    }
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

/** Prazo de cada leitura de descrição na descoberta SSDP (o aparelho já respondeu ao M-SEARCH). */
const DESCRICAO_TIMEOUT_MS = 10000

/**
 * Prazo de CADA sonda do cadastro manual por IP. É descoberta em LAN, não
 * download: uma TV ligada responde a descrição em milissegundos. Com as sondas
 * em paralelo, este é o pior caso inteiro do "Adicionar TV" (D199) — antes
 * eram 16-20 sondas de 10 s em fila, ~2,5-3 minutos com a TV desligada.
 */
const SONDA_MANUAL_TIMEOUT_MS = 3000

/**
 * Sinal que aborta no prazo OU quando o sinal-pai abortar (achada a sonda
 * que vence, as outras param). `setTimeout` comum em vez de
 * `AbortSignal.timeout`: o relógio precisa ser o mesmo dos outros timers do
 * main, e `liberar()` desarma tudo assim que a leitura termina.
 */
function sinalComPrazo(timeoutMs: number, pai?: AbortSignal): { signal: AbortSignal; liberar: () => void } {
    const controle = new AbortController()
    const abortar = () => controle.abort()
    const relogio = setTimeout(abortar, timeoutMs)
    if (pai) {
        if (pai.aborted) controle.abort()
        else pai.addEventListener('abort', abortar, { once: true })
    }
    return {
        signal: controle.signal,
        liberar: () => {
            clearTimeout(relogio)
            pai?.removeEventListener('abort', abortar)
        }
    }
}

let nodeFetchCarregando: Promise<typeof import('node-fetch').default> | null = null

/**
 * Um import() só do node-fetch, compartilhado. As leituras de descrição saem
 * em leque (a descoberta e as sondas do cadastro manual): com um import() por
 * chamada, o carregador de módulos do vitest entrega o módulo falso só ao
 * primeiro e o node-fetch DE VERDADE aos outros, que iam à rede no meio do
 * teste. Um import() compartilhado é o mesmo no app e no teste.
 */
function carregarNodeFetch(): Promise<typeof import('node-fetch').default> {
    nodeFetchCarregando ??= import('node-fetch').then(
        modulo => modulo.default,
        (erro: unknown) => {
            // Falhou o carregamento: a próxima leitura tenta de novo.
            nodeFetchCarregando = null
            throw erro
        }
    )
    return nodeFetchCarregando
}

async function enrichDeviceFromDescription(
    device: DlnaDevice,
    server?: string,
    opcoes: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<DlnaDevice> {
    // Segunda barreira: este fetch é o único que sai para uma URL que o app não
    // montou, então o esquema é conferido aqui também.
    if (!isHttpLocation(device.location)) {
        return {
            ...device,
            isSamsung: isSamsungDevice(device, server)
        }
    }

    const prazo = sinalComPrazo(opcoes.timeoutMs ?? DESCRICAO_TIMEOUT_MS, opcoes.signal)
    try {
        const fetch = await carregarNodeFetch()
        const response = await fetch(device.location, {
            signal: prazo.signal,
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
    } finally {
        prazo.liberar()
    }
}

function upsertDiscoveredDevice(device: DlnaDevice) {
    const locationHost = getHostFromLocation(device.location)
    const duplicate = Array.from(discoveredDevices.entries()).find(([, existing]) =>
        // `location` pode faltar (LOCATION ausente ou recusado): comparar dois
        // undefined daria "duplicado" e fundiria aparelhos distintos numa
        // entrada só. Só vale como igualdade quando os dois têm location.
        (Boolean(device.location) && existing.location === device.location) ||
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

interface LocalManualResolvido {
    location: string
    port: number
    isSamsung?: boolean
    /** false = nenhuma sonda respondeu: o endereço salvo é só um palpite. */
    verified: boolean
}

// D199: as sondas saíam em DOIS for aninhados com await, uma de cada vez, cada
// uma com 10 s de prazo. Com o IP errado ou a TV desligada — justamente quem
// recorre ao cadastro manual — o "Adicionar TV" ficava mudo por minutos e, no
// fim, salvava o palpite como se a TV tivesse respondido. Agora todas saem
// JUNTAS (o pior caso é o prazo de uma sonda) e "ninguém respondeu" volta com
// verified:false para a tela avisar.
//
// Quem vence continua sendo a PRIMEIRA NA ORDEM (a porta digitada, depois
// 9197...), não a mais rápida: a mesma TV costuma publicar mais de uma
// descrição UPnP (o renderizador numa porta, outros serviços em outra), e a
// corrida escolheria uma delas ao acaso — salvando um endereço sem
// AVTransport e trocando o id `manual-IP-porta` a cada cadastro. Numa TV
// ligada as portas fechadas recusam na hora, então esperar as da frente custa
// milissegundos; nunca passa do prazo de uma sonda.
async function resolveManualLocation(ip: string, port?: number): Promise<LocalManualResolvido> {
    const normalizedIp = normalizeHost(ip)
    const nomeProvisorio = `TV (${normalizedIp})`
    const candidatePorts = Array.from(new Set([port, 9197, 7676, 8001, 8080].filter(Boolean))) as number[]
    const candidatePaths = ['/dmr', '/description.xml', '/DeviceDescription.xml', '/rootDesc.xml']

    const desistir = new AbortController()
    const sondas = candidatePorts.flatMap(candidatePort => candidatePaths.map(async (path): Promise<LocalManualResolvido | null> => {
        const location = `http://${normalizedIp}:${candidatePort}${path}`
        const enriched = await enrichDeviceFromDescription({
            id: `manual-${normalizedIp}-${candidatePort}`,
            name: nomeProvisorio,
            host: normalizedIp,
            port: candidatePort,
            location
        }, undefined, { timeoutMs: SONDA_MANUAL_TIMEOUT_MS, signal: desistir.signal })

        return enriched.manufacturer || enriched.modelName || enriched.name !== nomeProvisorio
            ? { location, port: candidatePort, isSamsung: enriched.isSamsung, verified: true }
            : null
    }))

    try {
        for (const sonda of sondas) {
            const resolvido = await sonda
            if (resolvido) return resolvido
        }
    } finally {
        // Achou (ou ninguém respondeu): as sondas que ainda estão no ar param já.
        desistir.abort()
    }

    const fallbackPort = port || 9197
    return {
        location: `http://${normalizedIp}:${fallbackPort}/dmr`,
        port: fallbackPort,
        verified: false
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
            if (!resolved.verified) {
                log.warn('[DLNA] Manual device did not answer any description probe; saving best guess:', resolved.location)
            }

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
                },
                // Salvo, mas sem prova de que há uma TV ali (IP errado, TV
                // desligada ou fora da rede): a tela avisa em vez de fingir.
                unverified: !resolved.verified
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
                // `code` estavel: a tela traduz; o `error` fica de reserva (#D098).
                log.warn('[DLNA] Cast: device not found:', deviceId);
                return { success: false, code: 'device-not-found', error: 'Device not found. Please add it first.' };
            }

            const location = device.location || `http://${device.host}:${device.port || 9197}/dmr`;
            log.info('[DLNA] Connecting to:', location);

            const avTransportUrl = await getServiceControlUrl(location, AVTRANSPORT_SERVICE);
            const renderingControlUrl = await getServiceControlUrl(location, RENDERING_CONTROL_SERVICE)
                .catch(() => null);

            // A TV nova ja respondeu a descricao: agora sim o que estava
            // tocando na outra para aqui (e a conexao dela no provedor fecha
            // junto). Antes disto o cast novo ainda podia falhar e deixar o
            // dono sem nada; depois disto viriam os tokens novos, que o
            // revokeDeviceTokens do mesmo host apagaria por engano.
            await stopActiveDlnaSession(deviceId);

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
                const tToken = newProxyToken();
                pruneTokenMap(transcodeUrls, Date.now());
                transcodeUrls.set(tToken, { url: streamUrl, ...newTokenEntry(device.host) });
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
                const subToken = newProxyToken();
                pruneTokenMap(proxySubtitles, Date.now());
                proxySubtitles.set(subToken, { srt: vttToSrt(subtitleVtt), ...newTokenEntry(device.host) });
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
                deviceName: device.name || '',
                location,
                avTransportUrl,
                renderingControlUrl,
                title: title || 'Video'
            };
            // O inicio do cast abre a carencia: a TV ainda esta carregando e
            // pode dizer STOPPED/NO_MEDIA por alguns segundos.
            fimDaSessaoDlna = novoRelogioDoFimDlna(Date.now());

            return { success: true };
        } catch (error: unknown) {
            log.error('[DLNA] Cast error:', error);
            const message = getErrorMessage(error);
            let friendly = message;
            // Os textos redigidos para uma pessoa saem com um `code` estavel: a
            // tela traduz o codigo no idioma escolhido e so usa o `error` (PT-BR)
            // como reserva quando nao conhece o codigo (#D098).
            let code: 'hls-refused-704' | 'format-refused-704' | 'timeout' | undefined;
            if (/\b704\b|restrict|format not supported|not implemented/i.test(message)) {
                code = url.includes('.m3u8') ? 'hls-refused-704' : 'format-refused-704';
                friendly = code === 'hls-refused-704'
                    ? 'A TV recusou este stream HLS (erro 704). Tente um filme/série (MP4) ou reproduza localmente.'
                    : 'A TV recusou o formato deste vídeo (erro 704). O container pode não ser suportado pela TV (ex.: MKV) — tente outra versão do conteúdo.';
            } else if (/timeout/i.test(message)) {
                code = 'timeout';
                friendly = 'Tempo esgotado — verifique se a TV está ligada, na mesma rede e com DLNA habilitado.';
            }
            return code ? { success: false, code, error: friendly } : { success: false, error: friendly };
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

            const plan = planDlnaStop(castSession, device, deviceId);
            if (!plan) {
                throw new Error('Device not found');
            }

            // Calculado ANTES do finally: lá dentro o castSession já é null.
            const tokenHost = plan.from === 'session'
                ? getHostFromLocation(castSession?.location) || ''
                : device?.host || '';

            try {
                const controlUrl = plan.from === 'session'
                    ? plan.controlUrl
                    : await getServiceControlUrl(plan.location, AVTRANSPORT_SERVICE);
                await sendAvTransportAction(controlUrl, 'Stop', '<InstanceID>0</InstanceID>');
            } finally {
                // Encerramento local mesmo com o SOAP falhando: a interface
                // fecha o controle de qualquer jeito (o handleStop ignora o
                // resultado), então sem isto sobrariam ffmpeg vivos e tokens
                // de acesso válidos. O `finally` é INTERNO de propósito: só
                // roda quando havia alvo de verdade — sem plano o handler já
                // lançou lá em cima. (E o remux não é de outro protocolo: só
                // /dlna-transcode/ entra no `activeTranscodes`, e só o
                // `dlna:cast` emite token dessa rota — Chromecast e AirPlay
                // usam /dlna-proxy/, que não roda ffmpeg.)
                releaseDlnaLocalResources(tokenHost);
            }

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
            marcarComandoNaSessaoDlna();
            await sendAvTransportAction(session.avTransportUrl, 'Pause', '<InstanceID>0</InstanceID>');
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('dlna:resume', async () => {
        try {
            const session = requireSession();
            marcarComandoNaSessaoDlna();
            await sendAvTransportAction(session.avTransportUrl, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>');
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('dlna:seek', async (_, { seconds }) => {
        try {
            const session = requireSession();
            marcarComandoNaSessaoDlna();
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
            // A propria consulta pode ter ENCERRADO a sessao (o filme acabou
            // na TV, ou ela ficou muda tempo demais). Responder "sem sessao"
            // na mesma chamada faz o CastControls fechar na hora, em vez de
            // mostrar mais um STOPPED de uma sessao que ja nao existe.
            if (!castSession) throw new Error('No active cast session');
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
    // Era Math.random()+relógio: adivinhável a partir do instante do cast.
    const token = newProxyToken()
    pruneTokenMap(castSubtitles, Date.now())
    castSubtitles.set(token, { vtt, ...newTokenEntry(deviceHost) })
    return `http://${getLocalAddressForDevice(deviceHost)}:${port}/cast-sub/${token}.vtt`
}

/**
 * Fim de um cast de Chromecast/AirPlay = fim dos links que ele recebeu (o
 * resgate em loopback embrulhado por `createLanProxyUrlFor`, os segmentos que
 * a playlist dele gerou e cada legenda de `registerCastSubtitleVtt`). O proxy
 * escuta em 0.0.0.0: sem isto o link do filme e das legendas seguia valendo
 * por PROXY_TOKEN_IDLE_TTL_MS para qualquer um na LAN (D201).
 *
 * A revogação é por HOST, como a do DLNA: quem chama tem de encerrar a sessão
 * anterior ANTES de criar os tokens do cast novo, senão um segundo cast para
 * a MESMA TV revoga os próprios links (o `dlna:cast` faz o mesmo com o
 * `stopActiveDlnaSession`).
 */
export function revokeProxyTokensFor(deviceHost: string): void {
    revokeDeviceTokens(deviceHost)
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

/** Play/pausa/seek na sessao viva: reabre a carencia do fim automatico. */
function marcarComandoNaSessaoDlna(): void {
    fimDaSessaoDlna = marcarComandoDlna(Date.now())
}

/**
 * Registra uma consulta de status da sessao e, se a TV ja terminou (STOPPED/
 * NO_MEDIA continuo) ou sumiu (SOAP falhando), faz o mesmo encerramento local
 * do `dlna:stop` — sem mandar Stop: a TV ja esta parada ou nao responde.
 *
 * E o main quem tem a evidencia (as respostas SOAP): o renderer fechava so a
 * UI e a sessao ficava viva aqui pra sempre, sequestrando o controle do
 * celular. Resposta atrasada de uma sessao que ja foi trocada nao conta — nem
 * durante o carregamento de um cast novo pra MESMA TV, quando derrubar os
 * tokens daquele host apagaria os do video que esta chegando.
 *
 * `inicio` e o instante em que a consulta COMECOU (ver dlnaFimDaSessao).
 */
function observarSessaoDlna(session: CastSession, observacao: ObservacaoDlna, inicio: number): void {
    if (castSession !== session) return
    const { relogio, encerrar } = registrarObservacaoDlna(fimDaSessaoDlna, observacao, inicio)
    fimDaSessaoDlna = relogio
    if (!encerrar) return
    log.info('[DLNA] sessao encerrada sozinha:', encerrar === 'parada'
        ? 'a TV terminou/parou o video'
        : 'a TV parou de responder')
    releaseDlnaLocalResources(getHostFromLocation(session.location) || '')
}

/** Transport state + position + volume of one session (three SOAP calls). */
async function fetchDlnaSessionStatus(session: CastSession): Promise<DlnaStatusRaw> {
    const inicio = Date.now()
    let transportInfo: string
    let positionInfo: string
    try {
        [transportInfo, positionInfo] = await Promise.all([
            sendAvTransportAction(session.avTransportUrl, 'GetTransportInfo', '<InstanceID>0</InstanceID>', 5000),
            sendAvTransportAction(session.avTransportUrl, 'GetPositionInfo', '<InstanceID>0</InstanceID>', 5000),
        ])
    } catch (error: unknown) {
        observarSessaoDlna(session, { tipo: 'falha' }, inicio)
        throw error
    }
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
    const status: DlnaStatusRaw = {
        title: session.title,
        deviceName: session.deviceName,
        state: getXmlTagValue(transportInfo, 'CurrentTransportState') || 'UNKNOWN',
        position: parseUpnpTime(getXmlTagValue(positionInfo, 'RelTime')),
        duration: parseUpnpTime(getXmlTagValue(positionInfo, 'TrackDuration')),
        volume,
    }
    observarSessaoDlna(session, { tipo: 'estado', estado: status.state }, inicio)
    return status
}

/**
 * Snapshot for the phone remote's state broadcast — null when no session or
 * when the renderer stopped answering (session likely gone).
 */
export async function getDlnaStatusSnapshot(): Promise<DlnaStatusRaw | null> {
    const session = castSession
    if (!session) return null
    try {
        const status = await fetchDlnaSessionStatus(session)
        // A consulta pode ter encerrado a sessao (filme acabou na TV).
        return castSession === session ? status : null
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
    // Play/pausa e seek pelo celular tambem fazem a TV passar por STOPPED.
    if (plan.kind === 'toggle' || plan.kind === 'seekRelative') marcarComandoNaSessaoDlna()

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
                // Mesmo encerramento do dlna:stop.
                releaseDlnaLocalResources(getHostFromLocation(session.location) || '')
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
