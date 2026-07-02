import { describe, it, expect } from 'vitest';
import { hourBucketOf, buildHabitProfile, habitBoost } from './habitProfile';
import type { WatchSession } from './usageStatsService';

const split = (g?: string | null) => (g ? g.toLowerCase().split(',').map(s => s.trim()).filter(Boolean) : []);

const session = (overrides: Partial<WatchSession>): WatchSession => ({
    contentId: 'x',
    contentType: 'movie',
    contentName: 'X',
    watchedSeconds: 100,
    date: '2026-06-28', // domingo
    ...overrides
});

describe('hourBucketOf', () => {
    it('mapeia horas para os quatro períodos', () => {
        expect(hourBucketOf(6)).toBe('morning');
        expect(hourBucketOf(11)).toBe('morning');
        expect(hourBucketOf(12)).toBe('afternoon');
        expect(hourBucketOf(17)).toBe('afternoon');
        expect(hourBucketOf(18)).toBe('evening');
        expect(hourBucketOf(23)).toBe('evening');
        expect(hourBucketOf(0)).toBe('night');
        expect(hourBucketOf(5)).toBe('night');
    });
});

describe('buildHabitProfile', () => {
    it('acumula segundos por dia da semana e gênero', () => {
        const profile = buildHabitProfile([
            session({ genre: 'Ação', watchedSeconds: 300 }),
            session({ genre: 'Ação, Drama', watchedSeconds: 200 }),
            session({ genre: 'Comédia', watchedSeconds: 100, date: '2026-06-29' }) // segunda
        ], split);

        expect(profile.weekdayTotals[0]).toBe(500); // domingo
        expect(profile.weekdayGenres[0].get('ação')).toBe(500);
        expect(profile.weekdayGenres[0].get('drama')).toBe(200);
        expect(profile.weekdayTotals[1]).toBe(100); // segunda
    });

    it('só alimenta buckets quando a sessão tem hourBucket', () => {
        const profile = buildHabitProfile([
            session({ genre: 'Ação', hourBucket: 'evening', watchedSeconds: 400 }),
            session({ genre: 'Ação', watchedSeconds: 100 }) // sem bucket (dado legado)
        ], split);

        expect(profile.bucketTotals.evening).toBe(400);
        expect(profile.bucketGenres.evening.get('ação')).toBe(400);
        expect(profile.weekdayTotals[0]).toBe(500);
    });

    it('ignora sessões sem gênero', () => {
        const profile = buildHabitProfile([session({ watchedSeconds: 999 })], split);
        expect(profile.weekdayTotals[0]).toBe(0);
    });
});

describe('habitBoost', () => {
    const profile = buildHabitProfile([
        session({ genre: 'Ação', hourBucket: 'evening', watchedSeconds: 800 }),
        session({ genre: 'Drama', hourBucket: 'evening', watchedSeconds: 200 })
    ], split);

    it('dá boost alto para o gênero dominante no contexto', () => {
        const boost = habitBoost(['ação'], profile, 0, 'evening');
        // domingo: 800/1000 = 0.8; evening: 0.8 → 0.6*0.8 + 0.4*0.8 = 0.8
        expect(boost).toBeCloseTo(0.8);
    });

    it('dá boost menor para gênero minoritário', () => {
        expect(habitBoost(['drama'], profile, 0, 'evening')).toBeCloseTo(0.2);
    });

    it('retorna 0 sem dados no contexto', () => {
        expect(habitBoost(['ação'], profile, 3, 'morning')).toBe(0);
        expect(habitBoost([], profile, 0, 'evening')).toBe(0);
    });
});
