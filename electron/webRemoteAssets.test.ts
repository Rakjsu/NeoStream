import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { REMOTE_ICON_SVG, buildManifest, solidPng } from './webRemoteAssets'

describe('manifest do controle web (PWA)', () => {
    it('tem os campos de instalabilidade (name, start_url, display, icons)', () => {
        const manifest = JSON.parse(buildManifest()) as Record<string, unknown>
        expect(manifest.name).toBe('NeoStream Controle')
        expect(manifest.start_url).toBe('/')
        expect(manifest.display).toBe('standalone')
        const icons = manifest.icons as { src: string; type: string }[]
        expect(icons.some(i => i.src === '/icon.svg' && i.type === 'image/svg+xml')).toBe(true)
        expect(icons.some(i => i.src === '/icon.png' && i.type === 'image/png')).toBe(true)
    })

    it('o ícone SVG é um documento SVG válido com viewBox', () => {
        expect(REMOTE_ICON_SVG).toContain('<svg')
        expect(REMOTE_ICON_SVG).toContain('viewBox="0 0 192 192"')
    })
})

describe('solidPng (apple-touch-icon do iOS)', () => {
    it('gera um PNG estruturalmente válido nas dimensões pedidas', () => {
        const png = Buffer.from(solidPng(180, 0x4f, 0x46, 0xe5))
        // Assinatura PNG.
        expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        // IHDR: width/height nos offsets 16/20.
        expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR')
        expect(png.readUInt32BE(16)).toBe(180)
        expect(png.readUInt32BE(20)).toBe(180)
        expect(png[24]).toBe(8) // bit depth
        expect(png[25]).toBe(6) // RGBA
        // Termina em IEND.
        expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND')
    })

    it('os pixels descomprimidos são a cor sólida pedida', () => {
        const size = 4
        const png = Buffer.from(solidPng(size, 10, 20, 30))
        // IDAT: primeiro chunk depois do IHDR (assinatura 8 + IHDR 25 = 33).
        const idatLen = png.readUInt32BE(33)
        expect(png.subarray(37, 41).toString('ascii')).toBe('IDAT')
        const raw = zlib.inflateSync(png.subarray(41, 41 + idatLen))
        expect(raw.length).toBe(size * (1 + size * 4))
        expect(raw[0]).toBe(0) // filtro None
        expect([raw[1], raw[2], raw[3], raw[4]]).toEqual([10, 20, 30, 255])
    })
})
