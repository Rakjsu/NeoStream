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

/**
 * Heatmap de hábitos: segundos assistidos por dia-da-semana × faixa de hora
 * (manhã/tarde/noite/madrugada). Tipo estrutural pra não acoplar no
 * usageStatsService — qualquer sessão com date + hourBucket serve (PURO).
 */
export function habitHeatmap(sessions: { date: string; watchedSeconds: number; hourBucket?: string }[]): { cells: number[][]; max: number } {
    const bucketIndex: Record<string, number> = { morning: 0, afternoon: 1, evening: 2, night: 3 };
    const cells = Array.from({ length: 7 }, () => [0, 0, 0, 0]);
    let max = 0;
    for (const session of sessions) {
        const bucket = session.hourBucket ? bucketIndex[session.hourBucket] : undefined;
        if (bucket === undefined) continue;
        const [year, month, day] = session.date.split('-').map(Number);
        if (!year || !month || !day) continue;
        const weekday = new Date(year, month - 1, day).getDay();
        cells[weekday][bucket] += session.watchedSeconds;
        max = Math.max(max, cells[weekday][bucket]);
    }
    return { cells, max };
}

/** Semana atual (últimos 7 dias) vs anterior (8–14 dias atrás), com delta %. */
export interface WeekComparison {
    currentSeconds: number;
    previousSeconds: number;
    /** null quando não há base de comparação (semana anterior zerada). */
    deltaPct: number | null;
}

export function weekOverWeek(dailyStats: DailyStats[], today: string): WeekComparison {
    const last14 = fillLastNDays(dailyStats, 14, today);
    const previousSeconds = last14.slice(0, 7).reduce((sum, d) => sum + d.totalSeconds, 0);
    const currentSeconds = last14.slice(7).reduce((sum, d) => sum + d.totalSeconds, 0);
    const deltaPct = previousSeconds > 0
        ? Math.round(((currentSeconds - previousSeconds) / previousSeconds) * 100)
        : null;
    return { currentSeconds, previousSeconds, deltaPct };
}

/** Recordes deriváveis dos dados existentes (dia 90d + contentTotals all-time). */
export interface StatsRecords {
    biggestDay: { date: string; seconds: number } | null;
    topSeries: { name: string; seconds: number } | null;
    topContent: { name: string; seconds: number } | null;
}

export function computeRecords(
    dailyStats: DailyStats[],
    contentTotals?: Record<string, { name: string; type: string; seconds: number }>
): StatsRecords {
    let biggestDay: StatsRecords['biggestDay'] = null;
    for (const day of dailyStats) {
        if (day.totalSeconds > 0 && (!biggestDay || day.totalSeconds > biggestDay.seconds)) {
            biggestDay = { date: day.date, seconds: day.totalSeconds };
        }
    }
    let topSeries: StatsRecords['topSeries'] = null;
    let topContent: StatsRecords['topContent'] = null;
    for (const entry of Object.values(contentTotals ?? {})) {
        if (entry.seconds <= 0) continue;
        if (!topContent || entry.seconds > topContent.seconds) {
            topContent = { name: entry.name, seconds: entry.seconds };
        }
        if (entry.type === 'series' && (!topSeries || entry.seconds > topSeries.seconds)) {
            topSeries = { name: entry.name, seconds: entry.seconds };
        }
    }
    return { biggestDay, topSeries, topContent };
}

/** Uso agregado por perfil, lendo as chaves usage_stats_<id> (leitura injetada — PURO). */
export interface ProfileUsage {
    id: string;
    name: string;
    seconds: number;
}

export function perProfileUsage(
    profiles: { id: string; name: string }[],
    readRaw: (key: string) => string | null
): ProfileUsage[] {
    return profiles
        .map(profile => {
            let seconds = 0;
            try {
                const parsed: unknown = JSON.parse(readRaw(`usage_stats_${profile.id}`) || 'null');
                const total = (parsed as { totalWatchTimeSeconds?: unknown } | null)?.totalWatchTimeSeconds;
                if (typeof total === 'number' && Number.isFinite(total)) seconds = Math.max(0, total);
            } catch { /* registro corrompido conta como 0 */ }
            return { id: profile.id, name: profile.name, seconds };
        })
        .sort((a, b) => b.seconds - a.seconds);
}

