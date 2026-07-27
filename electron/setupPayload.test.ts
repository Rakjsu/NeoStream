import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
    buildSealedSetupDeepLink,
    buildSetupDeepLink,
    buildSetupQrUrl,
    consumeSetupTicket,
    issueSetupTicket,
    renderSetupExpiredPage,
    renderSetupHandoffPage,
    resetSetupTickets,
    SETUP_ENVELOPE_VERSION,
    SETUP_QR_MAX_BYTES,
} from './setupPayload'

describe('buildSetupDeepLink (formato do NeoStream Mobile)', () => {
    it('gera neostream://setup?d=base64(JSON) com contas e activeId', () => {
        const link = buildSetupDeepLink([
            { id: 'p1', name: 'Casa', url: 'http://host:8080', username: 'user', password: 'pw', type: 'xtream' },
            { id: 'p2', name: 'Lista', url: 'http://x/lista.m3u', username: '', password: '', type: 'm3u' },
            { id: 'p3', name: 'Portal', url: 'http://portal/c/', username: '00:1A:79:AA:BB:CC', password: '', type: 'stalker' },
        ], 'p1')

        expect(link.startsWith('neostream://setup?d=')).toBe(true)
        const d = decodeURIComponent(link.slice('neostream://setup?d='.length))
        const payload = JSON.parse(Buffer.from(d, 'base64').toString('utf8'))
        expect(payload.activeId).toBe('p1')
        expect(payload.accounts).toHaveLength(3)
        expect(payload.accounts[0]).toMatchObject({
            id: 'p1', url: 'http://host:8080', username: 'user', password: 'pw', type: 'xtream', alias: 'Casa'
        })
        expect(payload.accounts[1].type).toBe('m3u')
        expect(payload.accounts[2].type).toBe('stalker')
    })

    it('pula entradas sem URL e cai pro tipo xtream por padrão', () => {
        const link = buildSetupDeepLink([
            { id: 'a', name: '', url: '   ', username: 'u', password: 'p' },
            { id: 'b', name: 'B', url: 'http://b', username: 'u', password: 'p' },
        ], null)
        const d = decodeURIComponent(link.split('d=')[1])
        const payload = JSON.parse(Buffer.from(d, 'base64').toString('utf8'))
        expect(payload.accounts).toHaveLength(1)
        expect(payload.accounts[0].type).toBe('xtream')
        expect(payload.activeId).toBeNull()
    })
})

describe('renderSetupHandoffPage', () => {
    it('embute o deep link no botão e no redirect automático', () => {
        const html = renderSetupHandoffPage('neostream://setup?d=abc123', 'pt')
        expect(html).toContain('href="neostream://setup?d=abc123"')
        expect(html).toContain('var base = "neostream://setup?d=abc123"')
        expect(html).toContain('Abrir no NeoStream')
    })

    it('respeita o idioma do app', () => {
        expect(renderSetupHandoffPage('neostream://setup?d=x', 'en')).toContain('Open in NeoStream')
        expect(renderSetupHandoffPage('neostream://setup?d=x', 'es')).toContain('Abrir en NeoStream')
    })
})

