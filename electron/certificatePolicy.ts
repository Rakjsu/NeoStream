import { app, dialog, session, BrowserWindow } from 'electron'
import https from 'https'
import tls from 'tls'
import store from './store'
import { getRegistrableDomain, isIpLiteral, isSameRegistrableDomain, normalizeHostname } from './publicSuffix'

import log from './logger'

/**
 * O modo compatível continua LIGADO por padrão: painel IPTV com certificado
 * próprio ou vencido é a regra, não a exceção, e desligar isso de uma vez
 * deixaria uma multidão de usuários legítimos sem catálogo. O que muda é o
 * que ele significa — antes "aceite qualquer certificado do provedor em
 * silêncio", agora "o app PODE perguntar". Sem um sim explícito do dono, para
 * aquele domínio, o TLS é validado normalmente.
 */
const DEFAULT_ALLOW_INVALID_PROVIDER_CERTIFICATES = true

/** Teto do cache de hosts do provedor: sem ele a lista cresce pra sempre. */
const MAX_APPROVED_HOSTS = 64
/** Handshake do probe: curto, porque ele entra no caminho da 1ª requisição. */
const PROBE_TIMEOUT_MS = 6000
/** Falha de rede não é veredicto — re-testa depois em vez de fixar o erro. */
const UNKNOWN_VERDICT_TTL_MS = 60_000

let certificateHandlerRegistered = false

type CertificateVerdict = 'valid' | 'invalid' | 'unknown'

/** Veredicto por host:porta, válido só para a sessão do app. */
const verdictCache = new Map<string, { verdict: CertificateVerdict; at: number }>()
/** Domínios recusados pelo dono nesta sessão — não perguntar de novo agora. */
const deniedDomains = new Set<string>()
/** Uma pergunta por domínio de cada vez, mesmo com requisições em paralelo. */
const pendingPrompts = new Map<string, Promise<boolean>>()
/** Idem para o probe: uma tela de capas quebrada dispara dezenas de erros
 *  de certificado ao mesmo tempo e não se abre um handshake para cada um. */
const pendingProbes = new Map<string, Promise<CertificateVerdict>>()

export interface CertificateSettings {
    allowInvalidProviderCertificates: boolean
    approvedProviderHosts: string[]
    /** Domínios em que o dono aceitou EXPLICITAMENTE certificado inválido. */
    trustedInvalidCertDomains: string[]
}

export function getCertificateSettings(): CertificateSettings {
    const settings = store.get('settings') || {}
    return {
        allowInvalidProviderCertificates:
            settings.allowInvalidProviderCertificates ?? DEFAULT_ALLOW_INVALID_PROVIDER_CERTIFICATES,
        approvedProviderHosts: settings.approvedProviderHosts || [],
        trustedInvalidCertDomains: settings.trustedInvalidCertDomains || []
    }
}

export function setAllowInvalidProviderCertificates(value: boolean): CertificateSettings {
    const settings = store.get('settings') || {}
    store.set('settings', {
        ...settings,
        allowInvalidProviderCertificates: value,
        // Desligar o modo compatível revoga tudo o que ele já concedeu — é o
        // único caminho de revogação, então não pode deixar resíduo.
        ...(value ? {} : { trustedInvalidCertDomains: [], approvedProviderHosts: [] })
    })

    if (!value) {
        verdictCache.clear()
        deniedDomains.clear()
    }

    return getCertificateSettings()
}

/** Esquece as decisões de confiança sem mexer no interruptor principal. */
export function forgetTrustedCertificateDomains(): CertificateSettings {
    const settings = store.get('settings') || {}
    store.set('settings', { ...settings, trustedInvalidCertDomains: [], approvedProviderHosts: [] })
    verdictCache.clear()
    deniedDomains.clear()
    return getCertificateSettings()
}

function setApprovedProviderHosts(hosts: string[]) {
    const settings = store.get('settings') || {}
    store.set('settings', {
        ...settings,
        approvedProviderHosts: Array.from(new Set(hosts)).sort().slice(0, MAX_APPROVED_HOSTS)
    })
}

