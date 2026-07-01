/**
 * Unit tests for the pure YouTube embed-fix helpers.
 */
import { describe, it, expect } from 'vitest'
import { isYouTubeRequest, withYouTubeReferer, YOUTUBE_URL_FILTER } from './youtubeEmbedFix'

describe('isYouTubeRequest', () => {
    it('matches youtube.com and subdomains', () => {
        expect(isYouTubeRequest('https://www.youtube.com/embed/abc123?autoplay=1')).toBe(true)
        expect(isYouTubeRequest('https://youtube.com/watch?v=abc')).toBe(true)
        expect(isYouTubeRequest('https://m.youtube.com/')).toBe(true)
    })

    it('matches youtube-nocookie.com (hover preview)', () => {
        expect(isYouTubeRequest('https://www.youtube-nocookie.com/embed/abc123')).toBe(true)
    })

    it('matches thumbnail and video CDN hosts', () => {
        expect(isYouTubeRequest('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe(true)
        expect(isYouTubeRequest('https://r1---sn-x.googlevideo.com/videoplayback?x=1')).toBe(true)
    })

    it('rejects unrelated and look-alike hosts', () => {
        expect(isYouTubeRequest('https://example.com/embed/abc')).toBe(false)
        expect(isYouTubeRequest('https://notyoutube.com/')).toBe(false)
        expect(isYouTubeRequest('https://youtube.com.evil.com/')).toBe(false)
        expect(isYouTubeRequest('file:///C:/app/index.html')).toBe(false)
    })

    it('does not throw on malformed input', () => {
        expect(isYouTubeRequest('not a url')).toBe(false)
        expect(isYouTubeRequest('')).toBe(false)
    })
})

describe('withYouTubeReferer', () => {
    it('sets a valid youtube.com Referer and Origin', () => {
        const out = withYouTubeReferer({ 'User-Agent': 'x' })
        expect(out.Referer).toBe('https://www.youtube.com/')
        expect(out.Origin).toBe('https://www.youtube.com')
    })

    it('preserves other headers and does not mutate the input', () => {
        const input = { 'User-Agent': 'x', 'Accept-Language': 'pt-BR' }
        const out = withYouTubeReferer(input)
        expect(out['User-Agent']).toBe('x')
        expect(out['Accept-Language']).toBe('pt-BR')
        expect(input).not.toHaveProperty('Referer')
    })

    it('overrides any pre-existing file:// referer', () => {
        const out = withYouTubeReferer({ Referer: 'file:///C:/app/index.html' })
        expect(out.Referer).toBe('https://www.youtube.com/')
    })
})

describe('YOUTUBE_URL_FILTER', () => {
    it('covers youtube, nocookie, ytimg and googlevideo', () => {
        expect(YOUTUBE_URL_FILTER).toContain('*://*.youtube.com/*')
        expect(YOUTUBE_URL_FILTER).toContain('*://*.youtube-nocookie.com/*')
        expect(YOUTUBE_URL_FILTER).toContain('*://*.ytimg.com/*')
        expect(YOUTUBE_URL_FILTER).toContain('*://*.googlevideo.com/*')
    })
})
