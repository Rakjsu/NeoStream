import { app, session } from 'electron'
import https from 'https'
import store from './store'

const DEFAULT_ALLOW_INVALID_PROVIDER_CERTIFICATES = true

let certificateHandlerRegistered = false

export interface CertificateSettings {
    allowInvalidProviderCertificates: boolean
}

export function getCertificateSettings(): CertificateSettings {
    const settings = store.get('settings') || {}
    return {
        allowInvalidProviderCertificates:
            settings.allowInvalidProviderCertificates ?? DEFAULT_ALLOW_INVALID_PROVIDER_CERTIFICATES
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

function getHostname(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase()
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

    return Boolean(requestHostname && providerHostname && requestHostname === providerHostname)
}

export function canAllowInvalidCertificateForUrl(url: string, candidateProviderUrl?: string): boolean {
    return getCertificateSettings().allowInvalidProviderCertificates && isProviderUrl(url, candidateProviderUrl)
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
            if (!isProviderUrl(details.url)) {
                callback({ responseHeaders: details.responseHeaders })
                return
            }

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
