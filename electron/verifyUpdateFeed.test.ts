import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// The verifier is a dependency-free CJS build script; load it like helpers do.
const require = createRequire(import.meta.url)
const { parseFeed, normalizeName, resolveFileName } = require('../build/verify-update-feed.cjs') as {
    parseFeed: (text: string) => { url: string; sha512?: string; size?: number }[]
    normalizeName: (s: string) => string
    resolveFileName: (url: string, releaseFiles: string[]) => string | null
}

describe('parseFeed', () => {
    it('lê url/sha512/size de cada entrada de files:', () => {
        const yml = [
            'version: 4.12.0',
            'files:',
            '  - url: NeoStream-IPTV-Setup-4.12.0.exe',
            '    sha512: AAAA==',
            '    size: 12345',
            '  - url: NeoStream-IPTV-Portable-4.12.0.exe',
            '    sha512: BBBB==',
            '    size: 6789',
            'path: NeoStream-IPTV-Setup-4.12.0.exe',
        ].join('\n')
        expect(parseFeed(yml)).toEqual([
            { url: 'NeoStream-IPTV-Setup-4.12.0.exe', sha512: 'AAAA==', size: 12345 },
            { url: 'NeoStream-IPTV-Portable-4.12.0.exe', sha512: 'BBBB==', size: 6789 },
        ])
    })

    it('decodifica %20 na url', () => {
        expect(parseFeed('files:\n  - url: My%20App-1.0.0.dmg\n    sha512: X==\n')[0].url)
            .toBe('My App-1.0.0.dmg')
    })
})

describe('resolveFileName (quirk de nome do mac)', () => {
    it('casa exato quando o nome bate', () => {
        const files = ['NeoStream-IPTV-Setup-4.12.0.exe', 'latest.yml']
        expect(resolveFileName('NeoStream-IPTV-Setup-4.12.0.exe', files)).toBe('NeoStream-IPTV-Setup-4.12.0.exe')
    })

    it('resolve feed-com-traço → arquivo-com-espaço (o bug que quebrou o v4.12.0)', () => {
        const files = ['NeoStream IPTV-4.12.0-arm64-mac.zip', 'latest-mac.yml']
        expect(resolveFileName('NeoStream-IPTV-4.12.0-arm64-mac.zip', files))
            .toBe('NeoStream IPTV-4.12.0-arm64-mac.zip')
    })

    it('resolve feed-com-traço → arquivo-com-ponto', () => {
        const files = ['NeoStream.IPTV-4.12.0-arm64.dmg']
        expect(resolveFileName('NeoStream-IPTV-4.12.0-arm64.dmg', files))
            .toBe('NeoStream.IPTV-4.12.0-arm64.dmg')
    })

    it('devolve null quando não há arquivo correspondente', () => {
        expect(resolveFileName('sumido-9.9.9.exe', ['outro-1.0.0.exe'])).toBeNull()
    })

    it('normalizeName colapsa espaço/ponto/traço', () => {
        expect(normalizeName('NeoStream IPTV-1.0.zip')).toBe(normalizeName('NeoStream-IPTV.1.0.zip'))
    })
})
