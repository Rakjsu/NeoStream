import type { Session } from 'electron'

/**
 * YouTube trailer embeds fail with "Erro 153" (and, if you naively spoof the
 * referer to youtube.com, "Erro 152 — vídeo não disponível") when the app is
 * loaded from file:// in the packaged build: the embedded player document is
 * requested with no valid HTTP Referer, so YouTube refuses to authorize the
 * inline embed. In dev it works because the window loads from http://localhost.
 *
 * Fix (per YouTube's guidance): send OUR OWN https origin as the Referer for
 * the embed document request — NOT youtube.com (spoofing youtube.com trips an
 * anti-abuse check → error 152). We scope this strictly to the top-level embed
 * document (`/embed/<id>`); every other YouTube request (googlevideo, ytimg,
 * player API calls) is made from inside the youtube.com iframe and already
 * carries correct headers, so we must leave those untouched.
 */

/**
 * A stable https origin that identifies the app as the embedder. It only has
 * to be a valid non-youtube https origin (YouTube reads the header string; it
 * never fetches it). Official trailers are embeddable from any origin.
 */
export const EMBEDDER_ORIGIN = 'https://neostream.app'

// Only the embed *document* — not sub-resources fetched by the iframe itself.
export const YOUTUBE_EMBED_URL_FILTER = [
    '*://*.youtube.com/embed/*',
    '*://*.youtube-nocookie.com/embed/*',
]

/** Pure host check (unit-tested): is this the top-level YouTube embed document? */
export function isYouTubeEmbedRequest(url: string): boolean {
    try {
        const u = new URL(url)
        const host = u.hostname.toLowerCase()
        const isYouTubeHost =
            host === 'youtube.com' || host.endsWith('.youtube.com') ||
            host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')
        return isYouTubeHost && u.pathname.startsWith('/embed/')
    } catch {
        return false
    }
}

/**
 * Rewrite the outgoing headers for the embed request so it carries our own
 * https origin as Referer. Pure so it can be unit-tested.
 */
export function withEmbedderReferer(headers: Record<string, string>): Record<string, string> {
    return { ...headers, Referer: `${EMBEDDER_ORIGIN}/` }
}

/** Install the referer rewrite on a session's webRequest (embed doc only). */
export function setupYouTubeEmbedFix(session: Session): void {
    session.webRequest.onBeforeSendHeaders({ urls: YOUTUBE_EMBED_URL_FILTER }, (details, callback) => {
        callback({ requestHeaders: withEmbedderReferer(details.requestHeaders as Record<string, string>) })
    })
}
