import { describe, it, expect } from 'vitest';
import {
    aggregateTopContent,
    aggregateTopGenres,
    fillLastNDays,
    typeShare,
    dailyAverageSeconds,
    busiestWeekday
} from './statsDashboardHelpers';
import type { WatchSession, DailyStats } from './usageStatsService';

const session = (name: string, seconds: number, type: WatchSession['contentType'] = 'movie', genre?: string, date = '2026-07-01'): WatchSession => ({
    contentId: name,
    contentType: type,
    contentName: name,
    watchedSeconds: seconds,
    date,
    genre
});

const day = (date: string, totalSeconds: number): DailyStats => ({
    date, totalSeconds, movies: totalSeconds, series: 0, live: 0
});

describe('aggregateTopContent', () => {
    it('soma sessões do mesmo conteúdo e ordena por tempo', () => {
        const top = aggregateTopContent([
            session('Matrix', 600),
            session('Matrix', 400, 'movie', undefined, '2026-07-02'),
            session('Dark', 1500, 'series')
        ]);
        expect(top.map(i => i.name)).toEqual(['Dark', 'Matrix']);
        expect(top[1].seconds).toBe(1000);
    });

    it('não mistura conteúdos homônimos de tipos diferentes e respeita o limite', () => {
        const top = aggregateTopContent([
            session('Globo', 100, 'live'),
            session('Globo', 200, 'movie'),
            session('A', 50), session('B', 40), session('C', 30)
        ], 3);
        expect(top).toHaveLength(3);
        expect(top[0]).toMatchObject({ name: 'Globo', type: 'movie', seconds: 200 });
    });
});

describe('aggregateTopGenres', () => {
    it('agrupa por gênero ignorando sessões sem gênero', () => {
        const top = aggregateTopGenres([
            session('A', 300, 'movie', 'Ação'),
            session('B', 500, 'series', 'Ação'),
            session('C', 400, 'movie', 'Drama'),
            session('D', 999, 'movie')
        ]);
        expect(top).toEqual([
            { name: 'Ação', seconds: 800 },
            { name: 'Drama', seconds: 400 }
        ]);
    });
});

describe('fillLastNDays', () => {
    it('preenche dias sem dados com zeros, terminando em hoje', () => {
        const days = fillLastNDays([day('2026-06-30', 100)], 3, '2026-07-01');
        expect(days.map(d => d.date)).toEqual(['2026-06-29', '2026-06-30', '2026-07-01']);
        expect(days.map(d => d.totalSeconds)).toEqual([0, 100, 0]);
    });

    it('atravessa viradas de mês corretamente', () => {
        const days = fillLastNDays([], 2, '2026-03-01');
        expect(days.map(d => d.date)).toEqual(['2026-02-28', '2026-03-01']);
    });
});

describe('typeShare', () => {
    it('calcula percentuais arredondados', () => {
        expect(typeShare({ movies: 500, series: 300, live: 200 })).toEqual({ movies: 50, series: 30, live: 20 });
    });

    it('retorna zeros sem dados', () => {
        expect(typeShare({ movies: 0, series: 0, live: 0 })).toEqual({ movies: 0, series: 0, live: 0 });
    });
});

describe('dailyAverageSeconds', () => {
    it('inclui dias zerados na média', () => {
        const avg = dailyAverageSeconds([day('2026-07-01', 300)], 3, '2026-07-01');
        expect(avg).toBe(100);
    });
});

describe('busiestWeekday', () => {
    it('retorna o dia da semana com mais tempo acumulado', () => {
        // 2026-06-28 é domingo; 2026-06-29 é segunda
        const result = busiestWeekday([day('2026-06-28', 500), day('2026-06-29', 100), day('2026-07-05', 400)]);
        expect(result).toBe(0); // domingo: 900
    });

    it('retorna null sem dados', () => {
        expect(busiestWeekday([])).toBeNull();
        expect(busiestWeekday([day('2026-07-01', 0)])).toBeNull();
    });
});
