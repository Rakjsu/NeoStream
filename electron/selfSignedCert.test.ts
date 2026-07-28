import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import https from 'node:https'
import tls from 'node:tls'
import {
    generateSelfSignedCert,
    shouldReuseStoredCert,
    mergeCertAltNames,
    CERT_RENEW_BEFORE_MS,
    type StoredSelfSignedCert,
} from './selfSignedCert'

const NOW = 1_700_000_000_000 // fixed timestamp

describe('generateSelfSignedCert', () => {
    it('produz um X.509 que o parser do Node aceita', () => {
        const { cert, key } = generateSelfSignedCert(NOW, { commonName: 'NeoStream Test' })
        expect(key).toContain('BEGIN PRIVATE KEY')
        const x509 = new crypto.X509Certificate(cert)
        expect(x509.subject).toContain('CN=NeoStream Test')
        expect(x509.issuer).toContain('CN=NeoStream Test') // self-signed
        // Validity window straddles NOW.
        expect(new Date(x509.validFrom).getTime()).toBeLessThanOrEqual(NOW)
        expect(new Date(x509.validTo).getTime()).toBeGreaterThan(NOW)
    })

    it('inclui os altNames no subjectAltName (IP + DNS)', () => {
        const { cert } = generateSelfSignedCert(NOW, {
            commonName: '192.168.0.5',
            altNames: ['192.168.0.5', '127.0.0.1', 'localhost'],
        })
        const x509 = new crypto.X509Certificate(cert)
        // Node renders SAN like "IP Address:192.168.0.5, DNS:localhost".
        expect(x509.subjectAltName).toContain('192.168.0.5')
        expect(x509.subjectAltName).toContain('127.0.0.1')
        expect(x509.subjectAltName).toContain('localhost')
    })

    it('faz um handshake TLS real (o par chave/cert é coerente)', async () => {
        const { cert, key } = generateSelfSignedCert(NOW)
        const server = https.createServer({ cert, key }, (_req, res) => { res.end('ok') })
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        const port = (server.address() as { port: number }).port
        try {
            const body = await new Promise<string>((resolve, reject) => {
                const req = https.get(
                    { host: '127.0.0.1', port, path: '/', rejectUnauthorized: false },
                    (res) => {
                        let data = ''
                        res.on('data', (c) => { data += c })
                        res.on('end', () => resolve(data))
                    },
                )
                req.on('error', reject)
            })
            expect(body).toBe('ok')
        } finally {
            server.close()
        }
    })

    it('a chave privada assina algo verificável com o cert', () => {
        const { cert, key } = generateSelfSignedCert(NOW)
        const data = Buffer.from('neostream')
        const sig = crypto.sign('sha256', data, key)
        const pub = new crypto.X509Certificate(cert).publicKey
        expect(crypto.verify('sha256', data, pub, sig)).toBe(true)
    })

    it('o cert TLS bate quando um socket seguro conecta', async () => {
        const { cert, key } = generateSelfSignedCert(NOW, { commonName: 'lan-remote' })
        const server = tls.createServer({ cert, key }, (socket) => { socket.end('hi') })
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        const port = (server.address() as { port: number }).port
        try {
            const peerCN = await new Promise<string>((resolve, reject) => {
                const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
                    const peer = socket.getPeerCertificate()
                    socket.destroy()
                    resolve(peer.subject?.CN ?? '')
                })
                socket.on('error', reject)
            })
            expect(peerCN).toBe('lan-remote')
        } finally {
            server.close()
        }
    })

    it('devolve o notAfter que casa com o cert emitido', () => {
        const { cert, notAfter } = generateSelfSignedCert(NOW, { validityDays: 30 })
        expect(notAfter).toBe(NOW + 30 * 24 * 60 * 60 * 1000)
        // UTCTime tem resolução de 1 s — comparação com folga.
        const validTo = new Date(new crypto.X509Certificate(cert).validTo).getTime()
        expect(Math.abs(validTo - notAfter)).toBeLessThan(1000)
    })
})

describe('shouldReuseStoredCert (reaproveitar x regerar)', () => {
    const WANTED = ['192.168.0.5', '127.0.0.1', 'localhost']
    const stored = (over: Partial<StoredSelfSignedCert> = {}): Partial<StoredSelfSignedCert> => ({
        key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n',
        cert: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n',
        altNames: [...WANTED],
        notAfter: NOW + 365 * 24 * 60 * 60 * 1000,
        ...over,
    })

    it('reaproveita o cert da sessão anterior — é isso que torna o TOFU possível', () => {
        expect(shouldReuseStoredCert(stored(), NOW, WANTED)).toBe(true)
    })

    it('reaproveita quando o SAN gravado cobre mais nomes que os desta sessão', () => {
        const wide = stored({ altNames: ['10.0.0.4', '192.168.0.5', '127.0.0.1', 'localhost'] })
        expect(shouldReuseStoredCert(wide, NOW, WANTED)).toBe(true)
    })

    it('regenera quando não há nada gravado ou o arquivo está truncado', () => {
        expect(shouldReuseStoredCert(null, NOW, WANTED)).toBe(false)
        expect(shouldReuseStoredCert({}, NOW, WANTED)).toBe(false)
        expect(shouldReuseStoredCert(stored({ key: 'lixo' }), NOW, WANTED)).toBe(false)
        expect(shouldReuseStoredCert(stored({ cert: '' }), NOW, WANTED)).toBe(false)
    })

    it('regenera quando o cert venceu ou está na janela de renovação', () => {
        expect(shouldReuseStoredCert(stored({ notAfter: NOW - 1 }), NOW, WANTED)).toBe(false)
        expect(shouldReuseStoredCert(stored({ notAfter: NOW + CERT_RENEW_BEFORE_MS }), NOW, WANTED)).toBe(false)
        expect(shouldReuseStoredCert(stored({ notAfter: NOW + CERT_RENEW_BEFORE_MS + 1 }), NOW, WANTED)).toBe(true)
        expect(shouldReuseStoredCert(stored({ notAfter: Number.NaN }), NOW, WANTED)).toBe(false)
    })

    it('regenera quando o IP da LAN mudou e o SAN não cobre mais o host', () => {
        // Sem isso o celular recusaria o cert: o navegador valida o host no SAN.
        expect(shouldReuseStoredCert(stored(), NOW, ['10.0.0.9', '127.0.0.1', 'localhost'])).toBe(false)
    })
})

describe('mergeCertAltNames', () => {
    it('acumula as redes já vistas, sem duplicar, com a atual na frente', () => {
        expect(mergeCertAltNames(['10.0.0.4', '127.0.0.1', 'localhost'], ['192.168.0.5', '127.0.0.1', 'localhost']))
            .toEqual(['192.168.0.5', '127.0.0.1', 'localhost', '10.0.0.4'])
    })

    it('limita o acúmulo ao teto e nunca perde os nomes desta sessão', () => {
        const previous = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5', '6.6.6.6']
        const merged = mergeCertAltNames(previous, ['192.168.0.5', '127.0.0.1', 'localhost'], 5)
        expect(merged).toEqual(['192.168.0.5', '127.0.0.1', 'localhost', '1.1.1.1', '2.2.2.2'])
    })

    it('funciona sem nada gravado antes', () => {
        expect(mergeCertAltNames(undefined, ['192.168.0.5'])).toEqual(['192.168.0.5'])
    })
})
