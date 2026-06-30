import { describe, it, expect, beforeEach, vi } from 'vitest';

// epgService is pulled in at module load; stub so importing the test target is
// side-effect free. pruneOldResults never calls it.
vi.mock('./epgService', () => ({
    epgService: {
        getOpenEpgPortugalId: vi.fn(),
        getOpenEpgArgentinaId: vi.fn(),
        getOpenEpgUSAId: vi.fn(),
        getMiTVSlug: vi.fn(),
        fetchChannelEPG: vi.fn()
    }
}));

import epgTestService, { type EpgTestResult } from './epgTestService';

const KEY = 'epg_test_results';
const DAY = 24 * 60 * 60 * 1000;

function makeResult(timestamp: number): EpgTestResult {
    return {
        working: [{ channel: 'TV A', source: 'src', epgId: 'a', programCount: 5, country: 'BR' }],
        notWorking: [{ channel: 'TV B', source: 'src', epgId: 'b', reason: 'no data', country: 'BR' }],
        summary: { total: 2, working: 1, notWorking: 1 },
        timestamp,
        isPartial: false,
        scannedChannels: ['TV A', 'TV B'],
        lastScannedIndex: 2
    };
}

describe('epgTestService.pruneOldResults', () => {
    beforeEach(() => {
        localStorage.clear();
        // Reset singleton state to idle with no cached result.
        epgTestService.clearCache();
    });

    it('drops a result older than 7 days and resets in-memory state', () => {
        const now = 100 * DAY;
        localStorage.setItem(KEY, JSON.stringify(makeResult(now - 8 * DAY)));

        const removed = epgTestService.pruneOldResults(now);

        expect(removed).toBe(true);
        expect(localStorage.getItem(KEY)).toBeNull();
        // EpgSection reads `.results` / `.lastTestDate` — both cleared.
        expect(epgTestService.results).toBeNull();
        expect(epgTestService.lastTestDate).toBeNull();
    });

    it('keeps a recent result and leaves the read path intact', () => {
        const now = 100 * DAY;
        const fresh = makeResult(now - 1 * DAY);
        localStorage.setItem(KEY, JSON.stringify(fresh));

        const removed = epgTestService.pruneOldResults(now);

        expect(removed).toBe(false);
        // The EpgSection read path (epgTestService.results) still gets valid data.
        const persisted = JSON.parse(localStorage.getItem(KEY)!) as EpgTestResult;
        expect(persisted.working).toHaveLength(1);
        expect(persisted.notWorking).toHaveLength(1);
        expect(persisted.summary.total).toBe(2);
    });

    it('leaves a result without a timestamp alone (legacy)', () => {
        const now = 100 * DAY;
        const noTs = makeResult(now);
        delete (noTs as Partial<EpgTestResult>).timestamp;
        localStorage.setItem(KEY, JSON.stringify(noTs));

        const removed = epgTestService.pruneOldResults(now);

        expect(removed).toBe(false);
        expect(localStorage.getItem(KEY)).not.toBeNull();
    });

    it('is a no-op when there is no cached result', () => {
        expect(epgTestService.pruneOldResults(Date.now())).toBe(false);
    });
});
