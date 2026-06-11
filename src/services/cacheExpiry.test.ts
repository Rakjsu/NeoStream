import { describe, it, expect } from 'vitest'
import { isExpired, KIDS_FILTER_CACHE_TTL_MS } from './cacheExpiry'

const NOW = 1_750_000_000_000

describe('isExpired', () => {
    it('keeps fresh entries', () => {
        expect(isExpired(NOW - 1000, KIDS_FILTER_CACHE_TTL_MS, NOW)).toBe(false)
        expect(isExpired(NOW, KIDS_FILTER_CACHE_TTL_MS, NOW)).toBe(false)
    })

    it('expires entries older than the TTL', () => {
        expect(isExpired(NOW - KIDS_FILTER_CACHE_TTL_MS - 1, KIDS_FILTER_CACHE_TTL_MS, NOW)).toBe(true)
    })

    it('boundary: exactly at the TTL is still fresh', () => {
        expect(isExpired(NOW - KIDS_FILTER_CACHE_TTL_MS, KIDS_FILTER_CACHE_TTL_MS, NOW)).toBe(false)
    })

    it('treats legacy records without a timestamp as expired', () => {
        expect(isExpired(undefined, KIDS_FILTER_CACHE_TTL_MS, NOW)).toBe(true)
        expect(isExpired(NaN, KIDS_FILTER_CACHE_TTL_MS, NOW)).toBe(true)
    })
})
