// NeoStream Wrapped: pure aggregation of a profile's usage stats into the
// retrospective cards. All-time where the data allows (totals, per-content
// map, streaks); windowed where it doesn't (dailyStats keeps 90 days).

import type { UsageStats, ContentTotal } from './usageStatsService';

export interface WrappedTopItem {
    name: string;
    type: 'movie' | 'series' | 'live';
    seconds: number;
}

export type WrappedPersona = 'cinephile' | 'binger' | 'zapper' | 'explorer';

export interface WrappedData {
    totalHours: number;
    /** Share of watch time per type, percentages that sum to ~100. */
    share: { movies: number; series: number; live: number };
    longestStreakDays: number;
    topContent: WrappedTopItem[];
    /** 0=Sunday..6=Saturday, from the 90-day daily window; null without data. */
    busiestWeekday: number | null;
    /** Total distinct titles/channels ever watched (bounded by the totals cap). */
    distinctTitles: number;
    persona: WrappedPersona;
    /** True when there is too little data for a meaningful retrospective. */
    empty: boolean;
}

const MIN_MEANINGFUL_SECONDS = 30 * 60; // half an hour of total watch time

export function pickPersona(share: { movies: number; series: number; live: number }): WrappedPersona {
    const { movies, series, live } = share;
    const max = Math.max(movies, series, live);
    // No clear dominance (<45%): a bit of everything.
    if (max < 45) return 'explorer';
    if (max === series) return 'binger';
    if (max === movies) return 'cinephile';
    return 'zapper';
}

export function topContentFromTotals(totals: Record<string, ContentTotal> | undefined, limit = 5): WrappedTopItem[] {
    if (!totals) return [];
    return Object.values(totals)
        .filter(t => t && typeof t.seconds === 'number' && t.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, limit)
        .map(t => ({ name: t.name, type: t.type, seconds: t.seconds }));
}

export function buildWrapped(stats: UsageStats): WrappedData {
    const total = stats.contentBreakdown.movies + stats.contentBreakdown.series + stats.contentBreakdown.live;
    const share = total > 0
        ? {
            movies: Math.round((stats.contentBreakdown.movies / total) * 100),
            series: Math.round((stats.contentBreakdown.series / total) * 100),
            live: Math.round((stats.contentBreakdown.live / total) * 100),
        }
        : { movies: 0, series: 0, live: 0 };

    // Busiest weekday over the retained daily window.
    const byWeekday = new Array<number>(7).fill(0);
    for (const day of stats.dailyStats) {
        const date = new Date(`${day.date}T12:00:00`); // noon avoids TZ day-shift
        if (!Number.isNaN(date.getTime())) byWeekday[date.getDay()] += day.totalSeconds;
    }
    const maxSeconds = Math.max(...byWeekday);
    const busiest = maxSeconds > 0 ? byWeekday.indexOf(maxSeconds) : null;

    return {
        totalHours: Math.round((stats.totalWatchTimeSeconds / 3600) * 10) / 10,
        share,
        longestStreakDays: stats.longestStreak,
        topContent: topContentFromTotals(stats.contentTotals),
        busiestWeekday: busiest,
        distinctTitles: stats.contentTotals ? Object.keys(stats.contentTotals).length : 0,
        persona: pickPersona(share),
        empty: stats.totalWatchTimeSeconds < MIN_MEANINGFUL_SECONDS,
    };
}
