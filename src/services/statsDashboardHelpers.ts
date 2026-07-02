/**
 * Pure aggregation helpers for the statistics dashboard (StatsSection).
 * All functions take explicit inputs (including "today") so they are
 * deterministic and unit-testable.
 */

import type { WatchSession, DailyStats } from './usageStatsService';

export interface RankedItem {
    name: string;
    seconds: number;
    type?: 'movie' | 'series' | 'live';
}

/** Top N contents of the month by accumulated watch time. */
export function aggregateTopContent(sessions: WatchSession[], limit = 5): RankedItem[] {
    const byContent = new Map<string, RankedItem>();
    for (const session of sessions) {
        const key = `${session.contentType}:${session.contentName}`;
        const entry = byContent.get(key);
        if (entry) {
            entry.seconds += session.watchedSeconds;
        } else {
            byContent.set(key, {
                name: session.contentName,
                seconds: session.watchedSeconds,
                type: session.contentType
            });
        }
    }
    return [...byContent.values()]
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, limit);
}

/** Top N genres of the month by accumulated watch time (sessions without genre are skipped). */
export function aggregateTopGenres(sessions: WatchSession[], limit = 5): RankedItem[] {
    const byGenre = new Map<string, number>();
    for (const session of sessions) {
        const genre = session.genre?.trim();
        if (!genre) continue;
        byGenre.set(genre, (byGenre.get(genre) || 0) + session.watchedSeconds);
    }
    return [...byGenre.entries()]
        .map(([name, seconds]) => ({ name, seconds }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, limit);
}

/** Last N days ending at `today` (YYYY-MM-DD), zero-filled for days without data. */
export function fillLastNDays(dailyStats: DailyStats[], n: number, today: string): DailyStats[] {
    const byDate = new Map(dailyStats.map(d => [d.date, d]));
    const result: DailyStats[] = [];
    const base = new Date(today + 'T12:00:00');
    for (let i = n - 1; i >= 0; i--) {
        const date = new Date(base);
        date.setDate(base.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        result.push(byDate.get(dateStr) || { date: dateStr, totalSeconds: 0, movies: 0, series: 0, live: 0 });
    }
    return result;
}

/** Percentage share (0–100, rounded) of each content type; zeros when nothing watched. */
export function typeShare(breakdown: { movies: number; series: number; live: number }): { movies: number; series: number; live: number } {
    const total = breakdown.movies + breakdown.series + breakdown.live;
    if (total <= 0) return { movies: 0, series: 0, live: 0 };
    return {
        movies: Math.round((breakdown.movies / total) * 100),
        series: Math.round((breakdown.series / total) * 100),
        live: Math.round((breakdown.live / total) * 100)
    };
}

/** Average seconds per day over the last N days (counting zero days). */
export function dailyAverageSeconds(dailyStats: DailyStats[], n: number, today: string): number {
    const days = fillLastNDays(dailyStats, n, today);
    const total = days.reduce((sum, d) => sum + d.totalSeconds, 0);
    return Math.round(total / n);
}

/** Weekday (0=Sunday..6=Saturday) with the most accumulated watch time, or null without data. */
export function busiestWeekday(dailyStats: DailyStats[]): number | null {
    const totals = [0, 0, 0, 0, 0, 0, 0];
    for (const day of dailyStats) {
        if (day.totalSeconds <= 0) continue;
        totals[new Date(day.date + 'T12:00:00').getDay()] += day.totalSeconds;
    }
    const max = Math.max(...totals);
    if (max <= 0) return null;
    return totals.indexOf(max);
}
