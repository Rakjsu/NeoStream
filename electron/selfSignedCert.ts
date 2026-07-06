/**
 * Self-signed X.509 certificate, built from scratch — same from-scratch spirit
 * as the DLNA SOAP, castv2 and WebSocket code: no `selfsigned`/`node-forge`
 * dependency. Node's crypto generates the RSA key and does the signing; the
 * X.509 DER (a tiny fixed ASN.1 shape) is hand-encoded here.
 *
 * Used only for the OPT-IN https mode of the phone web remote on the LAN. The
 * phone shows a one-time "not trusted" prompt (expected for a self-signed cert);
 * the point is wire encryption, not a public CA chain.
 */

import crypto from 'node:crypto'

// ------------------------------------------------------------------ ASN.1 --

/** DER length octets for a given content length. */
function derLength(len: number): number[] {
    if (len < 0x80) return [len]
    const bytes: number[] = []
    let n = len
    while (n > 0) { bytes.unshift(n & 0xff); n >>= 8 }
    return [0x80 | bytes.length, ...bytes]
}

/** A DER TLV: tag + length + content. */
function der(tag: number, content: number[]): number[] {
    return [tag, ...derLength(content.length), ...content]
}

function seq(...parts: number[][]): number[] { return der(0x30, parts.flat()) }
function set(content: number[]): number[] { return der(0x31, content) }

/** DER INTEGER from a positive byte array (adds a leading 0 if high bit set). */
function integer(bytes: number[]): number[] {
    const trimmed = [...bytes]
    while (trimmed.length > 1 && trimmed[0] === 0x00 && (trimmed[1] & 0x80) === 0) trimmed.shift()
    if (trimmed[0] & 0x80) trimmed.unshift(0x00)
    return der(0x02, trimmed)
}

function intFromNumber(value: number): number[] {
    const bytes: number[] = []
    let n = value
    do { bytes.unshift(n & 0xff); n = Math.floor(n / 256) } while (n > 0)
    return integer(bytes)
}

/** DER OBJECT IDENTIFIER from a dotted string. */
function oid(dotted: string): number[] {
    const parts = dotted.split('.').map(Number)
    const body: number[] = [parts[0] * 40 + parts[1]]
    for (let i = 2; i < parts.length; i++) {
        let v = parts[i]
        const chunk: number[] = [v & 0x7f]
        v = Math.floor(v / 128)
        while (v > 0) { chunk.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128) }
        body.push(...chunk)
    }
    return der(0x06, body)
}

function utf8(text: string): number[] { return der(0x0c, [...Buffer.from(text, 'utf-8')]) }

/** UTCTime "YYMMDDHHMMSSZ". */
function utcTime(date: Date): number[] {
    const p = (n: number) => String(n).padStart(2, '0')
    const s = `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`
        + `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
    return der(0x17, [...Buffer.from(s, 'ascii')])
}

const OID_SHA256_RSA = '1.2.840.113549.1.1.11'
const OID_COMMON_NAME = '2.5.4.3'
const OID_SUBJECT_ALT_NAME = '2.5.29.17'
const OID_BASIC_CONSTRAINTS = '2.5.29.19'

/** AlgorithmIdentifier { sha256WithRSAEncryption, NULL }. */
function sha256RsaAlg(): number[] {
    return seq(oid(OID_SHA256_RSA), der(0x05, [])) // 0x05 00 = NULL
}

/** Name = SEQ( SET( SEQ( OID(CN), UTF8String(cn) ) ) ). */
function nameCN(cn: string): number[] {
    return seq(set(seq(oid(OID_COMMON_NAME), utf8(cn))))
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** One GeneralName: IP → [7] 4 octets, otherwise DNS → [2] IA5String. */
function generalName(name: string): number[] {
    const m = name.match(IPV4_RE)
    if (m) return der(0x87, [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]) // [7] iPAddress
    return der(0x82, [...Buffer.from(name, 'ascii')]) // [2] dNSName
}

/**
 * subjectAltName extension (non-critical): browsers (esp. Chrome/Android)
 * validate the host against the SAN, not the CN — without it they reject the
 * cert outright, so the "accept once" flow never even appears.
 */
function sanExtension(altNames: string[]): number[] {
    const names = seq(...altNames.map(generalName))
    return seq(oid(OID_SUBJECT_ALT_NAME), der(0x04, names)) // Extension: OID + OCTET STRING(DER)
}

/** basicConstraints (critical): cA = FALSE (empty SEQUENCE defaults cA false). */
function basicConstraintsExtension(): number[] {
    return seq(oid(OID_BASIC_CONSTRAINTS), der(0x01, [0xff]), der(0x04, seq())) // OID + critical TRUE + OCTET STRING(SEQ{})
}

// ---------------------------------------------------------------- builder --

export interface SelfSignedResult {
    /** PEM private key (PKCS#8). */
    key: string
    /** PEM certificate. */
    cert: string
}

/**
 * Generate a fresh 2048-bit RSA key and a self-signed cert valid from `now`
 * for `validityDays`. `commonName` goes in both issuer and subject; `altNames`
 * (IPs and/or DNS names) become the subjectAltName so browsers accept the host.
 */
export function generateSelfSignedCert(
    now: number,
    { commonName = 'NeoStream', validityDays = 3650, altNames = [] as string[] }:
        { commonName?: string; validityDays?: number; altNames?: string[] } = {},
): SelfSignedResult {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })

    // The SPKI DER *is* the X.509 SubjectPublicKeyInfo — reuse it verbatim.
    const spki = [...publicKey.export({ type: 'spki', format: 'der' })]

    const notBefore = new Date(now - 60_000) // 1 min skew
    const notAfter = new Date(now + validityDays * 24 * 60 * 60 * 1000)

    // A random 16-byte positive serial.
    const serial = [...crypto.randomBytes(16)]
    serial[0] &= 0x7f

    // v3 extensions: SAN (when host names given) + basicConstraints(cA=false).
    const extensionList = [basicConstraintsExtension()]
    if (altNames.length > 0) extensionList.push(sanExtension(altNames))
    const extensions = der(0xa3, seq(...extensionList)) // [3] EXPLICIT Extensions

    const tbs = seq(
        der(0xa0, intFromNumber(2)),   // [0] version = v3 (INTEGER 2)
        integer(serial),
        sha256RsaAlg(),                // signature algorithm
        nameCN(commonName),            // issuer
        seq(utcTime(notBefore), utcTime(notAfter)), // validity
        nameCN(commonName),            // subject
        spki,                          // subjectPublicKeyInfo (raw DER)
        extensions,                    // [3] extensions
    )

    const signature = crypto.sign('sha256', Buffer.from(tbs), privateKey)
    const signatureBits = der(0x03, [0x00, ...signature]) // BIT STRING (0 unused bits)

    const certDer = seq(tbs, sha256RsaAlg(), signatureBits)
    const certPem = toPem(Buffer.from(certDer), 'CERTIFICATE')
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

    return { key: keyPem, cert: certPem }
}

function toPem(der: Buffer, label: string): string {
    const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n').trim()
    return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`
}
