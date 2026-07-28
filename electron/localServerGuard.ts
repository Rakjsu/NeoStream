/**
 * 🛡️ Guarda de Host/Origin dos servidores locais — parte PURA.
 *
 * O adversário aqui não é o vizinho de Wi-Fi: é o navegador do próprio dono.
 * Uma aba qualquer alcança `127.0.0.1` e a faixa da LAN, o WebSocket ignora
 * CORS por construção e um `POST` de `text/plain` é "simple request" (vai sem
 * preflight). Duas checagens fecham a classe inteira:
 *
 * - **Host**: bloqueia DNS rebinding. O navegador monta o `Host` a partir do
 *   que está na barra de endereço, e ele NÃO muda quando o DNS re-resolve —
 *   `http://evil.com:8974/` chega com `Host: evil.com:8974` mesmo depois do
 *   rebind pro IP da vítima. Como todo cliente real do app chega por IP
 *   literal (o QR e a descoberta na /24 usam o IP) ou por `localhost`, exigir
 *   isso mata o rebinding sem tocar em ninguém legítimo.
 * - **Origin**: bloqueia a página de terceiro que fala direto com o IP. Só a
 *   origem do próprio servidor passa.
 *
 * Testado em localServerGuard.test.ts.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

interface Authority {
    hostname: string
    /** null quando o Host veio sem porta (porta implícita do esquema). */
    port: string | null
}

/** Quebra `host[:porta]` (com IPv6 entre colchetes), ou null se malformado. */
function splitAuthority(value: string): Authority | null {
    const raw = value.trim()
    if (!raw) return null
    if (raw.startsWith('[')) {
        const end = raw.indexOf(']')
        if (end < 0) return null
        const hostname = raw.slice(0, end + 1)
        const rest = raw.slice(end + 1)
        if (!rest) return { hostname, port: null }
        if (!rest.startsWith(':')) return null
        return { hostname, port: rest.slice(1) }
    }
    const colon = raw.indexOf(':')
    if (colon < 0) return { hostname: raw, port: null }
    // Dois-pontos repetido sem colchete é IPv6 cru: não é Host válido.
    if (raw.indexOf(':', colon + 1) >= 0) return null
    return { hostname: raw.slice(0, colon), port: raw.slice(colon + 1) }
}

/** IP literal (v4 ou v6 entre colchetes) ou `localhost` — nunca um domínio. */
export function isIpLiteralOrLocalhost(hostname: string): boolean {
    const name = hostname.toLowerCase()
    if (name === 'localhost') return true
    if (name.startsWith('[') && name.endsWith(']')) {
        const inner = name.slice(1, -1)
        return inner.length > 0 && /^[0-9a-f:.%]+$/.test(inner)
    }
    const match = IPV4.exec(name)
    if (!match) return false
    return match.slice(1).every(part => Number(part) <= 255)
}

/**
 * Host aceitável pro servidor que escuta em `expectedPort`.
 * `expectedPort` null/0 = ainda não se sabe a porta: confere só o hostname.
 */
export function isAllowedHost(host: string | undefined, expectedPort: number | null): boolean {
    // Host ausente é cliente que não é navegador (HTTP/1.0, renderers DLNA
    // antigos). O rebinding SEMPRE chega com um domínio no Host, então recusar
    // a ausência não fecharia nada e quebraria cliente legítimo.
    if (host === undefined || host === '') return true
    const parsed = splitAuthority(host)
    if (!parsed) return false
    if (!isIpLiteralOrLocalhost(parsed.hostname)) return false
    if (parsed.port === null) return true
    if (!/^\d+$/.test(parsed.port)) return false
    if (!expectedPort) return true
    return Number(parsed.port) === expectedPort
}

/**
 * Origin aceitável: ausente (cliente nativo) ou exatamente a origem do próprio
 * servidor, comparada contra o `Host` que a requisição trouxe.
 *
 * O app do celular não manda Origin no Android (okhttp) e, no iOS, manda a
 * origem do próprio servidor — os dois casos passam. `null` (origem opaca de
 * `<iframe sandbox>` / `data:`) é recusado de propósito: nenhum cliente do
 * controle produz isso, e aceitá-lo devolveria o buraco inteiro a quem sabe
 * escrever um iframe.
 */
export function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
    if (origin === undefined) return true
    if (host === undefined || host === '') return false
    let parsed: URL
    try {
        parsed = new URL(origin)
    } catch {
        return false // inclui a string 'null'
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const defaultPort = parsed.protocol === 'https:' ? '443' : '80'
    const hostParts = splitAuthority(host)
    if (!hostParts) return false
    const originKey = `${parsed.hostname.toLowerCase()}:${parsed.port || defaultPort}`
    const hostKey = `${hostParts.hostname.toLowerCase()}:${hostParts.port ?? defaultPort}`
    return originKey === hostKey
}

export type LocalRequestVerdict = 'ok' | 'bad-host' | 'bad-origin'

/** Veredito único usado pelo handler HTTP e pelo upgrade do WebSocket. */
export function localRequestVerdict(
    host: string | undefined,
    origin: string | undefined,
    expectedPort: number | null,
): LocalRequestVerdict {
    if (!isAllowedHost(host, expectedPort)) return 'bad-host'
    if (!isAllowedOrigin(origin, host)) return 'bad-origin'
    return 'ok'
}

/**
 * Origens que o PRÓPRIO app usa nos servidores de loopback (timeshift e
 * transcode de resgate): a build empacotada carrega o renderer de `file://`,
 * cuja origem é opaca e chega serializada como `null`; em dev, vem do servidor
 * do Vite. Qualquer outra é página de terceiro varrendo a faixa efêmera.
 *
 * Aqui o `null` PRECISA passar (é o app), então o segredo que sobra é o caminho
 * — por isso o buffer e a sessão de transcode vivem sob um token aleatório.
 */
export function isAppOwnOrigin(origin: string | undefined, devServerOrigin?: string): boolean {
    if (origin === undefined) return true
    if (origin === 'null' || origin === 'file://') return true
    if (!devServerOrigin) return false
    try {
        return new URL(origin).origin === new URL(devServerOrigin).origin
    } catch {
        return false
    }
}
