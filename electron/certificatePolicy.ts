import { app, session } from 'electron'
import https from 'https'
import store from './store'

const DEFAULT_ALLOW_INVALID_PROVIDER_CERTIFICATES = true

let certificateHandlerRegistered = false

export interface CertificateSettings {
    allowInvalidProviderCertificates: boolean
    approvedProviderHosts: string[]
}

export function getCertificateSettings(): CertificateSettings {
    const settings = store.get('settings') || {}
    return {
        allowInvalidProviderCertificates:
            settings.allowInvalidProviderCertificates ?? DEFAULT_ALLOW_INVALID_PROVIDER_CERTIFICATES,
        approvedProviderHosts: settings.approvedProviderHosts || []
    }
}

export function setAllowInvalidProviderCertificates(value: boolean): CertificateSettings {
    const settings = store.get('settings') || {}
    store.set('settings', {
        ...settings,
        allowInvalidProviderCertificates: value
    })

    return getCertificateSettings()
}

function setApprovedProviderHosts(hosts: string[]) {
    const settings = store.get('settings') || {}
    store.set('settings', {
        ...settings,
        approvedProviderHosts: Array.from(new Set(hosts)).sort()
    })
}

function getHostname(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase()
    } catch {
        return null
    }
}

function getRegistrableDomain(hostname: string): string {
    if (hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
        return hostname
    }

    const parts = hostname.split('.').filter(Boolean)
    if (parts.length <= 2) return hostname

    return parts.slice(-2).join('.')
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

    const approvedHosts = getCertificateSettings().approvedProviderHosts
    if (approvedHosts.includes(requestHostname)) return true

    return getRegistrableDomain(requestHostname) === getRegistrableDomain(providerHostname)
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

function canUseProviderCompatibilityForUrl(url: string, candidateProviderUrl?: string): boolean {
    return getCertificateSettings().allowInvalidProviderCertificates && isProviderUrl(url, candidateProviderUrl)
}

export function canAllowInvalidCertificateForUrl(url: string, candidateProviderUrl?: string): boolean {
    return canUseProviderCompatibilityForUrl(url, candidateProviderUrl)
}

export function getProviderHttpsAgent(url: string, candidateProviderUrl?: string): https.Agent | undefined {
    try {
        const parsedUrl = new URL(url)
        if (parsedUrl.protocol !== 'https:') return undefined
    } catch {
        return undefined
    }

    if (!canAllowInvalidCertificateForUrl(url, candidateProviderUrl)) {
        return undefined
    }

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
    return 'Certificado invalido do provedor. Ative o modo compativel com certificados invalidos nas configuracoes para permitir conexoes apenas com o host IPTV configurado.'
}

function logCertificateCompatibility(url: string, error: string, source: string) {
    const host = getHostname(url) || 'unknown-host'
    console.warn('[Certificate Compatibility]', { host, error, source })
}

export function setupCertificateErrorHandler() {
    if (certificateHandlerRegistered) return
    certificateHandlerRegistered = true

    app.on('certificate-error', (event, _webContents, url, error, _certificate, callback) => {
        if (canAllowInvalidCertificateForUrl(url)) {
            event.preventDefault()
            logCertificateCompatibility(url, error, 'chromium resource')
            callback(true)
            return
        }

        callback(false)
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
