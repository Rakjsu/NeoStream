import { describe, it, expect } from 'vitest'
import { getBackdropUrl, isKidsFriendly } from './tmdb'

describe('tmdb.getBackdropUrl', () => {
    it('returns null when no path is provided', () => {
        expect(getBackdropUrl(null)).toBeNull()
        expect(getBackdropUrl('')).toBeNull()
    })

    it('builds an original-size URL by default', () => {
        expect(getBackdropUrl('/abc.jpg')).toBe(
            'https://image.tmdb.org/t/p/original/abc.jpg'
        )
    })

    it('uses the requested size when provided', () => {
        expect(getBackdropUrl('/abc.jpg', 'w1280')).toBe(
            'https://image.tmdb.org/t/p/w1280/abc.jpg'
        )
    })
})

describe('tmdb.isKidsFriendly', () => {
    it('blocks unknown/empty certifications by default', () => {
        expect(isKidsFriendly(null)).toBe(false)
        expect(isKidsFriendly(undefined)).toBe(false)
        expect(isKidsFriendly('')).toBe(false)
    })

    it('allows kids-friendly ratings (Brazilian / US / UK / general)', () => {
        for (const rating of ['L', 'Livre', '10', 'G', 'TV-Y', 'TV-Y7', 'TV-G', 'U', 'UC', '0', '6', '7', 'ALL']) {
            expect(isKidsFriendly(rating)).toBe(true)
        }
    })

    it('blocks adult-ish ratings', () => {
        for (const rating of ['PG-13', 'R', 'NC-17', '14', '16', '18', 'TV-MA']) {
            expect(isKidsFriendly(rating)).toBe(false)
        }
    })

    it('is case-insensitive and trims whitespace', () => {
        expect(isKidsFriendly('  livre ')).toBe(true)
        expect(isKidsFriendly('tv-y7')).toBe(true)
    })
})
