import { describe, it, expect } from 'vitest';
import { aggregatePlaylistTime, heatLevel, yearHeatmap } from './statsDashboardHelpers';
import type { WatchSession } from './usageStatsService';

describe('heatLevel', () => {
    it('degraus: 0, <30min, <1h, <2h, 2h+', () => {
        expect(heatLevel(0)).toBe(0);
        expect(heatLevel(10 * 60)).toBe(1);
        expect(heatLevel(45 * 60)).toBe(2);
        expect(heatLevel(90 * 60)).toBe(3);
        expect(heatLevel(3 * 3600)).toBe(4);
    });
});

describe('yearHeatmap', () => {
    // 2026-07-15 é uma quarta — a semana corrente tem dias futuros.
    const TODAY = '2026-07-15';

    it('grade estável de semanas×7 terminando na semana de hoje', () => {
        const grid = yearHeatmap([], TODAY, 3);
        expect(grid).toHaveLength(3);
        for (const week of grid) expect(week).toHaveLength(7);
        const lastWeek = grid[2];
        expect(lastWeek.some(cell => cell.date === TODAY)).toBe(true);
        // depois de hoje (qui/sex/sáb) vira célula invisível
        expect(lastWeek.filter(cell => cell.level === -1)).toHaveLength(3);
    });

    it('dias com registro ganham nível; sem registro ficam 0', () => {
        const grid = yearHeatmap([
            { date: '2026-07-14', totalSeconds: 3 * 3600, movies: 0, series: 0, live: 0 },
        ], TODAY, 2);
        const all = grid.flat();
        expect(all.find(cell => cell.date === '2026-07-14')?.level).toBe(4);
        expect(all.find(cell => cell.date === '2026-07-13')?.level).toBe(0);
    });
});

describe('aggregatePlaylistTime', () => {
    const session = (playlistId: string | undefined, seconds: number): WatchSession => ({
        contentId: 'x', contentType: 'movie', contentName: 'X',
        watchedSeconds: seconds, date: '2026-07-10', playlistId,
    });

    it('agrupa por playlist, soma e ordena do maior pro menor', () => {
        const result = aggregatePlaylistTime([
            session('a', 100), session('b', 500), session('a', 200), session(undefined, 50),
        ]);
        expect(result).toEqual([
            { playlistId: 'b', seconds: 500 },
            { playlistId: 'a', seconds: 300 },
            { playlistId: 'default', seconds: 50 },
        ]);
    });
});
