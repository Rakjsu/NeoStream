import { describe, expect, it } from 'vitest';
import { aggregateChannelTime } from './statsDashboardHelpers';
import type { WatchSession } from './usageStatsService';

const session = (name: string, type: WatchSession['contentType'], seconds: number): WatchSession => ({
    contentId: name, contentType: type, contentName: name, watchedSeconds: seconds, date: '2026-07-10',
});

describe('aggregateChannelTime (tempo por canal no mês)', () => {
    it('soma só sessões live, agrupa por canal e ordena desc', () => {
        const result = aggregateChannelTime([
            session('Globo', 'live', 100),
            session('SBT', 'live', 500),
            session('Globo', 'live', 250),
            session('Filme X', 'movie', 999),
        ]);
        expect(result).toEqual([
            { name: 'SBT', seconds: 500 },
            { name: 'Globo', seconds: 350 },
        ]);
    });

    it('respeita o limite', () => {
        const many = Array.from({ length: 12 }, (_, i) => session(`C${i}`, 'live', i + 1));
        expect(aggregateChannelTime(many, 3)).toHaveLength(3);
    });
});
