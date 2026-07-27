import { describe, expect, it } from 'vitest';
import { buildHandoffLink, HANDOFF_QR_MAX_BYTES } from './mobileHandoff';
import { qrToSvg } from './qrEncoder';

describe('buildHandoffLink (item 39 — QR pro celular)', () => {
    it('monta o deep link com posição inteira', () => {
        const link = buildHandoffLink({ kind: 'movie', sid: '42', container: 'mkv', name: 'Filme' }, 4520.7);
        expect(link).toBe('neostream://open-content?kind=movie&sid=42&container=mkv&name=Filme&pos=4520');
    });

    it('escapa o nome e usa mp4 como container default', () => {
        const link = buildHandoffLink({ kind: 'series', sid: 'e9', container: '', name: 'Série · S01E02' }, 10);
        expect(link).toContain('kind=series');
        expect(link).toContain('container=mp4');
        expect(link).not.toContain(' ');
    });

    it('posição inválida ou negativa vira 0', () => {
        expect(buildHandoffLink({ kind: 'movie', sid: '1', container: 'mp4', name: 'x' }, NaN)).toContain('pos=0');
        expect(buildHandoffLink({ kind: 'movie', sid: '1', container: 'mp4', name: 'x' }, -5)).toContain('pos=0');
    });

    // 🔒 Regressão: nome longo estourava o QR v1–4 e derrubava a tela do player
    // ("conteúdo grande demais para QR v1–4"). O link agora sempre cabe.
    it('trunca o nome pra caber no QR e o qrToSvg nunca lança', () => {
        const longName = 'Bambi: Uma aventura na floresta '.repeat(5); // ~160 chars
        const link = buildHandoffLink({ kind: 'movie', sid: '999999', container: 'mkv', name: longName }, 3600);
        expect(link.length).toBeLessThanOrEqual(HANDOFF_QR_MAX_BYTES);
        // sid/pos preservados, e o QR é gerado sem exceção.
        expect(link).toContain('sid=999999');
        expect(link).toContain('pos=3600');
        expect(() => qrToSvg(link, 4)).not.toThrow();
    });

    it('nome curto passa inteiro (sem truncar à toa)', () => {
        const link = buildHandoffLink({ kind: 'movie', sid: '42', container: 'mkv', name: 'Filme' }, 10);
        expect(link).toContain('name=Filme');
        expect(() => qrToSvg(link, 4)).not.toThrow();
    });
});

// 🔒 Regressão (auditoria R3): o nome chegava corrompido no celular — '+' no
// lugar do espaço (form-encoding do URLSearchParams, que o parser de query do
// expo-router não desfaz) e '�' quando a truncation binária de 78 BYTES partia
// um emoji ao meio. O teto de 78 é real (o encoder de QR só vai até a v4).
describe('nome no handoff (encoding e fronteira dos 78 bytes)', () => {
    const REPLACEMENT = String.fromCharCode(0xfffd);
    const LONE_SURROGATE = String.fromCharCode(0xd83d);

    const nameOf = (link: string): string => {
        const match = link.match(/[?&]name=([^&]*)/);
        return match ? decodeURIComponent(match[1]) : '';
    };
    // Array.from junta o par substituto; sobrando 1 unidade UTF-16 na faixa
    // D800–DFFF, o nome foi cortado no meio de um emoji.
    const semSurrogateSolto = (text: string): boolean =>
        Array.from(text).every(char => {
            const code = char.charCodeAt(0);
            return char.length === 2 || code < 0xd800 || code > 0xdfff;
        });

    it('espaço vira %20 (e não +) e o acento sobrevive', () => {
        const espaco = buildHandoffLink({ kind: 'movie', sid: '4', container: 'ts', name: 'O Rei' }, 0);
        expect(espaco).toContain('name=O%20Rei');
        expect(espaco).not.toContain('+');
        expect(nameOf(espaco)).toBe('O Rei');

        const acento = buildHandoffLink({ kind: 'movie', sid: '4', container: 'ts', name: 'Leão' }, 0);
        expect(acento).toContain('name=Le%C3%A3o');
        expect(nameOf(acento)).toBe('Leão');
    });

    it('emoji nunca é partido, em qualquer alinhamento do limite', () => {
        for (let filler = 0; filler <= 90; filler++) {
            const name = `${'A'.repeat(filler)}😀🎬${'B'.repeat(6)}`;
            const link = buildHandoffLink({ kind: 'movie', sid: '4', container: 'ts', name }, 0);
            expect(link.length).toBeLessThanOrEqual(HANDOFF_QR_MAX_BYTES);
            const title = nameOf(link);
            expect(title).not.toContain(REPLACEMENT);
            expect(semSurrogateSolto(title)).toBe(true);
            expect(name.startsWith(title)).toBe(true);
            expect(() => qrToSvg(link, 4)).not.toThrow();
        }
    });

    it('acento na fronteira não vira � nem estoura o QR', () => {
        for (let filler = 0; filler <= 90; filler++) {
            const name = `${'A'.repeat(filler)}ção São Paulo`;
            const link = buildHandoffLink({ kind: 'series', sid: 'e9', container: 'mp4', name }, 0);
            expect(link.length).toBeLessThanOrEqual(HANDOFF_QR_MAX_BYTES);
            const title = nameOf(link);
            expect(title).not.toContain(REPLACEMENT);
            expect(name.startsWith(title)).toBe(true);
            expect(() => qrToSvg(link, 4)).not.toThrow();
        }
    });

    it('surrogate solto na entrada não derruba o encodeURIComponent', () => {
        const link = buildHandoffLink(
            { kind: 'movie', sid: '4', container: 'ts', name: `A${LONE_SURROGATE}B` }, 0);
        expect(nameOf(link)).toBe('AB');
    });
});
