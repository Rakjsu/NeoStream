/**
 * Unit tests for the pure YouTube embed-fix helpers.
 */
import { describe, it, expect } from 'vitest'
import {
    isYouTubeEmbedRequest,
    withEmbedderReferer,
    EMBEDDER_ORIGIN,
    YOUTUBE_EMBED_URL_FILTER,
} from './youtubeEmbedFix'

describe('isYouTubeEmbedRequest', () => {
    it('matches the top-level embed document on youtube.com', () => {
        expect(isYouTubeEmbedRequest('https://www.youtube.com/embed/abc123?autoplay=1')).toBe(true)
        expect(isYouTubeEmbedRequest('https://youtube.com/embed/abc123')).toBe(true)
    })

    it('matches the embed document on youtube-nocookie.com (hover preview)', () => {
        expect(isYouTubeEmbedRequest('https://www.youtube-nocookie.com/embed/abc123?mute=1')).toBe(true)
    })

    it('does NOT match sub-resource requests from inside the iframe', () => {
        // These originate from the youtube.com iframe and already have correct
        // headers — rewriting them would break playback.
        expect(isYouTubeEmbedRequest('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe(false)
        expect(isYouTubeEmbedRequest('https://r1---sn-x.googlevideo.com/videoplayback?x=1')).toBe(false)
        expect(isYouTubeEmbedRequest('https://www.youtube.com/youtubei/v1/player')).toBe(false)
        expect(isYouTubeEmbedRequest('https://www.youtube.com/watch?v=abc')).toBe(false)
    })

    it('rejects unrelated and look-alike hosts', () => {
        expect(isYouTubeEmbedRequest('https://example.com/embed/abc')).toBe(false)
        expect(isYouTubeEmbedRequest('https://youtube.com.evil.com/embed/abc')).toBe(false)
        expect(isYouTubeEmbedRequest('file:///C:/app/index.html')).toBe(false)
    })

    it('does not throw on malformed input', () => {
        expect(isYouTubeEmbedRequest('not a url')).toBe(false)
        expect(isYouTubeEmbedRequest('')).toBe(false)
    })
})

describe('withEmbedderReferer', () => {
    it('sets our own https origin as Referer — never youtube.com', () => {
        const out = withEmbedderReferer({ 'User-Agent': 'x' })
        expect(out.Referer).toBe(`${EMBEDDER_ORIGIN}/`)
        expect(out.Referer).not.toContain('youtube')
    })

    it('does not spoof an Origin header (which caused error 152)', () => {
        const out = withEmbedderReferer({ 'User-Agent': 'x' })
        expect(out).not.toHaveProperty('Origin')
    })

    it('preserves other headers and does not mutate the input', () => {
        const input = { 'User-Agent': 'x', 'Accept-Language': 'pt-BR' }
        const out = withEmbedderReferer(input)
        expect(out['User-Agent']).toBe('x')
        expect(out['Accept-Language']).toBe('pt-BR')
        expect(input).not.toHaveProperty('Referer')
    })

    it('overrides any pre-existing file:// referer', () => {
        const out = withEmbedderReferer({ Referer: 'file:///C:/app/index.html' })
        expect(out.Referer).toBe(`${EMBEDDER_ORIGIN}/`)
    })
})

describe('YOUTUBE_EMBED_URL_FILTER', () => {
    it('scopes strictly to the embed document on both YouTube domains', () => {
        expect(YOUTUBE_EMBED_URL_FILTER).toContain('*://*.youtube.com/embed/*')
        expect(YOUTUBE_EMBED_URL_FILTER).toContain('*://*.youtube-nocookie.com/embed/*')
    })

    it('does not broadly capture all youtube traffic', () => {
        expect(YOUTUBE_EMBED_URL_FILTER).not.toContain('*://*.youtube.com/*')
        expect(YOUTUBE_EMBED_URL_FILTER).not.toContain('*://*.googlevideo.com/*')
    })
})
