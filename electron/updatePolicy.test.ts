import { describe, it, expect } from 'vitest'
import { checkUpdateArtifacts, checkUpdateFeedConfig, isValidSha512 } from './updatePolicy'

const SHA_B64 = 'A'.repeat(86) + '=='
const SHA_HEX = 'a'.repeat(128)
const EXPECTED = { owner: 'Rakjsu', repo: 'NeoStream' }

describe('isValidSha512', () => {
    it('aceita base64 de 64 bytes e hex de 128', () => {
        expect(isValidSha512(SHA_B64)).toBe(true)
        expect(isValidSha512(SHA_HEX)).toBe(true)
    })

    it('recusa vazio, truncado e não-string', () => {
        expect(isValidSha512('')).toBe(false)
        expect(isValidSha512('AAAA==')).toBe(false)
        expect(isValidSha512(undefined)).toBe(false)
        expect(isValidSha512(null)).toBe(false)
        expect(isValidSha512(123)).toBe(false)
    })
})

describe('checkUpdateArtifacts', () => {
    it('aceita o latest.yml real (todo arquivo com sha512)', () => {
        expect(checkUpdateArtifacts({
            version: '4.46.0',
            path: 'NeoStream-IPTV-Setup-4.46.0.exe',
            sha512: SHA_B64,
            files: [
                { url: 'NeoStream-IPTV-Setup-4.46.0.exe', sha512: SHA_B64, size: 1 },
                { url: 'NeoStream-IPTV-Portable-4.46.0.exe', sha512: SHA_B64, size: 2 },
            ],
        })).toEqual({ ok: true })
    })

    it('RECUSA artefato sem sha512 — sem hash o updater baixa e instala sem conferir nada', () => {
        const verdict = checkUpdateArtifacts({
            version: '4.46.0',
            files: [{ url: 'NeoStream-IPTV-Setup-4.46.0.exe', size: 1 }],
        })
        expect(verdict.ok).toBe(false)
        expect(verdict.ok === false && verdict.reason).toContain('sha512')
    })

    it('recusa quando só UM dos artefatos perdeu o sha512', () => {
        expect(checkUpdateArtifacts({
            version: '4.46.0',
            files: [
                { url: 'a.exe', sha512: SHA_B64 },
                { url: 'b.exe', sha512: '' },
            ],
        }).ok).toBe(false)
    })

    it('recusa sha512 malformado (não é hash de 64 bytes)', () => {
        expect(checkUpdateArtifacts({ version: '1.0.0', files: [{ url: 'a.exe', sha512: 'deadbeef' }] }).ok)
            .toBe(false)
    })

    it('aceita o formato antigo com sha512 só na raiz', () => {
        expect(checkUpdateArtifacts({ version: '1.0.0', path: 'a.exe', sha512: SHA_B64 })).toEqual({ ok: true })
        expect(checkUpdateArtifacts({ version: '1.0.0', path: 'a.exe' }).ok).toBe(false)
    })

    it('recusa feed sem versão ou nulo', () => {
        expect(checkUpdateArtifacts(null).ok).toBe(false)
        expect(checkUpdateArtifacts({ files: [{ url: 'a.exe', sha512: SHA_B64 }] }).ok).toBe(false)
    })
})

describe('checkUpdateFeedConfig', () => {
    const real = [
        'provider: github',
        'owner: Rakjsu',
        'repo: NeoStream',
        'updaterCacheDirName: neostream-iptv-updater',
        '',
    ].join('\n')

    it('aceita o app-update.yml que o build publica hoje', () => {
        expect(checkUpdateFeedConfig(real, EXPECTED)).toEqual({ ok: true })
    })

    it('recusa quando o arquivo foi trocado para outro repositório', () => {
        const swapped = real.replace('owner: Rakjsu', 'owner: atacante')
        expect(checkUpdateFeedConfig(swapped, EXPECTED).ok).toBe(false)
        expect(checkUpdateFeedConfig(real.replace('repo: NeoStream', 'repo: Outro'), EXPECTED).ok).toBe(false)
    })

    it('recusa provedor genérico apontando para um servidor qualquer', () => {
        const generic = 'provider: generic\nurl: http://192.168.0.66/updates\n'
        expect(checkUpdateFeedConfig(generic, EXPECTED).ok).toBe(false)
    })

    it('recusa rebaixamento do transporte para http', () => {
        const downgraded = `${real}protocol: http\n`
        const verdict = checkUpdateFeedConfig(downgraded, EXPECTED)
        expect(verdict.ok).toBe(false)
        expect(verdict.ok === false && verdict.reason).toContain('rebaixado')
    })

    it('recusa host de feed que não é o GitHub', () => {
        expect(checkUpdateFeedConfig(`${real}host: github.evil.test\n`, EXPECTED).ok).toBe(false)
        expect(checkUpdateFeedConfig(`${real}host: github.com\n`, EXPECTED)).toEqual({ ok: true })
    })

    it('recusa url: sobrescrita mesmo com provider github', () => {
        expect(checkUpdateFeedConfig(`${real}url: https://outro.example/feed\n`, EXPECTED).ok).toBe(false)
    })

    it('recusa arquivo ausente ou vazio', () => {
        expect(checkUpdateFeedConfig(null, EXPECTED).ok).toBe(false)
        expect(checkUpdateFeedConfig('   ', EXPECTED).ok).toBe(false)
    })
})
