import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usageStatsService, type UsageStats } from './usageStatsService';

// Sem perfil ativo o serviço usa a chave "usage_stats_default".
const KEY = 'usage_stats_default';

function readStats(): UsageStats {
    return JSON.parse(localStorage.getItem(KEY)!) as UsageStats;
}

describe('usageStatsService', () => {
    beforeEach(() => {
        localStorage.clear();
        // Congela só o Date (timers reais continuam rodando — o serviço usa
        // setInterval de 30s que não interessa aqui).
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-07-06T20:00:00Z'));
    });
    afterEach(() => {
        usageStatsService.endSession();
        vi.useRealTimers();
    });

    it('sessão de 90s soma no total, no dia e no breakdown do tipo', () => {
        usageStatsService.startSession('m1', 'movie', 'Filme Teste');
        vi.setSystemTime(new Date('2026-07-06T20:01:30Z')); // +90s
        usageStatsService.endSession();

        const stats = readStats();
        expect(stats.totalWatchTimeSeconds).toBe(90);
        expect(stats.contentBreakdown.movies).toBe(90);
        expect(stats.dailyStats).toHaveLength(1);
        expect(stats.dailyStats[0]).toMatchObject({ date: '2026-07-06', totalSeconds: 90, movies: 90 });
        expect(stats.sessionsThisMonth).toHaveLength(1);
        expect(stats.sessionsThisMonth[0]).toMatchObject({
            contentId: 'm1', contentType: 'movie', contentName: 'Filme Teste', watchedSeconds: 90,
        });
        expect(stats.sessionsThisMonth[0].hourBucket).toBeTruthy();
        expect(stats.contentTotals?.m1.seconds).toBe(90);
    });

    it('mesma sessão no mesmo dia agrega em vez de duplicar', () => {
        usageStatsService.startSession('s1', 'series', 'Série');
        vi.setSystemTime(new Date('2026-07-06T20:01:00Z'));
        usageStatsService.endSession();
        usageStatsService.startSession('s1', 'series', 'Série');
        vi.setSystemTime(new Date('2026-07-06T20:02:00Z'));
        usageStatsService.endSession();

        const stats = readStats();
        expect(stats.sessionsThisMonth).toHaveLength(1);
        expect(stats.sessionsThisMonth[0].watchedSeconds).toBe(120);
        expect(stats.contentBreakdown.series).toBe(120);
    });

    it('streak: assistiu ontem → estende; buraco → volta pra 1', () => {
        // Ontem no ledger com streak 3.
        const seeded = { ...usageStatsService.getStats(), watchStreak: 3, longestStreak: 5, lastWatchDate: '2026-07-05' };
        localStorage.setItem(KEY, JSON.stringify(seeded));
        usageStatsService.startSession('m1', 'movie', 'F');
        vi.setSystemTime(new Date('2026-07-06T20:00:30Z'));
        usageStatsService.endSession();
        expect(readStats().watchStreak).toBe(4);
        expect(readStats().longestStreak).toBe(5);

        // Última vez há 3 dias → streak quebra pra 1.
        localStorage.setItem(KEY, JSON.stringify({ ...readStats(), watchStreak: 4, lastWatchDate: '2026-07-03' }));
        usageStatsService.startSession('m1', 'movie', 'F');
        vi.setSystemTime(new Date('2026-07-06T20:01:30Z'));
        usageStatsService.endSession();
        expect(readStats().watchStreak).toBe(1);
    });

    it('getWeeklyStats devolve 7 dias, preenchendo zeros', () => {
        usageStatsService.startSession('l1', 'live', 'Canal');
        vi.setSystemTime(new Date('2026-07-06T20:01:00Z'));
        usageStatsService.endSession();

        const week = usageStatsService.getWeeklyStats();
        expect(week).toHaveLength(7);
        expect(week[6]).toMatchObject({ date: '2026-07-06', live: 60 });
        expect(week[0]).toMatchObject({ date: '2026-06-30', totalSeconds: 0 });
    });

    it('contentTotals é limitado: passou de 400 → mantém os 300 mais assistidos', () => {
        const totals: Record<string, { name: string; type: 'movie'; seconds: number }> = {};
        for (let i = 1; i <= 400; i++) {
            totals[`c${i}`] = { name: `C${i}`, type: 'movie', seconds: i };
        }
        localStorage.setItem(KEY, JSON.stringify({ ...usageStatsService.getStats(), contentTotals: totals }));

        usageStatsService.startSession('novo', 'movie', 'Novo');
        vi.setSystemTime(new Date('2026-07-06T20:30:00Z')); // 30min — entra no top
        usageStatsService.endSession();

        const kept = Object.keys(readStats().contentTotals!);
        expect(kept).toHaveLength(300);
        expect(kept).toContain('novo');      // 1800s, topo
        expect(kept).not.toContain('c1');    // 1s, poda
    });

    it('formatTime e getMostWatchedType', () => {
        expect(usageStatsService.formatTime(3661).formatted).toBe('1h 1min');
        expect(usageStatsService.formatTime(300).formatted).toBe('5min');

        expect(usageStatsService.getMostWatchedType()).toBeNull(); // vazio
        localStorage.setItem(KEY, JSON.stringify({
            ...usageStatsService.getStats(),
            contentBreakdown: { movies: 10, series: 50, live: 20 },
        }));
        expect(usageStatsService.getMostWatchedType()).toBe('series');
    });
});

