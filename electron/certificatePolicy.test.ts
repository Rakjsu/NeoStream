import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
// `ready: false` por padrão mantém o probe TLS e o diálogo fora dos testes
// unitários — o que sobra é exatamente a política: sem consentimento salvo,
// não há bypass. O bloco do fim do arquivo liga o `ready` pra exercitar a
// pergunta de verdade.
const electronState = vi.hoisted(() => ({
    ready: false,
    showMessageBox: vi.fn(async () => ({ response: 0 })),
}))
vi.mock('electron', () => ({
    app: { on: vi.fn(), whenReady: () => new Promise(() => undefined), isReady: () => electronState.ready },
    session: {},
    dialog: { showMessageBox: electronState.showMessageBox },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}))

// TLS falso: o probe roda de verdade, sem rede. Atenção: o módulo importa
// `'tls'` cru, não `'node:tls'`. E o `vi.hoisted` assíncrono é obrigatório —
// `vi.mock` é içado acima dos imports, então um `EventEmitter` importado no
// topo estouraria "Cannot access before initialization".
const tlsFake = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')
    const state = { verdict: 'invalid' as 'invalid' | 'valid' }
    class FakeTlsSocket extends EventEmitter {
        destroy() { /* o probe sempre destrói o socket */ }
    }
    return {
        state,
        connect: () => {
            const socket = new FakeTlsSocket()
            setImmediate(() => {
                if (state.verdict === 'valid') socket.emit('secureConnect')
                else socket.emit('error', Object.assign(new Error('expirado'), { code: 'CERT_HAS_EXPIRED' }))
            })
            return socket
        },
    }
})
vi.mock('tls', () => ({ default: { connect: tlsFake.connect } }))

import store from './store'
import {
    getCertificateSettings,
    setAllowInvalidProviderCertificates,
    forgetTrustedCertificateDomains,
    isProviderUrl,
    registerApprovedProviderUrl,
    resolveProviderHttpsAgent,
    canAllowInvalidCertificateForUrl,
    isTlsCertificateError,
    getInvalidCertificateGuidance,
} from './certificatePolicy'

beforeEach(() => {
    store.set('settings', {})
    store.set('auth', { url: 'https://provider.example.com/player_api.php', username: 'u', password: 'p' })
})

/** Atalho: marca o domínio como autorizado pelo dono (o que o diálogo faria). */
function trust(domain: string) {
    const settings = (store.get('settings') || {}) as Record<string, unknown>
    store.set('settings', { ...settings, trustedInvalidCertDomains: [domain] })
}

