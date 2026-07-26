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
