/**
 * Guardas puras do proxy DLNA: validade dos tokens, confinamento de destino
 * (SSRF) e teto de remuxes simultâneos. Sem sockets, sem estado e sem
 * Electron — dlnaHandlers.ts apenas aplica o que é decidido aqui.
 *
 * Por que não existe autenticação de verdade: a TV é um cliente burro — não
 * manda header customizado, não autentica, e o token do caminho viaja até ela
 * dentro do SOAP em texto claro. Sobra o que não depende da TV cooperar:
 * token imprevisível, validade curta por inatividade e limite de PARA ONDE o
 * proxy aceita buscar.
 */

import { randomUUID } from 'node:crypto'

/**
 * Um token morre depois desta janela SEM USO — cada acerto o renova. Validade
 * absoluta quebraria filme longo; por inatividade a TV que está tocando
 * renova sozinha (segmentos HLS, ranges, reconexões) e o token capturado no
 * SOAP vira pó pouco depois do cast acabar.
 */
export const PROXY_TOKEN_IDLE_TTL_MS = 2 * 60 * 60 * 1000

/** Remuxes de ffmpeg simultâneos que o /dlna-transcode/ aceita. */
export const MAX_CONCURRENT_TRANSCODES = 3

/** Saltos de redirecionamento que o proxy segue antes de desistir. */
export const MAX_PROXY_REDIRECTS = 5

export interface ProxyTokenEntry {
    /** Host do aparelho que recebeu este token (revogação por sessão de cast). */
    deviceHost: string
    createdAt: number
    lastUsedAt: number
    /** Requisições servindo este token agora (filme de 3h é UM pedido só). */
    inFlight?: number
}

/** Token de caminho: imprevisível por construção (nada derivado do relógio). */
export function newProxyToken(): string {
    return randomUUID()
}

export function isTokenValid(
    entry: { lastUsedAt: number; inFlight?: number } | undefined,
    now: number,
    ttlMs: number = PROXY_TOKEN_IDLE_TTL_MS
): boolean {
    if (!entry) return false
    // Enquanto o pedido está sendo servido o token não vence: um remux de 3h
    // não volta ao lookup e a TV precisa poder reconectar depois dele.
    if ((entry.inFlight ?? 0) > 0) return true
    return now - entry.lastUsedAt <= ttlMs
}

/** Tokens emitidos para um aparelho — o que morre quando aquele cast para. */
export function tokensToRevoke<T extends { deviceHost: string }>(
    entries: Iterable<[string, T]>,
    deviceHost: string
): string[] {
    const target = normalizeHost(deviceHost)
    if (!target) return []
    const revoked: string[] = []
    for (const [token, entry] of entries) {
        if (normalizeHost(entry.deviceHost) === target) revoked.push(token)
    }
    return revoked
}

/** Acima do teto o pedido é recusado na hora (503), nunca enfileirado. */
export function canAcceptTranscode(activeCount: number, max: number = MAX_CONCURRENT_TRANSCODES): boolean {
    return activeCount < max
}

// ---- Confinamento de destino (SSRF) ---------------------------------------

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function normalizeHost(host: string | undefined | null): string {
    return (host || '').trim().replace(/^\[|\]$/g, '').toLowerCase()
}

function ipv4Octets(host: string): number[] | null {
    const match = IPV4.exec(host)
    if (!match) return null
    const octets = match.slice(1).map(Number)
    return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null
}

/** localhost, 127.0.0.0/8, ::1, 0.0.0.0 — onde vivem os servidores do app. */
export function isLoopbackHost(host: string): boolean {
    const normalized = normalizeHost(host)
    if (!normalized) return false
    if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true
    if (normalized.includes(':')) return normalized === '::1' || normalized === '::'
    const octets = ipv4Octets(normalized)
    if (!octets) return false
    return octets[0] === 127 || octets[0] === 0
}

/** Faixas que só existem dentro da rede do usuário (LAN, link-local, CGNAT). */
export function isPrivateHost(host: string): boolean {
    const normalized = normalizeHost(host)
    if (!normalized) return false
    // Só trata prefixo IPv6 quando é literal IPv6: senão "fcbarcelona.com" cairia aqui.
    if (normalized.includes(':')) return /^fe[89ab]/.test(normalized) || /^f[cd]/.test(normalized)
    const octets = ipv4Octets(normalized)
    if (!octets) return false
    const [a, b] = octets
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true // link-local, inclui 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast e reservado
    return false
}