function trustDomain(domain: string) {
    const settings = store.get('settings') || {}
    const current = settings.trustedInvalidCertDomains || []
    if (current.includes(domain)) return
    store.set('settings', {
        ...settings,
        trustedInvalidCertDomains: Array.from(new Set([...current, domain])).sort()
    })
}

function getHostname(url: string): string | null {
    try {
        const hostname = normalizeHostname(new URL(url).hostname)
        return hostname || null
    } catch {
        return null
    }
}

function getProviderHostname(candidateProviderUrl?: string): string | null {
    if (candidateProviderUrl) {
        return getHostname(candidateProviderUrl)
    }

    const auth = store.get('auth')
    return auth.url ? getHostname(auth.url) : null
}

export function isProviderUrl(url: string, candidateProviderUrl?: string): boolean {
    const requestHostname = getHostname(url)
    const providerHostname = getProviderHostname(candidateProviderUrl)

    if (!requestHostname || !providerHostname) return false
    if (requestHostname === providerHostname) return true

    // Cache de hosts já reconhecidos (suporta multi-playlist: um host aprovado
    // enquanto outra lista estava ativa continua valendo). Ele NÃO desliga TLS
    // sozinho — isso agora exige o consentimento por domínio, abaixo.
    const approvedHosts = getCertificateSettings().approvedProviderHosts
    if (approvedHosts.includes(requestHostname)) return true

    return isSameRegistrableDomain(requestHostname, providerHostname)
}

export function registerApprovedProviderUrl(url: string, candidateProviderUrl?: string): boolean {
    const requestHostname = getHostname(url)
    if (!requestHostname || !isProviderUrl(url, candidateProviderUrl)) return false

    const settings = getCertificateSettings()
    if (!settings.approvedProviderHosts.includes(requestHostname)) {
        setApprovedProviderHosts([...settings.approvedProviderHosts, requestHostname])
    }

    return true
}

/**
 * Escopo de confiança: literal de IP casa só consigo mesmo; nome casa com o
 * domínio registrável (o provedor costuma servir de `cdn1..cdnN.dominio`).
 */
function getTrustScope(hostname: string): string {
    return isIpLiteral(hostname) ? hostname : getRegistrableDomain(hostname)
}

function isTrustedForInvalidCertificate(hostname: string): boolean {
    const scope = getTrustScope(hostname)
    if (!scope) return false
    const trusted = getCertificateSettings().trustedInvalidCertDomains
    return trusted.includes(scope)
}

/**
 * Compatibilidade de CORS: continua valendo pelo interruptor + parentesco de
 * host, sem consentimento. Reescrever cabeçalho de CORS não expõe credencial
 * nenhuma na rede — amarrar isso ao consentimento quebraria capas e players
 * de provedores com certificado PERFEITAMENTE válido, sem ganho de segurança.
 */
function canUseProviderCompatibilityForUrl(url: string, candidateProviderUrl?: string): boolean {
    return getCertificateSettings().allowInvalidProviderCertificates && isProviderUrl(url, candidateProviderUrl)
}

/** Só há bypass de TLS com sim explícito do dono para aquele domínio. */
export function canAllowInvalidCertificateForUrl(url: string, candidateProviderUrl?: string): boolean {
    if (!canUseProviderCompatibilityForUrl(url, candidateProviderUrl)) return false
    const hostname = getHostname(url)
    return !!hostname && isTrustedForInvalidCertificate(hostname)
}

/**
 * Handshake TLS estrito só para classificar o certificado. Sem isto a única
 * forma de saber que o certificado é ruim seria perguntar ANTES de tentar —
 * e aí todo provedor com certificado válido levaria um alerta de segurança
 * sem motivo nenhum.
 */
function probeCertificate(hostname: string, port: number): Promise<CertificateVerdict> {
    return new Promise(resolve => {
        let socket: tls.TLSSocket
        try {
            socket = tls.connect({
                host: hostname,
                port,
                servername: isIpLiteral(hostname) ? undefined : hostname,
                rejectUnauthorized: true,
                timeout: PROBE_TIMEOUT_MS
            })
        } catch {
            // Nada aqui pode derrubar a requisição que originou o probe.
            resolve('unknown')
            return
        }

        let settled = false
        const finish = (verdict: CertificateVerdict) => {
            if (settled) return
            settled = true
            try { socket.destroy() } catch { /* já caiu */ }
            resolve(verdict)
        }

        socket.on('secureConnect', () => finish('valid'))
        socket.on('timeout', () => finish('unknown'))
        socket.on('close', () => finish('unknown'))
        socket.on('error', (error: NodeJS.ErrnoException) => {
            finish(isTlsCertificateError(error) ? 'invalid' : 'unknown')
        })
    })
}

