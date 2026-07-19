import { describe, expect, it } from 'vitest';
import { buildHandoffLink } from './mobileHandoff';

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
});
