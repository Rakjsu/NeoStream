/**
 * PWA assets for the phone remote — PURE, no net/electron imports, so the
 * manifest and icon generation are unit-testable. Same from-scratch spirit as
 * the WebSocket/DLNA/Cast code: no image libraries; the PNG is assembled
 * chunk by chunk with node:zlib.
 *
 * Android/Chrome installs off the manifest (SVG icon); iOS ignores manifest
 * icons and uses apple-touch-icon, which must be a PNG — a solid accent
 * square is generated for it.
 */

import zlib from 'node:zlib'

/** App icon: rounded indigo square + a simple white TV (matches the brand). */
export const REMOTE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="192" height="192" rx="42" fill="url(#g)"/>
  <rect x="40" y="62" width="112" height="76" rx="12" fill="none" stroke="#fff" stroke-width="10"/>
  <path d="M74 34l22 24 22-24" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="96" cy="156" r="6" fill="#fff"/>
</svg>
`

// Localized name/description so the installed PWA matches the app language
// (same codes the served page uses; anything unknown falls back to pt).
const MANIFEST_STRINGS: Record<string, { name: string; description: string }> = {
    pt: { name: 'NeoStream Controle', description: 'Controle remoto do NeoStream IPTV' },
    en: { name: 'NeoStream Remote', description: 'NeoStream IPTV remote control' },
    es: { name: 'NeoStream Control', description: 'Control remoto de NeoStream IPTV' },
}

/** Web app manifest — standalone display turns the page into a real app. */
export function buildManifest(lang?: string): string {
    const t = MANIFEST_STRINGS[lang ?? 'pt'] ?? MANIFEST_STRINGS.pt
    return JSON.stringify({
        name: t.name,
        short_name: 'NeoStream',
        description: t.description,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0a0f',
        theme_color: '#0a0a0f',
        icons: [
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icon.png', sizes: '180x180', type: 'image/png' },
        ],
    })
}

// ---- Minimal PNG writer (solid-colour square) -------------------------------

function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = Buffer.from(type, 'ascii')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length, 0)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBytes, data])) >>> 0, 0)
    return Buffer.concat([length, typeBytes, data, crc])
}

/**
 * A solid-colour RGBA PNG (apple-touch-icon fallback for iOS, which can't
 * take the SVG). Structure: signature + IHDR + IDAT (deflated scanlines,
 * filter 0 per row) + IEND.
 */
export function solidPng(size: number, r: number, g: number, b: number): Uint8Array {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(size, 0)  // width
    ihdr.writeUInt32BE(size, 4)  // height
    ihdr[8] = 8                  // bit depth
    ihdr[9] = 6                  // colour type: RGBA
    // compression / filter / interlace = 0

    // Each scanline: 1 filter byte (0 = None) + size * RGBA.
    const raw = Buffer.alloc(size * (1 + size * 4))
    for (let y = 0; y < size; y++) {
        const row = y * (1 + size * 4)
        for (let x = 0; x < size; x++) {
            const px = row + 1 + x * 4
            raw[px] = r
            raw[px + 1] = g
            raw[px + 2] = b
            raw[px + 3] = 255
        }
    }

    return Buffer.concat([
        signature,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
    ])
}