async function classifyCertificate(hostname: string, port: number): Promise<CertificateVerdict> {
    const key = `${hostname}:${port}`
    const cached = verdictCache.get(key)
    if (cached && (cached.verdict !== 'unknown' || Date.now() - cached.at < UNKNOWN_VERDICT_TTL_MS)) {
        return cached.verdict
    }

    const inFlight = pendingProbes.get(key)
    if (inFlight) return inFlight

    const probe = probeCertificate(hostname, port)
        // Nunca rejeita: um probe quebrado não pode derrubar a requisição.
        .catch((): CertificateVerdict => 'unknown')
        .then(verdict => {
            verdictCache.set(key, { verdict, at: Date.now() })
            pendingProbes.delete(key)
            return verdict
        })

    pendingProbes.set(key, probe)
    return probe
}

function promptForCertificateTrust(hostname: string, scope: string): Promise<boolean> {
    const pending = pendingPrompts.get(scope)
    if (pending) return pending

    const question = (async () => {
        const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        const options = {
            type: 'warning' as const,
            noLink: true,
            buttons: ['Cancelar', 'Confiar neste provedor'],
            defaultId: 0,
            cancelId: 0,
            title: 'Certificado inválido do provedor',
            message: `Não foi possível verificar a identidade de ${hostname}.`,
            detail:
                'Seu usuário e sua senha do IPTV viajam nessa conexão. Sem um certificado válido, ' +
                'qualquer aparelho na mesma rede (Wi-Fi de casa, café ou hotel) pode se passar por esse ' +
                'servidor, ler suas credenciais e trocar o conteúdo que o app recebe.\n\n' +
                'Muitos painéis IPTV usam certificado próprio e caem aqui sem má intenção. Se você ' +
                `reconhece este provedor e confia na rede em que está agora, pode continuar.\n\n` +
                `Confiar vale para ${scope} e seus subdomínios, e fica salvo. Para desfazer, use ` +
                'Configurações → Rede e certificados.'
        }

        const result = parent
            ? await dialog.showMessageBox(parent, options)
            : await dialog.showMessageBox(options)

        return result.response === 1
    })()
        .catch(error => {
            log.warn('[Certificate Policy] Falha ao perguntar sobre o certificado:', error)
            return false
        })
        .finally(() => { pendingPrompts.delete(scope) })

    pendingPrompts.set(scope, question)
    return question
}

/**
 * Decide se o domínio pode usar certificado inválido: já confiado → sim;
 * certificado na verdade válido → não (e nem pergunta); inválido → pergunta
 * uma vez ao dono. Sem janela ou app ainda não pronto, não pergunta nada.
 */
async function ensureCertificateDecision(url: string, candidateProviderUrl?: string): Promise<boolean> {
    let hostname: string
    let port: number
    try {
        const parsed = new URL(url)
        hostname = normalizeHostname(parsed.hostname)
        port = Number(parsed.port) || 443
    } catch {
        return false
    }
    if (!hostname) return false
    if (isTrustedForInvalidCertificate(hostname)) return true

    const scope = getTrustScope(hostname)
    if (!scope || deniedDomains.has(scope)) return false
    // Antes do app pronto não há janela para ancorar o diálogo; a próxima
    // requisição (já com janela) faz a pergunta.
    if (typeof app.isReady !== 'function' || !app.isReady()) return false

    const verdict = await classifyCertificate(hostname, port)
    // Certificado válido: valida normalmente, sem alerta e sem exceção salva.
    if (verdict !== 'invalid') return false
    if (isTrustedForInvalidCertificate(hostname)) return true

    const accepted = await promptForCertificateTrust(hostname, scope)
    if (!accepted) {
        deniedDomains.add(scope)
        log.warn('[Certificate Policy] Certificado inválido recusado pelo usuário:', scope)
        return false
    }

    trustDomain(scope)
    registerApprovedProviderUrl(url, candidateProviderUrl)
    log.warn('[Certificate Policy] Certificado inválido aceito pelo usuário:', scope)
    return true
}

