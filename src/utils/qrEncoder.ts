/**
 * Minimal QR Code encoder — PURE, no deps. Byte mode, EC level L, versions
 * 1–4 (single ECC block, which covers the ~30-char LAN URL + PIN the phone
 * remote needs). Enough to render a scannable code as inline SVG offline.
 *
 * Pieces: byte-mode bitstream → pad → Reed-Solomon ECC over GF(256) →
 * matrix (finders/timing/format/data zig-zag) → mask 0. The GF(256) and RS
 * are the error-prone parts and are unit-tested against known vectors.
 */

// ---- GF(256) arithmetic (QR uses the 0x11D primitive polynomial) ----------
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
;(function initGf() {
    let x = 1
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x
        GF_LOG[x] = i
        x <<= 1
        if (x & 0x100) x ^= 0x11d
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
})()

export function gfMul(a: number, b: number): number {
    if (a === 0 || b === 0) return 0
    return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

/**
 * Reed-Solomon generator polynomial of the given degree, coefficients from
 * highest degree to lowest (leading 1 first) — matches the QR spec's Appendix
 * A vectors and the convention rsEncode expects.
 */
export function rsGeneratorPoly(degree: number): number[] {
    // Build with coefficients low→high, then reverse to high→low.
    let poly = [1]
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0)
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= gfMul(poly[j], GF_EXP[i])
            next[j + 1] ^= poly[j]
        }
        poly = next
    }
    return poly.reverse()
}

/** ECC codewords for `data` given the number of EC codewords. */
export function rsEncode(data: number[], ecCount: number): number[] {
    const gen = rsGeneratorPoly(ecCount) // monic, length ecCount+1
    const res = new Array(ecCount).fill(0)
    for (const byte of data) {
        const factor = byte ^ res[0]
        res.shift()
        res.push(0)
        // Skip the leading coefficient (gen[0] === 1, consumed by `factor`).
        for (let i = 0; i < ecCount; i++) {
            res[i] ^= gfMul(gen[i + 1], factor)
        }
    }
    return res
}

// ---- Version capacity (byte mode, EC level L, single block) ---------------
interface VersionSpec { version: number; size: number; dataCodewords: number; ecCodewords: number }
const VERSIONS: VersionSpec[] = [
    { version: 1, size: 21, dataCodewords: 19, ecCodewords: 7 },
    { version: 2, size: 25, dataCodewords: 34, ecCodewords: 10 },
    { version: 3, size: 29, dataCodewords: 55, ecCodewords: 15 },
    { version: 4, size: 33, dataCodewords: 80, ecCodewords: 20 },
]

function pickVersion(byteLen: number): VersionSpec {
    // 2 bytes overhead: mode nibble + 8-bit char count (versions 1–9).
    for (const spec of VERSIONS) {
        if (byteLen + 2 <= spec.dataCodewords) return spec
    }
    throw new Error('conteúdo grande demais para QR v1–4')
}

// ---- Bitstream ------------------------------------------------------------
class BitBuffer {
    bits: number[] = []
    put(value: number, length: number): void {
        for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1)
    }
    toBytes(): number[] {
        const bytes: number[] = []
        for (let i = 0; i < this.bits.length; i += 8) {
            let b = 0
            for (let j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] ?? 0)
            bytes.push(b)
        }
        return bytes
    }
}

function encodeData(text: string, spec: VersionSpec): number[] {
    const utf8 = Array.from(new TextEncoder().encode(text))
    const buf = new BitBuffer()
    buf.put(0b0100, 4) // byte mode
    buf.put(utf8.length, 8) // char count (versions 1–9)
    for (const byte of utf8) buf.put(byte, 8)
    // Terminator + byte-align.
    const capacityBits = spec.dataCodewords * 8
    buf.put(0, Math.min(4, capacityBits - buf.bits.length))
    while (buf.bits.length % 8 !== 0) buf.bits.push(0)
    // Pad bytes.
    const bytes = buf.toBytes()
    const pads = [0xec, 0x11]
    let p = 0
    while (bytes.length < spec.dataCodewords) bytes.push(pads[p++ % 2])
    return bytes
}

// ---- Matrix ---------------------------------------------------------------
const FINDER = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
]
// Alignment pattern center for versions 2–4 (single position).
const ALIGN_CENTER: Record<number, number> = { 2: 18, 3: 22, 4: 26 }

