import { describe, it, expect } from 'vitest';
import {
    aggregateTopContent,
    aggregateTopGenres,
    fillLastNDays,
    typeShare,
    dailyAverageSeconds,
    busiestWeekday,
    weekOverWeek,
    computeRecords,
    perProfileUsage,
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

describe('habitHeatmap (dia × faixa de hora)', () => {
    it('acumula por célula e acha o máximo; sessão sem bucket fica de fora', async () => {
        const { habitHeatmap } = await import('./statsDashboardHelpers');
        const { cells, max } = habitHeatmap([
            { date: '2023-01-01', watchedSeconds: 600, hourBucket: 'evening' }, // domingo
            { date: '2023-01-01', watchedSeconds: 300, hourBucket: 'evening' },
            { date: '2023-01-02', watchedSeconds: 120, hourBucket: 'morning' }, // segunda
            { date: '2023-01-02', watchedSeconds: 999 }, // sem bucket
        ]);
        expect(cells[0][2]).toBe(900);
        expect(cells[1][0]).toBe(120);
        expect(max).toBe(900);
    });

    it('vazio não explode', async () => {
        const { habitHeatmap } = await import('./statsDashboardHelpers');
        expect(habitHeatmap([]).max).toBe(0);
    });
});

describe('weekOverWeek (comparação semanal)', () => {
    const day = (date: string, totalSeconds: number) =>
        ({ date, totalSeconds, movies: totalSeconds, series: 0, live: 0 });

    it('separa últimos 7 dias da semana anterior e calcula o delta', () => {
        const daily = [
            day('2026-07-05', 3600), // semana anterior
            day('2026-07-08', 3600), // semana anterior
            day('2026-07-12', 1800), // janela atual (últimos 7 dias de 2026-07-17)
            day('2026-07-16', 1800),
        ];
        const result = weekOverWeek(daily, '2026-07-17');
        expect(result.previousSeconds).toBe(7200);
        expect(result.currentSeconds).toBe(3600);
        expect(result.deltaPct).toBe(-50);
    });

    it('sem base de comparação o delta é null', () => {
        const result = weekOverWeek([day('2026-07-16', 600)], '2026-07-17');
        expect(result.previousSeconds).toBe(0);
        expect(result.deltaPct).toBeNull();
    });
});

describe('computeRecords', () => {
    it('acha o maior dia e os campeões de série/conteúdo', () => {
        const daily = [
            { date: '2026-07-01', totalSeconds: 1200, movies: 0, series: 0, live: 0 },
            { date: '2026-07-02', totalSeconds: 9000, movies: 0, series: 0, live: 0 },
        ];
        const totals = {
            'movie:1': { name: 'Filmão', type: 'movie', seconds: 5000 },
            'series:2': { name: 'Seriado', type: 'series', seconds: 4000 },
            'series:3': { name: 'Novela', type: 'series', seconds: 200 },
        };
        const records = computeRecords(daily, totals);
        expect(records.biggestDay).toEqual({ date: '2026-07-02', seconds: 9000 });
        expect(records.topContent).toEqual({ name: 'Filmão', seconds: 5000 });
        expect(records.topSeries).toEqual({ name: 'Seriado', seconds: 4000 });
    });

    it('sem dados retorna tudo null', () => {
        expect(computeRecords([], undefined)).toEqual({ biggestDay: null, topSeries: null, topContent: null });
    });
});

describe('perProfileUsage', () => {
    it('lê cada perfil, ordena por tempo e tolera registro corrompido', () => {
        const storage: Record<string, string> = {
            usage_stats_p1: JSON.stringify({ totalWatchTimeSeconds: 100 }),
            usage_stats_p2: JSON.stringify({ totalWatchTimeSeconds: 900 }),
            usage_stats_p3: '{corrompido',
        };
        const result = perProfileUsage(
            [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bia' }, { id: 'p3', name: 'Caio' }],
            key => storage[key] ?? null
        );
        expect(result.map(r => r.name)).toEqual(['Bia', 'Ana', 'Caio']);
        expect(result[0].seconds).toBe(900);
        expect(result[2].seconds).toBe(0);
    });
});