describe('isProviderUrl (o modo compatível só vale pro host do provedor)', () => {
    it('mesmo host e subdomínios do mesmo domínio registrável passam', () => {
        expect(isProviderUrl('https://provider.example.com/live/1.ts')).toBe(true)
        expect(isProviderUrl('https://cdn7.example.com/movie/2.mp4')).toBe(true) // example.com == example.com
    })

    it('host de terceiro não passa (nem com certificado quebrado)', () => {
        expect(isProviderUrl('https://evil.attacker.net/live/1.ts')).toBe(false)
        expect(isProviderUrl('https://exampleXcom.net/')).toBe(false)
    })

    it('🔒 provedor .com.br NÃO adota todo o sufixo público', () => {
        store.set('auth', { url: 'https://lista.meuiptv.com.br/player_api.php' })
        expect(isProviderUrl('https://cdn7.meuiptv.com.br/live/1.ts')).toBe(true)
        expect(isProviderUrl('https://internetbanking.banco.com.br/x')).toBe(false)
        expect(isProviderUrl('https://qualquercoisa.com.br/x')).toBe(false)
    })

    it('🔒 o mesmo vale para .co.uk e outros sufixos de duas partes', () => {
        store.set('auth', { url: 'https://painel.provedor.co.uk/player_api.php' })
        expect(isProviderUrl('https://cdn.provedor.co.uk/1.ts')).toBe(true)
        expect(isProviderUrl('https://evil.co.uk/1.ts')).toBe(false)
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

    it('🔒 provedor .com.br não consegue plantar host de terceiro na allowlist', () => {
        store.set('auth', { url: 'https://lista.meuiptv.com.br/player_api.php' })
        expect(registerApprovedProviderUrl('https://internetbanking.banco.com.br/x')).toBe(false)
        expect(getCertificateSettings().approvedProviderHosts).toEqual([])
    })
})

describe('bypass de TLS exige consentimento explícito por domínio', () => {
    it('🔒 sem consentimento salvo, host do provedor NÃO ganha agent permissivo', async () => {
        await expect(resolveProviderHttpsAgent('https://provider.example.com/movie/9.mp4')).resolves.toBeUndefined()
        expect(canAllowInvalidCertificateForUrl('https://provider.example.com/movie/9.mp4')).toBe(false)
    })

    it('com o domínio autorizado pelo dono, o agent permissivo volta', async () => {
        trust('example.com')
        const agent = await resolveProviderHttpsAgent('https://provider.example.com/movie/9.mp4')
        expect(agent).toBeInstanceOf(https.Agent)
        expect((agent as https.Agent & { options: { rejectUnauthorized?: boolean } }).options.rejectUnauthorized).toBe(false)
        // Efeito colateral esperado: o host entra na lista aprovada.
        expect(getCertificateSettings().approvedProviderHosts).toContain('provider.example.com')
    })

    it('🔒 consentimento de um domínio não vaza para vizinho do mesmo sufixo', async () => {
        store.set('auth', { url: 'https://lista.meuiptv.com.br/player_api.php' })
        trust('meuiptv.com.br')
        await expect(resolveProviderHttpsAgent('https://cdn2.meuiptv.com.br/1.ts')).resolves.toBeInstanceOf(https.Agent)
        await expect(resolveProviderHttpsAgent('https://internetbanking.banco.com.br/x')).resolves.toBeUndefined()
    })

    it('http, URL inválida ou host de terceiro → undefined', async () => {
        trust('example.com')
        await expect(resolveProviderHttpsAgent('http://provider.example.com/1.ts')).resolves.toBeUndefined()
        await expect(resolveProviderHttpsAgent('não-url')).resolves.toBeUndefined()
        await expect(resolveProviderHttpsAgent('https://evil.net/1.ts')).resolves.toBeUndefined()
    })

    it('com o modo compatível DESLIGADO nunca entrega agent, mesmo autorizado', async () => {
        trust('example.com')
        setAllowInvalidProviderCertificates(false)
        expect(getCertificateSettings().allowInvalidProviderCertificates).toBe(false)
        // Desligar revoga o que já tinha sido autorizado.
        expect(getCertificateSettings().trustedInvalidCertDomains).toEqual([])
        await expect(resolveProviderHttpsAgent('https://provider.example.com/1.ts')).resolves.toBeUndefined()
    })

    it('revogar apaga as autorizações sem mexer no interruptor', () => {
        trust('example.com')
        const settings = forgetTrustedCertificateDomains()
        expect(settings.trustedInvalidCertDomains).toEqual([])
        expect(settings.approvedProviderHosts).toEqual([])
        expect(settings.allowInvalidProviderCertificates).toBe(true)
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

/**
 * 🔐 Recusar o aviso de certificado não pode derrubar o provedor.
 *
 * "Cancelar" é o botão padrão do diálogo — e o do Esc e o do Enter. A recusa
 * era lembrada pela sessão INTEIRA do app, e a única saída era desligar e
 * religar o modo compatível em Configurações → Rede: um caminho que ninguém
 * adivinha, ainda mais com a mensagem de erro mandando "reativar" um
 * interruptor que já está ligado.
 */
describe('recusa de certificado é temporária, não permanente', () => {
    beforeEach(() => {
        // `deniedDomains`/`verdictCache` são estado de módulo, e o beforeEach
        // global só limpa o store: esta é a zeragem pela API pública.
        forgetTrustedCertificateDomains()
        store.set('settings', {})
        electronState.ready = true
        electronState.showMessageBox.mockClear()
        tlsFake.state.verdict = 'invalid'
        vi.useFakeTimers({ toFake: ['Date'] })
    })

    afterEach(() => {
        vi.useRealTimers()
        electronState.ready = false
        forgetTrustedCertificateDomains()
    })

    it('recusar não deixa o provedor fora do ar: passada a janela, o app volta a perguntar', async () => {
        electronState.showMessageBox.mockResolvedValue({ response: 0 }) // Cancelar
        await expect(resolveProviderHttpsAgent('https://provider.example.com/1.ts')).resolves.toBeUndefined()
        expect(electronState.showMessageBox).toHaveBeenCalledTimes(1)

        electronState.showMessageBox.mockResolvedValue({ response: 1 }) // mudou de ideia
        vi.setSystemTime(Date.now() + 11 * 60_000)
        await expect(resolveProviderHttpsAgent('https://provider.example.com/1.ts'))
            .resolves.toBeInstanceOf(https.Agent)
        expect(electronState.showMessageBox).toHaveBeenCalledTimes(2)
    })

    it('dentro da janela, recusar não vira pergunta em laço', async () => {
        electronState.showMessageBox.mockResolvedValue({ response: 0 })
        await expect(resolveProviderHttpsAgent('https://provider.example.com/1.ts')).resolves.toBeUndefined()
        vi.setSystemTime(Date.now() + 30_000)
        await expect(resolveProviderHttpsAgent('https://provider.example.com/2.ts')).resolves.toBeUndefined()
        expect(electronState.showMessageBox).toHaveBeenCalledTimes(1)
    })

    it('🔒 aceitar continua exigindo o sim explícito, e só ele libera o agent', async () => {
        electronState.showMessageBox.mockResolvedValue({ response: 1 })
        await expect(resolveProviderHttpsAgent('https://provider.example.com/1.ts'))
            .resolves.toBeInstanceOf(https.Agent)
        expect(getCertificateSettings().trustedInvalidCertDomains).toEqual(['example.com'])
    })

    it('🔒 certificado VÁLIDO não pergunta nada e não ganha bypass', async () => {
        tlsFake.state.verdict = 'valid'
        await expect(resolveProviderHttpsAgent('https://provider.example.com/1.ts')).resolves.toBeUndefined()
        expect(electronState.showMessageBox).not.toHaveBeenCalled()
    })

    it('desligar e religar o modo compatível também limpa a recusa (saída que já existia)', async () => {
        electronState.showMessageBox.mockResolvedValue({ response: 0 })
        await expect(resolveProviderHttpsAgent('https://provider.example.com/1.ts')).resolves.toBeUndefined()

        setAllowInvalidProviderCertificates(false)
        setAllowInvalidProviderCertificates(true)

        electronState.showMessageBox.mockResolvedValue({ response: 1 })
        await expect(resolveProviderHttpsAgent('https://provider.example.com/1.ts'))
            .resolves.toBeInstanceOf(https.Agent)
    })

    it('a mensagem de erro descreve uma saída que existe', () => {
        expect(getInvalidCertificateGuidance()).toContain('tente de novo daqui a pouco')
    })
})