/**
 * Agent HTTPS para requisições ao provedor. Devolve `undefined` (validação
 * normal) na esmagadora maioria dos casos; só entrega o agent permissivo
 * quando o dono autorizou aquele domínio depois do aviso.
 *
 * É assíncrono de propósito: a decisão precisa acontecer ANTES da requisição
 * sair, senão a primeira tentativa falharia e o provedor pareceria quebrado.
 */
export async function resolveProviderHttpsAgent(
    url: string,
    candidateProviderUrl?: string
): Promise<https.Agent | undefined> {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return undefined
    }
    if (parsed.protocol !== 'https:') return undefined

    // Caminho quente (a maioria esmagadora das requisições): o certificado
    // daquele host já foi verificado como VÁLIDO nesta sessão, então não há
    // nada a decidir e nem configuração a reler — a validação normal resolve.
    const probeKey = `${normalizeHostname(parsed.hostname)}:${Number(parsed.port) || 443}`
    if (verdictCache.get(probeKey)?.verdict === 'valid') return undefined

    if (!canUseProviderCompatibilityForUrl(url, candidateProviderUrl)) return undefined
    if (!await ensureCertificateDecision(url, candidateProviderUrl)) return undefined

    registerApprovedProviderUrl(url, candidateProviderUrl)
    logCertificateCompatibility(url, 'node-request', 'provider HTTPS request')
    return new https.Agent({ rejectUnauthorized: false })
}

export function isTlsCertificateError(error: unknown): boolean {
    const candidate = error as { code?: string; message?: string; cause?: { code?: string; message?: string } }
    const code = candidate?.code || candidate?.cause?.code || ''
    const message = `${candidate?.message || ''} ${candidate?.cause?.message || ''}`.toLowerCase()

    return [
        'CERT_HAS_EXPIRED',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_GET_ISSUER_CERT',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'ERR_TLS_CERT_ALTNAME_INVALID'
    ].includes(code) || message.includes('certificate') || message.includes('self-signed')
}

export function getInvalidCertificateGuidance(): string {
    return 'Certificado invalido do provedor. O app pergunta uma vez por provedor antes de aceitar; se voce recusou ou o modo compativel esta desligado, reative em Configuracoes > Rede e certificados e tente de novo.'
}

function logCertificateCompatibility(url: string, error: string, source: string) {
    const host = getHostname(url) || 'unknown-host'
    log.warn('[Certificate Compatibility]', { host, error, source })
}

export function setupCertificateErrorHandler() {
    if (certificateHandlerRegistered) return
    certificateHandlerRegistered = true

    app.on('certificate-error', (event, _webContents, url, error, _certificate, callback) => {
        // O Chromium só chama isto quando o certificado JÁ falhou, então aqui
        // não é preciso sondar nada — basta perguntar (ou usar o sim salvo).
        if (!canUseProviderCompatibilityForUrl(url)) {
            callback(false)
            return
        }

        // preventDefault tem que ser SÍNCRONO, senão o Chromium já derrubou o
        // recurso antes de a resposta do dono chegar; quem decide é o callback.
        event.preventDefault()
        void ensureCertificateDecision(url).then(allowed => {
            if (allowed) logCertificateCompatibility(url, error, 'chromium resource')
            callback(allowed)
        })
    })

    app.whenReady().then(() => {
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            if (!canUseProviderCompatibilityForUrl(details.url)) {
                callback({ responseHeaders: details.responseHeaders })
                return
            }

            registerApprovedProviderUrl(details.url)
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Access-Control-Allow-Origin': ['*'],
                    'Access-Control-Allow-Methods': ['GET, POST, OPTIONS'],
                    'Access-Control-Allow-Headers': ['Content-Type, Range, Accept, Origin'],
                    'Access-Control-Expose-Headers': ['Content-Length, Content-Range, Accept-Ranges']
                }
            })
        })
    })
}