// 🔒 Regressão (auditoria R3): o QR levava o PIN na própria URL e a página
// devolvia TODAS as senhas em base64 puro — quem fotografasse a tela ou
// farejasse a LAN levava as credenciais, e o link valia pra sempre.
describe('QR de configuração selado', () => {
    const playlists = [
        { id: 'p1', name: 'Casa', url: 'http://host:8080', username: 'user', password: 'senha-secreta', type: 'xtream' as const },
    ]

    /** Mesma construção do celular (crypto-js): SHA-256 rotulado + AES-CBC + HMAC. */
    const unseal = (link: string, key: string) => {
        const envelope = JSON.parse(
            Buffer.from(decodeURIComponent(link.split('?e=')[1]), 'base64').toString('utf8'),
        ) as { v: number; iv: string; ct: string; mac: string }
        const raw = Buffer.from(key, 'base64url')
        const derive = (label: string) =>
            crypto.createHash('sha256').update(Buffer.concat([raw, Buffer.from(label, 'utf8')])).digest()
        const iv = Buffer.from(envelope.iv, 'base64')
        const ct = Buffer.from(envelope.ct, 'base64')
        const mac = crypto.createHmac('sha256', derive('neostream-setup-mac')).update(Buffer.concat([iv, ct])).digest('base64')
        expect(mac).toBe(envelope.mac)
        const decipher = crypto.createDecipheriv('aes-256-cbc', derive('neostream-setup-enc'), iv)
        return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'))
    }

    it('o link selado não expõe a senha e decifra com a chave do fragmento', () => {
        const ticket = issueSetupTicket()
        const link = buildSealedSetupDeepLink(playlists, 'p1', ticket.key)

        expect(link.startsWith('neostream://setup?e=')).toBe(true)
        // Nem no link, nem no base64 do envelope, nem no ciphertext.
        expect(link).not.toContain('senha-secreta')
        const envelopeJson = Buffer.from(decodeURIComponent(link.split('?e=')[1]), 'base64').toString('utf8')
        expect(envelopeJson).not.toContain('senha-secreta')
        expect(Buffer.from(JSON.parse(envelopeJson).ct, 'base64').toString('latin1')).not.toContain('senha-secreta')
        // A chave também não viaja no link (ela só existe no fragmento do QR).
        expect(link).not.toContain(ticket.key)

        expect(JSON.parse(envelopeJson).v).toBe(SETUP_ENVELOPE_VERSION)
        const payload = unseal(link, ticket.key)
        expect(payload.activeId).toBe('p1')
        expect(payload.accounts[0]).toMatchObject({ username: 'user', password: 'senha-secreta', alias: 'Casa' })
    })

    it('chave errada não decifra (o MAC acusa antes)', () => {
        const ticket = issueSetupTicket()
        const link = buildSealedSetupDeepLink(playlists, 'p1', ticket.key)
        expect(() => unseal(link, Buffer.alloc(16, 7).toString('base64url'))).toThrow()
    })

    it('ticket vale UMA vez e expira em 2 minutos', () => {
        resetSetupTickets()
        const now = 1_000_000
        const ticket = issueSetupTicket(now)
        expect(ticket.expiresAt).toBe(now + 120_000)
        expect(consumeSetupTicket(ticket.token, now + 1_000)).toBe(ticket.key)
        // Foto da tela / repetição do GET: o mesmo token não vale de novo.
        expect(consumeSetupTicket(ticket.token, now + 1_000)).toBeNull()

        const late = issueSetupTicket(now)
        expect(consumeSetupTicket(late.token, now + 120_001)).toBeNull()
        expect(consumeSetupTicket('token-que-nunca-existiu', now)).toBeNull()
    })

    it('a URL do QR cabe no encoder v4 mesmo no pior endereço da LAN', () => {
        const ticket = issueSetupTicket()
        const url = buildSetupQrUrl('http://255.255.255.255:65535/', ticket)
        // O painel gera o QR com qrToSvg(url, 4): estourar 78 bytes lança e o
        // usuário fica SEM o QR (o catch some com ele).
        expect(url.length).toBeLessThanOrEqual(SETUP_QR_MAX_BYTES)
        expect(url).toContain(`/setup?t=${ticket.token}`)
        // A chave fica no fragmento — não vai no request HTTP.
        expect(url.split('#')[0]).not.toContain(ticket.key)
        expect(url.split('#')[1]).toBe(`k=${ticket.key}`)
    })

    it('a página remonta o link com a chave do fragmento e avisa que precisa de app novo', () => {
        const html = renderSetupHandoffPage('neostream://setup?e=abc123', 'pt')
        expect(html).toContain('location.hash.match')
        expect(html).toContain("'&k=' + k")
        expect(html).toContain('v0.21')
        // Link antigo (sem selo) segue como era, sem o aviso de versão.
        expect(renderSetupHandoffPage('neostream://setup?d=abc123', 'pt')).not.toContain('v0.21')
    })

    it('QR vencido explica o que fazer em vez de um 403 seco', () => {
        expect(renderSetupExpiredPage('pt')).toContain('2 minutos')
        expect(renderSetupExpiredPage('en')).toContain('2 minutes')
    })
})
