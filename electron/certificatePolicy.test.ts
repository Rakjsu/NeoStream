import { describe, it, expect, vi, beforeEach } from 'vitest'
import https from 'https'

// Store em memória: só o que o certificatePolicy lê (settings + auth mirror).
vi.mock('./store', () => {
    const data = new Map<string, unknown>()
    return {
        default: {
            get: (key: string) => data.get(key),
            set: (key: string, value: unknown) => { data.set(key, value) },
            delete: (key: string) => { data.delete(key) },
        },
    }
})
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('electron', () => ({ app: { on: vi.fn(), whenReady: () => new Promise(() => undefined) }, session: {} }))

import store from './store'
import {
    getCertificateSettings,
    setAllowInvalidProviderCertificates,
    isProviderUrl,
    registerApprovedProviderUrl,
    getProviderHttpsAgent,
    isTlsCertificateError,
} from './certificatePolicy'

beforeEach(() => {
    store.set('settings', {})
    store.set('auth', { url: 'https://provider.example.com/player_api.php', username: 'u', password: 'p' })
})

describe('isProviderUrl (o modo compatível só vale pro host do provedor)', () => {
    it('mesmo host e subdomínios do mesmo domínio registrável passam', () => {
        expect(isProviderUrl('https://provider.example.com/live/1.ts')).toBe(true)
        expect(isProviderUrl('https://cdn7.example.com/movie/2.mp4')).toBe(true) // example.com == example.com
    })

    it('host de terceiro não passa (nem com certificado quebrado)', () => {
        expect(isProviderUrl('https://evil.attacker.net/live/1.ts')).toBe(false)
        expect(isProviderUrl('https://exampleXcom.net/')).toBe(false)
    })

    it('IPs só casam por igualdade exata (sem "domínio registrável")', () => {
        store.set('auth', { url: 'http://10.0.0.5:8080/player_api.php' })
        expect(isProviderUrl('http://10.0.0.5:8080/live/1.ts')).toBe(true)
        expect(isProviderUrl('http://10.0.0.6:8080/live/1.ts')).toBe(false)
    })

    it('host aprovado explicitamente passa mesmo sem parentesco de domínio', () => {
        store.set('settings', { approvedProviderHosts: ['balancer.othercdn.io'] })
        expect(isProviderUrl('https://balancer.othercdn.io/x.ts')).toBe(true)
    })

    it('URL inválida / sem auth configurado → false', () => {
        expect(isProviderUrl('isso não é url')).toBe(false)
        store.set('auth', {})
        expect(isProviderUrl('https://provider.example.com/1.ts')).toBe(false)
    })

    it('candidateProviderUrl substitui o auth do store (validação de playlist nova)', () => {
        store.set('auth', {})
        expect(isProviderUrl('https://cdn.newprov.tv/1.ts', 'https://portal.newprov.tv/player_api.php')).toBe(true)
    })
})

describe('registerApprovedProviderUrl (aprendizado dos hosts do provedor)', () => {
    it('registra o host do provedor, sem duplicar e ordenado', () => {
        expect(registerApprovedProviderUrl('https://cdn7.example.com/a.ts')).toBe(true)
        expect(registerApprovedProviderUrl('https://cdn1.example.com/b.ts')).toBe(true)
        expect(registerApprovedProviderUrl('https://cdn7.example.com/c.ts')).toBe(true)
        expect(getCertificateSettings().approvedProviderHosts).toEqual(['cdn1.example.com', 'cdn7.example.com'])
    })

    it('recusa host que não é do provedor (nada é gravado)', () => {
        expect(registerApprovedProviderUrl('https://evil.net/a.ts')).toBe(false)
        expect(getCertificateSettings().approvedProviderHosts).toEqual([])
    })
})

describe('getProviderHttpsAgent (agent permissivo só pra HTTPS do provedor)', () => {
    it('URL https do provedor ganha um Agent com rejectUnauthorized=false', () => {
        const agent = getProviderHttpsAgent('https://provider.example.com/movie/9.mp4')
        expect(agent).toBeInstanceOf(https.Agent)
        expect((agent as https.Agent & { options: { rejectUnauthorized?: boolean } }).options.rejectUnauthorized).toBe(false)
        // Efeito colateral esperado: o host entra na lista aprovada.
        expect(getCertificateSettings().approvedProviderHosts).toContain('provider.example.com')
    })

    it('http, URL inválida ou host de terceiro → undefined', () => {
        expect(getProviderHttpsAgent('http://provider.example.com/1.ts')).toBeUndefined()
        expect(getProviderHttpsAgent('não-url')).toBeUndefined()
        expect(getProviderHttpsAgent('https://evil.net/1.ts')).toBeUndefined()
    })

    it('com o modo compatível DESLIGADO nunca entrega agent', () => {
        setAllowInvalidProviderCertificates(false)
        expect(getCertificateSettings().allowInvalidProviderCertificates).toBe(false)
        expect(getProviderHttpsAgent('https://provider.example.com/1.ts')).toBeUndefined()
    })
})

describe('isTlsCertificateError (classificador de erro de certificado)', () => {
    it('reconhece os códigos TLS e mensagens típicas (inclusive em cause)', () => {
        expect(isTlsCertificateError({ code: 'CERT_HAS_EXPIRED' })).toBe(true)
        expect(isTlsCertificateError({ cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } })).toBe(true)
        expect(isTlsCertificateError(new Error('unable to verify: self-signed cert in chain'))).toBe(true)
        expect(isTlsCertificateError({ message: 'Hostname/IP does not match certificate altnames' })).toBe(true)
    })

    it('erros comuns de rede não são confundidos com certificado', () => {
        expect(isTlsCertificateError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })).toBe(false)
        expect(isTlsCertificateError(new Error('timeout of 15000ms exceeded'))).toBe(false)
        expect(isTlsCertificateError(undefined)).toBe(false)
    })
})
