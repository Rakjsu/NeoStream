// Resumo semanal de uso: no primeiro boot de cada semana, uma notificação
// nativa (+ entrada no painel) com as horas dos últimos 7 dias e o destaque.
// Mesmo padrão check-on-startup do Wrapped anual — sem timers persistentes.

import { usageStatsService } from './usageStatsService';
import { weekOverWeek, aggregateTopContent } from './statsDashboardHelpers';
import { languageService } from './languageService';

const SEEN_KEY = 'neostream_weekly_summary_week';

/** Chave da semana ISO (segunda como início), ex.: "2026-W29" (PURO). */
export function weekKey(now: Date): string {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Puro: dispara no máximo 1x por semana e só com algum tempo assistido. */
export function shouldNotifyWeekly(now: Date, lastWeekKey: string | null, watchedSeconds: number): boolean {
    if (watchedSeconds <= 0) return false;
    return lastWeekKey !== weekKey(now);
}

export const weeklySummaryService = {
    /** Check-and-fire: retorna o payload da notificação, ou null. */
    maybeNotify(now: Date = new Date()): { title: string; body: string } | null {
        let last: string | null;
        try {
            last = localStorage.getItem(SEEN_KEY);
        } catch {
            last = null;
        }

        const stats = usageStatsService.getStats();
        const today = now.toISOString().split('T')[0];
        const week = weekOverWeek(stats.dailyStats, today);
        if (!shouldNotifyWeekly(now, last, week.currentSeconds)) return null;

        try {
            localStorage.setItem(SEEN_KEY, weekKey(now));
        } catch { /* best-effort */ }

        const t = (key: string) => languageService.t('stats', key);
        const hours = Math.floor(week.currentSeconds / 3600);
        const minutes = Math.floor((week.currentSeconds % 3600) / 60);
        const time = hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
        const delta = week.deltaPct === null ? '' : ` (${week.deltaPct >= 0 ? '+' : ''}${week.deltaPct}%)`;
        const top = aggregateTopContent(stats.sessionsThisMonth, 1)[0];

        let body = t('weeklyBody').replace('{time}', time) + delta;
        if (top) body += ` · ${t('weeklyTop').replace('{name}', top.name)}`;
        return { title: t('weeklyTitle'), body };
    },
};
