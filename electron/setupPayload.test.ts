import { describe, expect, it } from 'vitest'
import { buildSetupDeepLink, renderSetupHandoffPage, isHandoffArmed, matchesHandoffToken } from './setupPayload'

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
        expect(html).toContain('location.href = "neostream://setup?d=abc123"')
        expect(html).toContain('Abrir no NeoStream')
    })

    it('respeita o idioma do app', () => {
        expect(renderSetupHandoffPage('neostream://setup?d=x', 'en')).toContain('Open in NeoStream')
        expect(renderSetupHandoffPage('neostream://setup?d=x', 'es')).toContain('Abrir en NeoStream')
    })
})

describe('janela de exportação do /setup (uso único, prazo curto)', () => {
    const armado = { token: 'a1b2c3d4', expiresAt: 1_000 }

    it('sem janela armada não exporta nada', () => {
        expect(isHandoffArmed(null, 500)).toBe(false)
        expect(matchesHandoffToken(null, 'a1b2c3d4', 500)).toBe(false)
    })

    it('janela vale só dentro do prazo', () => {
        expect(isHandoffArmed(armado, 999)).toBe(true)
        expect(isHandoffArmed(armado, 1_000)).toBe(false)
        expect(isHandoffArmed(armado, 5_000)).toBe(false)
    })

    it('token confere apenas idêntico e dentro do prazo', () => {
        expect(matchesHandoffToken(armado, 'a1b2c3d4', 500)).toBe(true)
        expect(matchesHandoffToken(armado, 'a1b2c3d4', 5_000)).toBe(false)
    })

    it('recusa token errado, prefixo do token e vazio', () => {
        expect(matchesHandoffToken(armado, 'a1b2c3d5', 500)).toBe(false)
        expect(matchesHandoffToken(armado, 'a1b2', 500)).toBe(false)
        expect(matchesHandoffToken(armado, 'a1b2c3d4ff', 500)).toBe(false)
        expect(matchesHandoffToken(armado, '', 500)).toBe(false)
    })
})
