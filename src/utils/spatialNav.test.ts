import { describe, it, expect } from 'vitest';
import { pickSpatialTarget, type NavRect } from './spatialNav';

const rect = (left: number, top: number, w = 100, h = 100): NavRect =>
    ({ left, top, right: left + w, bottom: top + h });

describe('pickSpatialTarget', () => {
    // Grade 2x2: [0]=NW [1]=NE [2]=SW [3]=SE, célula 120px
    const grid = [rect(0, 0), rect(120, 0), rect(0, 120), rect(120, 120)];

    it('anda pela grade nas quatro direções', () => {
        expect(pickSpatialTarget(grid[0], [grid[1], grid[2], grid[3]], 'right')).toBe(0); // NE
        expect(pickSpatialTarget(grid[0], [grid[1], grid[2], grid[3]], 'down')).toBe(1);  // SW
        expect(pickSpatialTarget(grid[3], [grid[0], grid[1], grid[2]], 'up')).toBe(1);    // NE
        expect(pickSpatialTarget(grid[3], [grid[0], grid[1], grid[2]], 'left')).toBe(2);  // SW
    });

    it('prefere mesma linha a diagonal mais próxima', () => {
        const sameRow = rect(240, 0);
        const diagonalCloser = rect(140, 90);
        expect(pickSpatialTarget(grid[0], [diagonalCloser, sameRow], 'right')).toBe(1);
    });

    it('sem candidato na direção → -1', () => {
        expect(pickSpatialTarget(grid[0], [grid[1], grid[2]], 'up')).toBe(-1);
        expect(pickSpatialTarget(grid[0], [], 'down')).toBe(-1);
    });
});