export interface YearHeatCell {
    date: string;
    seconds: number;
    /** 0 (nada) a 4 (2h+); -1 = dia futuro (célula invisível). */
    level: number;
}

/** Nível visual do heatmap pelo tempo assistido no dia. */
export function heatLevel(seconds: number): number {
    if (seconds <= 0) return 0;
    if (seconds < 30 * 60) return 1;
    if (seconds < 60 * 60) return 2;
    if (seconds < 2 * 60 * 60) return 3;
    return 4;
}

function localIso(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Heatmap anual estilo GitHub: colunas = semanas (dom→sáb), a última
 * terminando na semana de hoje. Dias sem registro entram com 0 — a grade
 * tem sempre o mesmo formato; dias futuros saem com level -1.
 */
export function yearHeatmap(dailyStats: DailyStats[], todayIso: string, weeks = 53): YearHeatCell[][] {
    const byDate = new Map(dailyStats.map(d => [d.date, d.totalSeconds]));
    const today = new Date(todayIso + 'T12:00:00');
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay())); // completa a semana corrente
    const columns: YearHeatCell[][] = [];
    for (let week = weeks - 1; week >= 0; week--) {
        const column: YearHeatCell[] = [];
        for (let day = 0; day < 7; day++) {
            const date = new Date(end);
            date.setDate(end.getDate() - week * 7 - (6 - day));
            const iso = localIso(date);
            if (iso > todayIso) {
                column.push({ date: iso, seconds: 0, level: -1 });
                continue;
            }
            const seconds = byDate.get(iso) ?? 0;
            column.push({ date: iso, seconds, level: heatLevel(seconds) });
        }
        columns.push(column);
    }
    return columns;
}

/** Segundos do mês agrupados pela playlist ativa na hora de assistir. */
export function aggregatePlaylistTime(sessions: WatchSession[]): { playlistId: string; seconds: number }[] {
    const totals = new Map<string, number>();
    for (const session of sessions) {
        const key = session.playlistId || 'default';
        totals.set(key, (totals.get(key) ?? 0) + session.watchedSeconds);
    }
    return [...totals.entries()]
        .map(([playlistId, seconds]) => ({ playlistId, seconds }))
        .sort((a, b) => b.seconds - a.seconds);
}

/** 👶 Segundos dos últimos 7 dias por perfil KIDS (lendo o storage de cada um). */
export function kidsWeeklyUsage(
    profiles: { id: string; name: string; isKids?: boolean }[],
    readRaw: (key: string) => string | null,
    todayIso: string
): { id: string; name: string; weekSeconds: number }[] {
    const cutoffDate = new Date(todayIso + 'T12:00:00');
    cutoffDate.setDate(cutoffDate.getDate() - 6);
    const month = String(cutoffDate.getMonth() + 1).padStart(2, '0');
    const day = String(cutoffDate.getDate()).padStart(2, '0');
    const cutoffIso = `${cutoffDate.getFullYear()}-${month}-${day}`;
    return profiles
        .filter(profile => profile.isKids)
        .map(profile => {
            let weekSeconds = 0;
            try {
                const parsed = JSON.parse(readRaw(`usage_stats_${profile.id}`) || 'null') as {
                    dailyStats?: { date?: string; totalSeconds?: number }[];
                } | null;
                for (const entry of parsed?.dailyStats ?? []) {
                    if (typeof entry?.date === 'string' && entry.date >= cutoffIso && typeof entry.totalSeconds === 'number') {
                        weekSeconds += Math.max(0, entry.totalSeconds);
                    }
                }
            } catch { /* storage corrompido conta como zero */ }
            return { id: profile.id, name: profile.name, weekSeconds };
        });
}
