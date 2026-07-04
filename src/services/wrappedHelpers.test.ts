import { describe, it, expect } from 'vitest';
import { buildWrapped, pickPersona, topContentFromTotals } from './wrappedHelpers';
import type { UsageStats } from './usageStatsService';

const baseStats = (over: Partial<UsageStats> = {}): UsageStats => ({
    totalWatchTimeSeconds: 7200,
    totalWatchTimeThisMonth: 3600,
    sessionsThisMonth: [],
    contentBreakdown: { movies: 3600, series: 2400, live: 1200 },
    watchStreak: 2,
    longestStreak: 9,
    dailyStats: [],
    lastWatchDate: null,
    ...over,
});

describe('pickPersona', () => {
    it('série dominante (>=45%) vira maratonista', () => {
        expect(pickPersona({ movies: 20, series: 60, live: 20 })).toBe('binger');
    });
    it('filmes dominantes vira cinéfilo; TV vira zapeador', () => {
        expect(pickPersona({ movies: 70, series: 10, live: 20 })).toBe('cinephile');
        expect(pickPersona({ movies: 10, series: 20, live: 70 })).toBe('zapper');
    });
    it('sem dominância clara vira explorador', () => {
        expect(pickPersona({ movies: 34, series: 33, live: 33 })).toBe('explorer');
    });
});

describe('topContentFromTotals', () => {
    it('ordena por segundos e corta no limite', () => {
        const totals = {
            a: { name: 'A', type: 'movie' as const, seconds: 100 },
            b: { name: 'B', type: 'live' as const, seconds: 900 },
            c: { name: 'C', type: 'series' as const, seconds: 500 },
        };
        const top = topContentFromTotals(totals, 2);
        expect(top.map(t => t.name)).toEqual(['B', 'C']);
    });
    it('sem mapa retorna vazio', () => {
        expect(topContentFromTotals(undefined)).toEqual([]);
    });
});

describe('buildWrapped', () => {
    it('calcula horas, shares e persona', () => {
        const wrapped = buildWrapped(baseStats());
        expect(wrapped.totalHours).toBe(2);
        expect(wrapped.share.movies).toBe(50);
        expect(wrapped.share.series).toBe(33);
        expect(wrapped.share.live).toBe(17);
        expect(wrapped.persona).toBe('cinephile');
        expect(wrapped.longestStreakDays).toBe(9);
        expect(wrapped.empty).toBe(false);
    });

    it('dia da semana mais assistido vem do dailyStats', () => {
        const wrapped = buildWrapped(baseStats({
            dailyStats: [
                { date: '2026-06-29', totalSeconds: 100, movies: 0, series: 0, live: 100 }, // segunda
                { date: '2026-06-30', totalSeconds: 900, movies: 900, series: 0, live: 0 }, // terça
            ],
        }));
        expect(wrapped.busiestWeekday).toBe(2); // terça
    });

    it('menos de 30 min total marca como vazio', () => {
        const wrapped = buildWrapped(baseStats({
            totalWatchTimeSeconds: 600,
            contentBreakdown: { movies: 600, series: 0, live: 0 },
        }));
        expect(wrapped.empty).toBe(true);
    });

    it('sem nenhum dado: shares zerados e sem dia campeão', () => {
        const wrapped = buildWrapped(baseStats({
            totalWatchTimeSeconds: 0,
            contentBreakdown: { movies: 0, series: 0, live: 0 },
        }));
        expect(wrapped.share).toEqual({ movies: 0, series: 0, live: 0 });
        expect(wrapped.busiestWeekday).toBeNull();
        expect(wrapped.topContent).toEqual([]);
    });
});
