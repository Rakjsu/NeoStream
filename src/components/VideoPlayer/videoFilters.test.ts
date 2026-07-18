import { describe, it, expect } from 'vitest';
import { filterCssOf, nextVideoFilter, VIDEO_FILTERS } from './playerExtras';

describe('filtros de vídeo (presets da tecla V)', () => {
    it('o ciclo passa por todos e volta pro normal', () => {
        let id = 'normal';
        const seen = [id];
        for (let i = 0; i < VIDEO_FILTERS.length - 1; i++) {
            id = nextVideoFilter(id).id;
            seen.push(id);
        }
        expect(new Set(seen).size).toBe(VIDEO_FILTERS.length);
        expect(nextVideoFilter(id).id).toBe('normal');
    });

    it('filterCssOf resolve o css e cai em none pra id desconhecido', () => {
        expect(filterCssOf('normal')).toBe('none');
        expect(filterCssOf('vivid')).toContain('saturate');
        expect(filterCssOf('inexistente')).toBe('none');
        expect(nextVideoFilter('lixo').id).toBe(VIDEO_FILTERS[0].id);
    });
});