/** Build the module matrix (true = dark) for the given text. */
export function encodeQr(text: string): boolean[][] {
    const utf8Len = new TextEncoder().encode(text).length
    const spec = pickVersion(utf8Len)
    const n = spec.size
    const data = encodeData(text, spec)
    const ec = rsEncode(data, spec.ecCodewords)
    const codewords = [...data, ...ec]

    const matrix: (boolean | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null))
    const reserved: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false))

    const place = (r: number, c: number, dark: boolean) => { matrix[r][c] = dark; reserved[r][c] = true }

    // Finder patterns + separators at three corners.
    const putFinder = (top: number, left: number) => {
        for (let r = -1; r <= 7; r++) {
            for (let c = -1; c <= 7; c++) {
                const rr = top + r, cc = left + c
                if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue
                const inside = r >= 0 && r < 7 && c >= 0 && c < 7
                place(rr, cc, inside ? FINDER[r][c] === 1 : false)
            }
        }
    }
    putFinder(0, 0); putFinder(0, n - 7); putFinder(n - 7, 0)

    // Timing patterns.
    for (let i = 8; i < n - 8; i++) {
        place(6, i, i % 2 === 0)
        place(i, 6, i % 2 === 0)
    }

    // Alignment pattern (versions 2–4).
    const ac = ALIGN_CENTER[spec.version]
    if (ac !== undefined) {
        for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
                const ring = Math.max(Math.abs(r), Math.abs(c))
                place(ac + r, ac + c, ring !== 1)
            }
        }
    }

    // Dark module + reserve format-info areas.
    place(n - 8, 8, true)
    for (let i = 0; i < 9; i++) { reserved[8][i] = true; reserved[i][8] = true }
    for (let i = 0; i < 8; i++) { reserved[8][n - 1 - i] = true; reserved[n - 1 - i][8] = true }

    // Data placement: zig-zag column pairs right→left, alternating up/down,
    // skipping the vertical timing column (6).
    const maskFn = (r: number, c: number) => (r + c) % 2 === 0 // mask pattern 0
    let bitIndex = 0
    const totalBits = codewords.length * 8
    let dirUp = true
    for (let col = n - 1; col > 0; col -= 2) {
        const rightCol = col === 6 ? col - 1 : col // shift past the timing column
        for (let i = 0; i < n; i++) {
            const row = dirUp ? n - 1 - i : i
            for (const c of [rightCol, rightCol - 1]) {
                if (c < 0 || reserved[row][c]) continue
                let dark = false
                if (bitIndex < totalBits) {
                    const byte = codewords[bitIndex >> 3]
                    dark = ((byte >> (7 - (bitIndex & 7))) & 1) === 1
                    bitIndex++
                }
                if (maskFn(row, c)) dark = !dark
                matrix[row][c] = dark
            }
        }
        dirUp = !dirUp
    }

    // Format info: EC level L (01) + mask 0 (000) → 15 bits with BCH.
    const formatBits = formatInfoBits(0b01, 0b000)
    for (let i = 0; i < 15; i++) {
        const bit = ((formatBits >> i) & 1) === 1
        // Around top-left.
        if (i < 6) matrix[i][8] = bit
        else if (i === 6) matrix[7][8] = bit
        else if (i === 7) matrix[8][8] = bit
        else if (i === 8) matrix[8][7] = bit
        else matrix[8][14 - i] = bit
        // Mirrored copy.
        if (i < 8) matrix[8][n - 1 - i] = bit
        else matrix[n - 15 + i][8] = bit
    }

    return matrix.map(row => row.map(v => v === true))
}

/** 15-bit format info with BCH(15,5) + the QR mask 0x5412. */
export function formatInfoBits(ecLevel: number, mask: number): number {
    const data = ((ecLevel & 0b11) << 3) | (mask & 0b111)
    let value = data << 10
    const g = 0b10100110111
    for (let i = 4; i >= 0; i--) {
        if ((value >> (10 + i)) & 1) value ^= g << i
    }
    return ((data << 10) | value) ^ 0b101010000010010
}

/** Render a QR matrix as an inline SVG string (no external assets). */
export function qrToSvg(text: string, moduleSize = 6, quiet = 4): string {
    const matrix = encodeQr(text)
    const n = matrix.length
    const dim = (n + quiet * 2) * moduleSize
    let rects = ''
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (matrix[r][c]) {
                const x = (c + quiet) * moduleSize
                const y = (r + quiet) * moduleSize
                rects += `<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}"/>`
            }
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">` +
        `<rect width="${dim}" height="${dim}" fill="#fff"/><g fill="#000">${rects}</g></svg>`
}
