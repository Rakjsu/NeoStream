import { describe, it, expect } from 'vitest'
import {
    MAX_CONCURRENT_TRANSCODES,
    PROXY_TOKEN_IDLE_TTL_MS,
    canAcceptTranscode,
    classifyProxyTarget,
    isProxyTargetAllowed,
    isTokenValid,
    newProxyToken,
    planUpstreamRedirect,
    tokensToRevoke,
} from './dlnaProxyGuard'

const PROVIDER_PLAYLIST = 'http://provedor.tv:8080/live/joao/senha/1.m3u8'

describe('isProxyTargetAllowed — confinamento de destino', () => {
    it('aceita segmento no mesmo host da playlist do provedor', () => {
        expect(isProxyTargetAllowed('http://provedor.tv:8080/live/joao/senha/1_00001.ts', PROVIDER_PLAYLIST)).toBe(true)
    })

    it('aceita subdomínio do mesmo domínio registrável (CDN do provedor)', () => {
        expect(isProxyTargetAllowed('http://cdn7.provedor.tv/seg/1.ts', PROVIDER_PLAYLIST)).toBe(true)
    })

    it('aceita host já aprovado como do provedor', () => {
        expect(isProxyTargetAllowed('http://outro-cdn.net/seg/1.ts', PROVIDER_PLAYLIST, ['outro-cdn.net'])).toBe(true)
    })

    it('nega host arbitrário: o desktop não busca por ele', () => {
        expect(isProxyTargetAllowed('http://evil.example.com/coleta', PROVIDER_PLAYLIST)).toBe(false)
        expect(classifyProxyTarget('http://evil.example.com/coleta', PROVIDER_PLAYLIST)).toBe('passthrough')
    })

    it('nega localhost e 127.0.0.0/8 (servidores internos do app)', () => {
        expect(isProxyTargetAllowed('http://localhost:8974/health', PROVIDER_PLAYLIST)).toBe(false)
        expect(classifyProxyTarget('http://localhost:8974/health', PROVIDER_PLAYLIST)).toBe('block')
        expect(classifyProxyTarget('http://127.0.0.1:8974/setup?pin=1234', PROVIDER_PLAYLIST)).toBe('block')
        expect(classifyProxyTarget('http://127.6.6.6/x', PROVIDER_PLAYLIST)).toBe('block')
        expect(classifyProxyTarget('http://[::1]:8974/health', PROVIDER_PLAYLIST)).toBe('block')
    })

    it('nega roteador, NAS e link-local da LAN do usuário', () => {
        expect(classifyProxyTarget('http://192.168.0.1/cgi-bin/luci/;stok=/reboot', PROVIDER_PLAYLIST)).toBe('block')
        expect(classifyProxyTarget('http://10.0.0.5:9091/transmission/rpc', PROVIDER_PLAYLIST)).toBe('block')
        expect(classifyProxyTarget('http://172.16.3.4/admin', PROVIDER_PLAYLIST)).toBe('block')
        expect(classifyProxyTarget('http://169.254.169.254/latest/meta-data/', PROVIDER_PLAYLIST)).toBe('block')
        expect(classifyProxyTarget('http://100.100.0.1/x', PROVIDER_PLAYLIST)).toBe('block')
    })

    it('aceita faixa privada quando é o PRÓPRIO provedor que serviu a playlist', () => {
        const localProvider = 'http://192.168.0.50:8080/live/joao/senha/1.m3u8'
        expect(classifyProxyTarget('http://192.168.0.50:8080/seg/1.ts', localProvider)).toBe('proxy')
        // O vizinho de sub-rede continua fora, mesmo com provedor na LAN.
        expect(classifyProxyTarget('http://192.168.0.1/reboot', localProvider)).toBe('block')
    })

    it('não confunde nome de host com literal IPv6 (fcbarcelona.com)', () => {
        expect(classifyProxyTarget('http://fcbarcelona.com/seg.ts', PROVIDER_PLAYLIST)).toBe('passthrough')
        expect(classifyProxyTarget('http://[fd00::1]/seg.ts', PROVIDER_PLAYLIST)).toBe('block')
    })

    it('deixa esquema não-http passar intacto em vez de virar token', () => {
        expect(classifyProxyTarget('skd://drm-key/1', PROVIDER_PLAYLIST)).toBe('passthrough')
    })
})

