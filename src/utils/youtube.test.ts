import { describe, it, expect } from 'vitest'
import { extractYouTubeId } from './youtube'

describe('extractYouTubeId', () => {
    it('returns a bare 11-char id unchanged', () => {
        expect(extractYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    })

    it('extracts from a watch?v= URL', () => {
        expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    })

    it('extracts from a watch?v= URL with extra params', () => {
        expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=abc')).toBe('dQw4w9WgXcQ')
    })

    it('extracts from a youtu.be short URL', () => {
        expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    })

    it('extracts from a youtu.be URL with query', () => {
        expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=xyz')).toBe('dQw4w9WgXcQ')
    })

    it('extracts from an embed URL', () => {
        expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    })

    it('extracts from a youtube-nocookie embed URL', () => {
        expect(extractYouTubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1')).toBe('dQw4w9WgXcQ')
    })

    it('trims surrounding whitespace', () => {
        expect(extractYouTubeId('  dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ')
    })

    it('returns null for empty string', () => {
        expect(extractYouTubeId('')).toBeNull()
    })

    it('returns null for whitespace only', () => {
        expect(extractYouTubeId('   ')).toBeNull()
    })

    it('returns null for null/undefined', () => {
        expect(extractYouTubeId(null)).toBeNull()
        expect(extractYouTubeId(undefined)).toBeNull()
    })

    it('returns null for garbage with no id', () => {
        expect(extractYouTubeId('not a url')).toBeNull()
        expect(extractYouTubeId('https://example.com/video')).toBeNull()
    })

    it('returns null for a too-short id', () => {
        expect(extractYouTubeId('abc123')).toBeNull()
    })
})
