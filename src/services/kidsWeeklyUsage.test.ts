import { describe, expect, it } from 'vitest';
import { kidsWeeklyUsage } from './statsDashboardHelpers';

const TODAY = '2026-07-18';

describe('kidsWeeklyUsage (relatório semanal dos perfis kids)', () => {
    it('só perfis kids entram, somando os últimos 7 dias do storage deles', () => {
        const storage: Record<string, string> = {
            usage_stats_kid1: JSON.stringify({
                dailyStats: [
                    { date: '2026-07-18', totalSeconds: 3600 },
                    { date: '2026-07-12', totalSeconds: 1800 }, // dentro (7º dia)
                    { date: '2026-07-11', totalSeconds: 9999 }, // fora da janela
                ],
            }),
            usage_stats_adult: JSON.stringify({ dailyStats: [{ date: TODAY, totalSeconds: 500 }] }),
        };
        const result = kidsWeeklyUsage(
            [
                { id: 'kid1', name: 'Kids', isKids: true },
                { id: 'adult', name: 'Pai' },
            ],
            key => storage[key] ?? null,
            TODAY,
        );
        expect(result).toEqual([{ id: 'kid1', name: 'Kids', weekSeconds: 5400 }]);
    });

    it('storage ausente ou corrompido conta como zero', () => {
        const result = kidsWeeklyUsage(
            [{ id: 'k', name: 'K', isKids: true }],
            () => 'lixo{{',
            TODAY,
        );
        expect(result).toEqual([{ id: 'k', name: 'K', weekSeconds: 0 }]);
    });
});