describe('planUpstreamRedirect — 302 do provedor', () => {
    it('segue redirecionamento público (balanceador/CDN)', () => {
        const plan = planUpstreamRedirect(PROVIDER_PLAYLIST, 302, 'http://edge-12.cdnfast.net/live/1.ts')
        expect(plan).toEqual({ kind: 'follow', url: 'http://edge-12.cdnfast.net/live/1.ts' })
    })

    it('nega redirecionamento para loopback', () => {
        const plan = planUpstreamRedirect(PROVIDER_PLAYLIST, 302, 'http://127.0.0.1:8974/setup?pin=1234')
        expect(plan.kind).toBe('block')
    })

    it('nega redirecionamento para rede privada', () => {
        expect(planUpstreamRedirect(PROVIDER_PLAYLIST, 301, 'http://192.168.0.1/reboot').kind).toBe('block')
        expect(planUpstreamRedirect(PROVIDER_PLAYLIST, 307, 'http://169.254.169.254/latest/').kind).toBe('block')
    })

    it('nega Location relativo que aterrissa em host interno', () => {
        const plan = planUpstreamRedirect('http://provedor.tv/a/b.m3u8', 302, '//10.1.2.3/interno')
        expect(plan.kind).toBe('block')
    })

    it('não trata resposta normal como redirecionamento', () => {
        expect(planUpstreamRedirect(PROVIDER_PLAYLIST, 200, null).kind).toBe('stop')
        expect(planUpstreamRedirect(PROVIDER_PLAYLIST, 302, null).kind).toBe('stop')
    })
})

describe('tokens do proxy', () => {
    it('gera token imprevisível: nada derivado do relógio', () => {
        const first = newProxyToken()
        const second = newProxyToken()
        expect(first).not.toBe(second)
        expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
        expect(first).not.toContain(Date.now().toString(36))
    })

    it('expira token parado além da janela de inatividade', () => {
        const agora = 1_700_000_000_000
        const entry = { lastUsedAt: agora }
        expect(isTokenValid(entry, agora + PROXY_TOKEN_IDLE_TTL_MS - 1)).toBe(true)
        expect(isTokenValid(entry, agora + PROXY_TOKEN_IDLE_TTL_MS + 1)).toBe(false)
        expect(isTokenValid(undefined, agora)).toBe(false)
    })

    it('mantém válido o token em uso (cada acerto renova a janela)', () => {
        const agora = 1_700_000_000_000
        // TV pedindo segmentos: última renovação recente, mesmo horas após criar.
        expect(isTokenValid({ lastUsedAt: agora + 5 * 3600_000 }, agora + 5 * 3600_000 + 60_000)).toBe(true)
    })

    it('não expira token com stream em andamento (filme de 3h num pedido só)', () => {
        const agora = 1_700_000_000_000
        const emUso = { lastUsedAt: agora, inFlight: 1 }
        expect(isTokenValid(emUso, agora + 3 * 3600_000)).toBe(true)
        expect(isTokenValid({ ...emUso, inFlight: 0 }, agora + 3 * 3600_000)).toBe(false)
    })

    it('revoga só os tokens do aparelho que parou (não os de outra sessão)', () => {
        const entries = new Map([
            ['tok-tv', { deviceHost: '192.168.0.10' }],
            ['tok-tv-2', { deviceHost: '192.168.0.10' }],
            ['tok-chromecast', { deviceHost: '192.168.0.77' }],
        ])
        expect(tokensToRevoke(entries, '192.168.0.10').sort()).toEqual(['tok-tv', 'tok-tv-2'])
        expect(tokensToRevoke(entries, '192.168.0.77')).toEqual(['tok-chromecast'])
        expect(tokensToRevoke(entries, '')).toEqual([])
    })
})

describe('canAcceptTranscode — teto de ffmpeg', () => {
    it('aceita até o teto e recusa a partir dele', () => {
        expect(canAcceptTranscode(0)).toBe(true)
        expect(canAcceptTranscode(MAX_CONCURRENT_TRANSCODES - 1)).toBe(true)
        expect(canAcceptTranscode(MAX_CONCURRENT_TRANSCODES)).toBe(false)
        expect(canAcceptTranscode(300)).toBe(false)
    })
})
