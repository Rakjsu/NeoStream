import { describe, it, expect } from 'vitest';
import { gfMul, rsGeneratorPoly, rsEncode, formatInfoBits, encodeQr, qrToSvg } from './qrEncoder';

describe('GF(256)', () => {
    it('multiplica conforme o campo do QR (0x11D)', () => {
        expect(gfMul(0, 5)).toBe(0);
        expect(gfMul(1, 1)).toBe(1);
        // Vetores conhecidos: 0x53 * 0xCA = 0x01 no GF(256) do QR/AES-like? usa 0x11D
        expect(gfMul(2, 2)).toBe(4);
        expect(gfMul(0x80, 0x02)).toBe(0x1d); // overflow reduz por 0x11D
    });
});

describe('Reed-Solomon', () => {
    it('polinômios geradores batem com os vetores da spec QR (Appendix A)', () => {
        // Valores decimais autoritativos (Nayuki / ISO 18004 Appendix A).
        expect(rsGeneratorPoly(7)).toEqual([1, 127, 122, 154, 164, 11, 68, 117]);
        expect(rsGeneratorPoly(10)).toEqual([1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193]);
    });
    it('rsEncode devolve exatamente ecCount codewords', () => {
        expect(rsEncode([1, 2, 3, 4, 5], 7)).toHaveLength(7);
        // Divisão exata: dados só de zeros → EC só de zeros.
        expect(rsEncode([0, 0, 0], 5)).toEqual([0, 0, 0, 0, 0]);
    });
});

describe('format info', () => {
    it('(L, mask 0) = 0x77C4', () => {
        expect(formatInfoBits(0b01, 0b000)).toBe(0x77c4);
    });
});

describe('encodeQr / qrToSvg', () => {
    it('URL curta gera matriz quadrada com finders nos 3 cantos', () => {
        const m = encodeQr('http://192.168.0.5:54321/');
        expect(m.length).toBe(m[0].length); // quadrada
        // Finder = 7x7 com borda escura; canto superior-esquerdo (0,0) escuro.
        expect(m[0][0]).toBe(true);
        expect(m[0][6]).toBe(true);
        expect(m[6][0]).toBe(true);
        expect(m[1][1]).toBe(false); // anel branco do finder
        // Canto superior-direito e inferior-esquerdo também têm finder.
        expect(m[0][m.length - 1]).toBe(true);
        expect(m[m.length - 1][0]).toBe(true);
    });
    it('timing pattern alterna na linha/coluna 6', () => {
        const m = encodeQr('teste');
        expect(m[6][8]).toBe(true);  // par
        expect(m[6][9]).toBe(false); // ímpar
    });
    it('qrToSvg produz um SVG com retângulos', () => {
        const svg = qrToSvg('http://x/');
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).toContain('<rect');
    });
});
