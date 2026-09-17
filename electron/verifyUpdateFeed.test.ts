import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// The verifier is a dependency-free CJS build script; load it like helpers do.
const require = createRequire(import.meta.url)
const { parseFeed, parseFeedVersion, conferirVersao, normalizeName, resolveFileName } = require('../build/verify-update-feed.cjs') as {
    parseFeed: (text: string) => { url: string; sha512?: string; size?: number }[]
    parseFeedVersion: (text: string) => string | null
    conferirVersao: (feedVersion: string | null, pkgVersion: string, refName?: string) => string | null
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

/**
 * 🏷️ A tag, o package.json e o feed têm que falar da MESMA versão.
 *
 * O bump da versão é um commit manual separado ("chore(release): prepare
 * v4.49.0"). Se a tag `v4.50.0` for empurrada de um commit ainda em 4.49.0, o
 * electron-builder gera os três `latest*.yml` com `version: 4.49.0` — e o
 * updater de quem já está em 4.49.0 compara, conclui "já estou atualizado" e
 * NUNCA oferece a nova versão. Para 100% dos usuários, a release não existe.
 */
describe('conferirVersao (tag ↔ package.json ↔ feed)', () => {
    it('tudo igual: nada a reclamar', () => {
        expect(conferirVersao('4.50.0', '4.50.0', 'v4.50.0')).toBeNull()
    })

    it('tag empurrada de um commit que ainda não tinha o bump', () => {
        const problema = conferirVersao('4.49.0', '4.49.0', 'v4.50.0')
        expect(problema).toContain('v4.50.0')
        expect(problema).toContain('4.49.0')
    })

    it('feed gerado antes do bump (build velho na pasta release/)', () => {
        expect(conferirVersao('4.49.0', '4.50.0', 'v4.50.0')).toContain('difere da do package.json')
    })

    it('feed sem o campo version: não dá o que comparar', () => {
        expect(conferirVersao(null, '4.50.0', 'v4.50.0')).toContain('não declara')
    })

    it('fora do CI não há tag — o par feed↔package.json basta', () => {
        // Rodar o verificador na mão, depois de um build local, não pode
        // falhar por causa de uma variável de ambiente que só existe no CI.
        expect(conferirVersao('4.50.0', '4.50.0', undefined)).toBeNull()
        expect(conferirVersao('4.50.0', '4.50.0', '')).toBeNull()
    })

    it('a tag pode vir sem o "v"', () => {
        expect(conferirVersao('4.50.0', '4.50.0', '4.50.0')).toBeNull()
    })
})

describe('parseFeedVersion', () => {
    it('lê o version: do topo do yml', () => {
        const yml = ['version: 4.12.0', 'files:', '  - url: x.exe'].join('\n')
        expect(parseFeedVersion(yml)).toBe('4.12.0')
    })

    it('não confunde com outros campos que terminam em version', () => {
        // `releaseDate`, `path`… e, principalmente, nada de casar no meio da
        // linha: o `version:` do feed é sempre coluna zero.
        expect(parseFeedVersion(['files:', '  - url: x', '    minVersion: 1.0.0'].join('\n'))).toBeNull()
    })

    it('feed sem version devolve null', () => {
        expect(parseFeedVersion('files:\n  - url: x.exe')).toBeNull()
    })
})
