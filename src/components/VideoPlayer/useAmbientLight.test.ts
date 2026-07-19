import { describe, expect, it } from 'vitest';
import { averageColor } from './useAmbientLight';

describe('averageColor (modo cinema, item 29)', () => {
    it('faz a média RGB dos pixels e escurece pro glow', () => {
        // 2 pixels: (100, 200, 50) e (200, 100, 150) → média (150, 150, 100) × 0.6
        const data = [100, 200, 50, 255, 200, 100, 150, 255];
        expect(averageColor(data)).toBe('rgb(90, 90, 60)');
    });

    it('darken 1 devolve a média pura', () => {
        const data = [10, 20, 30, 255];
        expect(averageColor(data, 1)).toBe('rgb(10, 20, 30)');
    });

    it('sem pixels devolve preto', () => {
        expect(averageColor([])).toBe('rgb(0, 0, 0)');
    });
});
