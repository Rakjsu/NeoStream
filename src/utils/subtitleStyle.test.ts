import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBTITLE_STYLE, loadSubtitleStyle, subtitleCss } from './subtitleStyle';

describe('loadSubtitleStyle', () => {
    it('null/lixo caem no padrão; campo inválido cai campo a campo', () => {
        expect(loadSubtitleStyle(null)).toEqual(DEFAULT_SUBTITLE_STYLE);
        expect(loadSubtitleStyle('{{{')).toEqual(DEFAULT_SUBTITLE_STYLE);
        expect(loadSubtitleStyle(JSON.stringify({ size: 'large', background: 'neon' })))
            .toEqual({ size: 'large', background: 'dark', color: 'white' });
    });
});

describe('subtitleCss', () => {
    it('mapeia tamanho, fundo e cor', () => {
        expect(subtitleCss({ size: 'small', background: 'none', color: 'yellow' }))
            .toEqual({ fontSize: '1.1rem', backgroundColor: 'transparent', color: '#fde047' });
        expect(subtitleCss(DEFAULT_SUBTITLE_STYLE).fontSize).toBe('1.4rem');
        expect(subtitleCss({ ...DEFAULT_SUBTITLE_STYLE, background: 'solid' }).backgroundColor).toBe('rgba(0, 0, 0, 0.85)');
    });
});