/** Mesma simplificação de certificatePolicy: últimos dois rótulos do host. */
function registrableDomain(host: string): string {
    if (!host || host === 'localhost' || IPV4.test(host)) return host
    const parts = host.split('.').filter(Boolean)
    if (parts.length <= 2) return host
    return parts.slice(-2).join('.')
}

function hostOf(url: string): string {
    try {
        return normalizeHost(new URL(url).hostname)
    } catch {
        return ''
    }
}

function isProviderHost(host: string, baseHost: string, providerHosts: string[]): boolean {
    if (baseHost && host === baseHost) return true
    const allowed = providerHosts.map(normalizeHost).filter(Boolean)
    if (allowed.includes(host)) return true
    const domain = registrableDomain(host)
    if (baseHost && registrableDomain(baseHost) === domain) return true
    return allowed.some((allowedHost) => registrableDomain(allowedHost) === domain)
}

export type ProxyTargetVerdict =
    /** O desktop busca e reescreve (destino pertence ao provedor). */
    | 'proxy'
    /** Sai na playlist como veio: a TV busca direto, o desktop não vira SSRF. */
    | 'passthrough'
    /** Nem proxy nem entrega à TV — a TV também alcança a LAN. */
    | 'block'

/**
 * Para onde o proxy aceita buscar uma URI vinda da playlist do provedor.
 *
 * Interno (loopback/LAN/link-local) só passa quando é o próprio host que
 * serviu a playlist — provedor rodando na LAN do usuário é caso real; o resto
 * é o roteador, o NAS e os servidores de loopback do próprio app. Host
 * público de terceiro não é buscado pelo desktop (some o SSRF) mas continua
 * chegando à TV, que resolve sozinha — CDN de provedor não pode parar de tocar.
 */
export function classifyProxyTarget(
    candidateUrl: string,
    baseUrl: string,
    providerHosts: string[] = []
): ProxyTargetVerdict {
    let candidate: URL
    try {
        candidate = new URL(candidateUrl)
    } catch {
        return 'passthrough'
    }
    if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') return 'passthrough'

    const baseHost = hostOf(baseUrl)
    const host = normalizeHost(candidate.hostname)
    if (!host) return 'block'
    if (isLoopbackHost(host)) return 'block'
    if (isPrivateHost(host)) return host === baseHost ? 'proxy' : 'block'
    if (isProviderHost(host, baseHost, providerHosts)) return 'proxy'
    return 'passthrough'
}

/** Atalho booleano: o desktop pode buscar este destino? */
export function isProxyTargetAllowed(
    candidateUrl: string,
    baseUrl: string,
    providerHosts: string[] = []
): boolean {
    return classifyProxyTarget(candidateUrl, baseUrl, providerHosts) === 'proxy'
}

export type RedirectPlan =
    | { kind: 'stop' }
    | { kind: 'follow'; url: string }
    | { kind: 'block'; reason: string }

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Seguir um 302 do provedor para 127.0.0.1 ou para a LAN recria a SSRF com o
 * IP confiável do desktop, então esses saltos morrem aqui. Público segue
 * liberado: balanceador e CDN de IPTV redirecionam o tempo todo.
 */
export function planUpstreamRedirect(
    currentUrl: string,
    status: number,
    location: string | null | undefined
): RedirectPlan {
    if (!REDIRECT_STATUSES.has(status) || !location) return { kind: 'stop' }

    let target: URL
    try {
        target = new URL(location, currentUrl)
    } catch {
        return { kind: 'block', reason: 'Location invalido' }
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return { kind: 'block', reason: 'esquema nao suportado' }
    }

    const currentHost = hostOf(currentUrl)
    const host = normalizeHost(target.hostname)
    if (isLoopbackHost(host)) return { kind: 'block', reason: 'destino em loopback' }
    if (isPrivateHost(host) && host !== currentHost) return { kind: 'block', reason: 'destino em rede privada' }
    return { kind: 'follow', url: target.toString() }
}
