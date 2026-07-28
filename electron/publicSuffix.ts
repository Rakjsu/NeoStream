/**
 * Domínio registrável (eTLD+1) — puro, sem I/O.
 *
 * Cortar o hostname nos dois últimos rótulos é errado fora dos gTLDs: para
 * `lista.provedor.com.br` isso devolve `com.br`, e aí QUALQUER host `*.com.br`
 * passa a ser considerado "o mesmo provedor". Como esse cálculo decide o
 * alcance do modo compatível de TLS/CORS, o erro vira bypass de segurança para
 * um sufixo público inteiro — justamente o sufixo do público-alvo deste app.
 *
 * Sem depender de uma lista pública completa (dependência nova + megabytes),
 * usamos duas regras que cobrem o mundo real: uma lista explícita dos sufixos
 * de duas partes mais usados e uma heurística de ccTLD (rótulo final de 2
 * letras + rótulo administrativo conhecido → o sufixo tem 2 partes).
 */

/** Sufixos públicos de duas partes conferidos na lista da IANA/PSL. */
const TWO_PART_SUFFIXES = new Set([
    // Brasil — o caso que motivou a correção
    'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'mil.br', 'art.br', 'adv.br',
    'esp.br', 'ind.br', 'inf.br', 'rec.br', 'srv.br', 'tv.br', 'blog.br', 'app.br',
    'dev.br', 'eco.br', 'tur.br', 'jus.br', 'leg.br', 'nom.br', 'agr.br', 'am.br',
    'fm.br', 'emp.br', 'eng.br', 'etc.br', 'far.br', 'imb.br', 'jor.br', 'med.br',
    'not.br', 'ntr.br', 'odo.br', 'ppg.br', 'psi.br', 'qsl.br', 'radio.br', 'teo.br',
    'trd.br', 'vet.br', 'vlog.br', 'wiki.br', 'coop.br', 'g12.br', 'bio.br', 'cnt.br',
    // Reino Unido
    'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk',
    'gov.uk', 'nhs.uk', 'police.uk', 'mod.uk',
    // Austrália / Nova Zelândia / África do Sul
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
    'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'geek.nz', 'kiwi.nz',
    'co.za', 'net.za', 'org.za', 'gov.za', 'web.za',
    // Japão / Coreia / Índia
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'ad.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp',
    'co.kr', 'or.kr', 'ne.kr', 'go.kr', 're.kr', 'pe.kr',
    'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'gov.in',
    // América Latina / Península Ibérica
    'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'edu.ar',
    'com.mx', 'net.mx', 'org.mx', 'gob.mx', 'edu.mx',
    'com.co', 'net.co', 'org.co', 'com.pe', 'com.ve', 'com.uy', 'com.ec',
    'com.bo', 'com.py', 'com.pt', 'edu.pt', 'gov.pt', 'org.pt', 'net.pt',
    'com.es', 'org.es', 'nom.es', 'gob.es', 'edu.es',
    // Outros comuns
    'com.tr', 'net.tr', 'org.tr', 'gen.tr', 'com.pl', 'net.pl', 'org.pl',
    'com.ru', 'net.ru', 'org.ru', 'com.ua', 'com.cn', 'net.cn', 'org.cn',
    'gov.cn', 'edu.cn', 'com.hk', 'com.tw', 'com.sg', 'com.my', 'co.id',
    'com.ph', 'co.th', 'com.vn', 'co.il', 'com.sa', 'com.eg', 'com.ng',
    'co.ke', 'com.gh', 'com.pk', 'com.bd', 'com.np', 'co.at', 'or.at', 'ac.at',
])

/**
 * Rótulos administrativos que, sob um ccTLD de duas letras, formam sufixo
 * público. Rede de segurança para os ccTLDs que não estão na lista acima.
 */
const ADMIN_LABELS = new Set([
    'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'co', 'ac', 'or', 'ne',
    'go', 'ad', 'ed', 'sc', 'gr', 'lg', 're', 'pe', 'gob', 'govt', 'nom',
    'asn', 'id', 'sch', 'res', 'ltd', 'plc', 'web', 'info', 'biz', 'gen',
    'firm', 'ind', 'priv', 'k12',
])

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** Minúsculas, sem ponto final e sem colchetes de IPv6. */
export function normalizeHostname(hostname: string): string {
    const trimmed = String(hostname || '').trim().toLowerCase().replace(/\.$/, '')
    return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed
}

/** Literal de endereço (IPv4/IPv6) — não tem domínio registrável. */
export function isIpLiteral(hostname: string): boolean {
    const host = normalizeHostname(hostname)
    return IPV4.test(host) || host.includes(':')
}

/** Quantos rótulos finais formam o sufixo público de `parts`. */
function publicSuffixLength(parts: string[]): number {
    if (parts.length < 2) return parts.length
    const lastTwo = parts.slice(-2).join('.')
    if (TWO_PART_SUFFIXES.has(lastTwo)) return 2
    const [secondLast, last] = parts.slice(-2)
    if (last.length === 2 && ADMIN_LABELS.has(secondLast)) return 2
    return 1
}

/**
 * O hostname é ele mesmo um sufixo público (`com.br`, `co.uk`, `com`)? Nesse
 * caso não existe domínio registrável e nada pode "casar" por parentesco.
 */
export function isPublicSuffix(hostname: string): boolean {
    const host = normalizeHostname(hostname)
    if (!host || isIpLiteral(host)) return false
    const parts = host.split('.').filter(Boolean)
    return parts.length > 0 && parts.length <= publicSuffixLength(parts)
}

/**
 * Domínio registrável (sufixo público + um rótulo). Literais de IP, `localhost`
 * e hostnames de rótulo único voltam como estão.
 */
export function getRegistrableDomain(hostname: string): string {
    const host = normalizeHostname(hostname)
    if (!host || isIpLiteral(host)) return host

    const parts = host.split('.').filter(Boolean)
    if (parts.length <= 1) return host

    const suffixLength = publicSuffixLength(parts)
    if (parts.length <= suffixLength) return host

    return parts.slice(-(suffixLength + 1)).join('.')
}

/**
 * Dois hostnames pertencem ao MESMO dono? Sufixo público puro dos dois lados
 * nunca casa — senão `provedor.com.br` seria "parente" de `banco.com.br`.
 */
export function isSameRegistrableDomain(a: string, b: string): boolean {
    const hostA = normalizeHostname(a)
    const hostB = normalizeHostname(b)
    if (!hostA || !hostB) return false
    if (hostA === hostB) return true
    if (isIpLiteral(hostA) || isIpLiteral(hostB)) return false
    if (isPublicSuffix(hostA) || isPublicSuffix(hostB)) return false

    return getRegistrableDomain(hostA) === getRegistrableDomain(hostB)
}
