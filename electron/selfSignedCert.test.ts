import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import https from 'node:https'
import tls from 'node:tls'
import { generateSelfSignedCert } from './selfSignedCert'

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
})
