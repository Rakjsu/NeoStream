import { describe, it, expect } from 'vitest';
import { scheduleId, isScheduleExpired, END_PADDING_MS } from './scheduledRecordingService';

describe('scheduleId', () => {
    it('is deterministic for the same channel + start', () => {
        const a = scheduleId('Globo HD', '2026-07-02T21:00:00Z');
        const b = scheduleId('Globo HD', '2026-07-02T21:00:00Z');
        expect(a).toBe(b);
        expect(a).toMatch(/^sched_/);
    });

    it('differs across channels and start times', () => {
        expect(scheduleId('Globo HD', '2026-07-02T21:00:00Z'))
            .not.toBe(scheduleId('SBT HD', '2026-07-02T21:00:00Z'));
        expect(scheduleId('Globo HD', '2026-07-02T21:00:00Z'))
            .not.toBe(scheduleId('Globo HD', '2026-07-02T22:00:00Z'));
    });
});

describe('isScheduleExpired', () => {
    const now = Date.parse('2026-07-02T21:00:00Z');

    it('is alive while the program has not ended', () => {
        expect(isScheduleExpired('2026-07-02T21:30:00Z', now)).toBe(false);
        expect(isScheduleExpired('2026-07-02T21:00:00Z', now)).toBe(false);
    });

    it('expires once the program end has passed', () => {
        expect(isScheduleExpired('2026-07-02T20:59:00Z', now)).toBe(true);
    });

    it('treats malformed dates as expired', () => {
        expect(isScheduleExpired('not-a-date', now)).toBe(true);
    });
});

describe('END_PADDING_MS', () => {
    it('records a couple of minutes past the announced end', () => {
        expect(END_PADDING_MS).toBe(2 * 60 * 1000);
    });
});