describe('o dia é o do calendário local, não o de Greenwich', () => {
    // O vitest.config.ts fixa TZ=America/Sao_Paulo (UTC−3): é o fuso do dono
    // do app, e o defeito só existe fora de Greenwich.
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => {
        usageStatsService.endSession();
        vi.useRealTimers();
    });

    it('sábado 22h e domingo 20h são DOIS dias: a sequência anda', () => {
        // Carimbando em UTC, as duas noites caíam em 2026-07-05: um balde só
        // de estatística e `updateStreak` saindo no `lastWatchDate === today`.
        // Quem assiste toda noite via a sequência travada em 1.
        vi.setSystemTime(new Date('2026-07-05T01:00:00Z')); // sáb 04/07, 22h em SP
        usageStatsService.startSession('m1', 'movie', 'F');
        vi.setSystemTime(new Date('2026-07-05T01:01:00Z'));
        usageStatsService.endSession();

        vi.setSystemTime(new Date('2026-07-05T23:00:00Z')); // dom 05/07, 20h em SP
        usageStatsService.startSession('m1', 'movie', 'F');
        vi.setSystemTime(new Date('2026-07-05T23:01:00Z'));
        usageStatsService.endSession();

        const stats = readStats();
        expect(stats.dailyStats.map(d => d.date)).toEqual(['2026-07-04', '2026-07-05']);
        expect(stats.watchStreak).toBe(2);
    });

    it('sexta 19h e sábado 22h são consecutivos: a sequência não zera', () => {
        // O outro lado do mesmo erro: o "ontem" calculado em UTC não casava
        // com o dia gravado, e duas noites seguidas viravam streak 1.
        vi.setSystemTime(new Date('2026-07-03T22:00:00Z')); // sex 03/07, 19h em SP
        usageStatsService.startSession('m1', 'movie', 'F');
        vi.setSystemTime(new Date('2026-07-03T22:01:00Z'));
        usageStatsService.endSession();
        expect(readStats().lastWatchDate).toBe('2026-07-03');

        vi.setSystemTime(new Date('2026-07-05T01:00:00Z')); // sáb 04/07, 22h em SP
        usageStatsService.startSession('m1', 'movie', 'F');
        vi.setSystemTime(new Date('2026-07-05T01:01:00Z'));
        usageStatsService.endSession();

        expect(readStats().lastWatchDate).toBe('2026-07-04');
        expect(readStats().watchStreak).toBe(2);
    });

    it('a semana do painel fecha no dia local', () => {
        vi.setSystemTime(new Date('2026-07-05T01:00:00Z')); // sáb 04/07, 22h em SP
        usageStatsService.startSession('l1', 'live', 'Canal');
        vi.setSystemTime(new Date('2026-07-05T01:01:00Z'));
        usageStatsService.endSession();

        const semana = usageStatsService.getWeeklyStats();
        expect(semana[6]).toMatchObject({ date: '2026-07-04', live: 60 });
    });
});
