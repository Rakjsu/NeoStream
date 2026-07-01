import type { Session } from 'electron'

/**
 * YouTube trailer embeds fail with "Erro 153 / player configuration error"
 * (the player shows a "Watch on YouTube" link instead of playing) when the
 * app is loaded from file:// in the packaged build: the embedded player has
 * no valid HTTP referrer/origin, so YouTube refuses to play the video inline.
 * In dev it works because the window loads from http://localhost.
 *
 * Fix: for requests to YouTube domains, present a legit youtube.com
 * Referer/Origin so the embed is accepted. Scoped strictly to YouTube hosts
 * so nothing else is touched.
 */

export const YOUTUBE_URL_FILTER = [
    '*://*.youtube.com/*',
    '*://*.youtube-nocookie.com/*',
    '*://*.ytimg.com/*',
    '*://*.googlevideo.com/*',
]

const YOUTUBE_REFERER = 'https://www.youtube.com/'
const YOUTUBE_ORIGIN = 'https://www.youtube.com'

/** Pure host check (unit-tested): does this URL target a YouTube-owned host? */
export function isYouTubeRequest(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase()
        return (
            host === 'youtube.com' || host.endsWith('.youtube.com') ||
            host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com') ||
            host.endsWith('.ytimg.com') ||
            host.endsWith('.googlevideo.com')
        )
    } catch {
        return false
    }
}

/**
 * Rewrite the outgoing headers for a YouTube request so the embed plays
 * inline. Pure so it can be unit-tested; the caller wires it into webRequest.
 */
export function withYouTubeReferer(headers: Record<string, string>): Record<string, string> {
    return { ...headers, Referer: YOUTUBE_REFERER, Origin: YOUTUBE_ORIGIN }
}

/** Install the referer/origin rewrite on a session's webRequest. */
export function setupYouTubeEmbedFix(session: Session): void {
    session.webRequest.onBeforeSendHeaders({ urls: YOUTUBE_URL_FILTER }, (details, callback) => {
        callback({ requestHeaders: withYouTubeReferer(details.requestHeaders as Record<string, string>) })
    })
}
