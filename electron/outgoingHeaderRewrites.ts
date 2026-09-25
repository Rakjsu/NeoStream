import type { Session } from 'electron'
import { isYouTubeEmbedRequest, withEmbedderReferer, YOUTUBE_EMBED_URL_FILTER } from './youtubeEmbedFix'

/**
 * 🧩 Reescritas de cabeçalho das requisições que SAEM do renderer.
 *
 * Por que um módulo só: o Electron guarda UM listener de `onBeforeSendHeaders`
 * por sessão — registrar um segundo SUBSTITUI o primeiro, sem erro nenhum
 * (medido no Electron 44: o listener antigo parou de rodar). Um
 * `setupAlgumaCoisa(session)` novo ao lado do fix do YouTube apagaria o
 * Referer do trailer (volta o "Erro 153") em silêncio. Toda reescrita de
 * cabeçalho de saída entra AQUI, num filtro e num listener únicos.
 *
 * Reescritas:
 * - trailer do YouTube: Referer da nossa própria origem (youtubeEmbedFix.ts);
 * - PC controla PC (item 38): o WebSocket pro controle web de OUTRO NeoStream
 *   sai SEM `Origin`. O renderer empacotado carrega de `file://`, então o
 *   Chromium manda `Origin: file://` no upgrade — e o guarda do outro PC
 *   (localServerGuard.isAllowedOrigin) recusa qualquer origem que não seja a
 *   dele. Sem o Origin, o upgrade é tratado como cliente nativo (igual ao app
 *   do celular); o guarda de Host (IP literal) e o PIN continuam valendo.
 *
 * Testado em outgoingHeaderRewrites.test.ts.
 */

/**
 * Só `ws://`: o servidor do controle web fala WebSocket em claro quando o
 * HTTPS está desligado. `wss://` fica intocado.
 */
export const PEER_REMOTE_WS_URL_FILTER = ['ws://*/*']

/** Filtro ÚNICO do listener da sessão (ver o porquê no topo). */
export const OUTGOING_HEADER_URL_FILTER = [...YOUTUBE_EMBED_URL_FILTER, ...PEER_REMOTE_WS_URL_FILTER]

/** PURO: é o upgrade de um WebSocket em claro (`ws://`)? */
export function isPlainWebSocketUrl(url: string): boolean {
    try {
        return new URL(url).protocol === 'ws:'
    } catch {
        return false
    }
}

/**
 * PURO: a origem é o PRÓPRIO renderer do app? `file://` no app empacotado
 * (é o que o Chromium põe no upgrade do WebSocket — medido) ou a origem do
 * servidor do Vite em dev.
 *
 * `null` NÃO entra, de propósito: origem opaca é a assinatura de
 * `<iframe sandbox>`/`data:` — justamente o terceiro que o guarda do outro PC
 * recusa (localServerGuard.isAllowedOrigin). Apagar o `null` aqui lavaria a
 * origem de um iframe desses dentro do nosso renderer.
 */
export function isOwnRendererOrigin(origin: string, devServerOrigin?: string): boolean {
    if (origin === 'file://') return true
    if (!devServerOrigin) return false
    try {
        return new URL(origin).origin === new URL(devServerOrigin).origin
    } catch {
        return false
    }
}

/**
 * PURO: tira o `Origin` quando ele é a origem do próprio renderer. Origem de
 * terceiro passa como veio: o servidor do outro lado continua decidindo por
 * ela. Não muta a entrada.
 */
export function withoutOwnOrigin(
    headers: Record<string, string>,
    devServerOrigin?: string,
): Record<string, string> {
    const out = { ...headers }
    for (const key of Object.keys(out)) {
        if (key.toLowerCase() !== 'origin') continue
        if (isOwnRendererOrigin(out[key], devServerOrigin)) delete out[key]
    }
    return out
}

/** PURO: aplica a reescrita certa para a URL (ou devolve os cabeçalhos como vieram). */
export function rewriteOutgoingHeaders(
    url: string,
    headers: Record<string, string>,
    devServerOrigin?: string,
): Record<string, string> {
    if (isYouTubeEmbedRequest(url)) return withEmbedderReferer(headers)
    if (isPlainWebSocketUrl(url)) return withoutOwnOrigin(headers, devServerOrigin)
    return headers
}

/**
 * Instala o listener ÚNICO de `onBeforeSendHeaders` da sessão.
 * `devServerOrigin` = VITE_DEV_SERVER_URL em dev (undefined no app empacotado).
 */
export function setupOutgoingHeaderRewrites(session: Session, devServerOrigin?: string): void {
    session.webRequest.onBeforeSendHeaders({ urls: OUTGOING_HEADER_URL_FILTER }, (details, callback) => {
        callback({
            requestHeaders: rewriteOutgoingHeaders(
                details.url,
                details.requestHeaders as Record<string, string>,
                devServerOrigin,
            ),
        })
    })
}
