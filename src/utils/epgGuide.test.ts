import { describe, it, expect } from 'vitest';
import {
    HALF_HOUR_MS,
    PX_PER_HALF_HOUR,
    WINDOW_HALF_HOURS,
    WINDOW_SHIFT_MS,
    WINDOW_MIN_OFFSET_MS,
    WINDOW_MAX_OFFSET_MS,
    getGuideWindow,
    buildTimeTicks,
    programToBlock,
    nowOffsetPx,
    isAiringNow,
    clampWindow,
    shiftWindow,
    searchPrograms,
    isReplayable,
    replayDurationMinutes
} from './epgGuide';

// Fixed reference: 2026-06-11T15:47:00Z
const NOW = Date.UTC(2026, 5, 11, 15, 47, 0);
// floor(15:47) = 15:30, minus one slot => 15:00
const EXPECTED_START = Date.UTC(2026, 5, 11, 15, 0, 0);

describe('getGuideWindow', () => {
    it('floors now to 30min and backs up one slot', () => {
        const win = getGuideWindow(NOW);
        expect(win.start).toBe(EXPECTED_START);
        expect(win.end - win.start).toBe(WINDOW_HALF_HOURS * HALF_HOUR_MS);
    });

    it('handles an exact 30-min boundary', () => {
        const boundary = Date.UTC(2026, 5, 11, 16, 0, 0);
        const win = getGuideWindow(boundary);
        expect(win.start).toBe(boundary - HALF_HOUR_MS);
    });
});

describe('buildTimeTicks', () => {
    it('emits one tick per half-hour slot, starting at the window start', () => {
        const win = getGuideWindow(NOW);
        const ticks = buildTimeTicks(win);
        expect(ticks).toHaveLength(WINDOW_HALF_HOURS);
        expect(ticks[0]).toBe(win.start);
        expect(ticks[ticks.length - 1]).toBe(win.end - HALF_HOUR_MS);
    });
});

describe('programToBlock', () => {
    const win = getGuideWindow(NOW);
    const iso = (offsetMin: number) => new Date(win.start + offsetMin * 60000).toISOString();

    it('positions a program fully inside the window', () => {
        const block = programToBlock(iso(30), iso(90), win);
        expect(block).not.toBeNull();
        expect(block!.left).toBe(PX_PER_HALF_HOUR);
        expect(block!.width).toBe(2 * PX_PER_HALF_HOUR);
        expect(block!.clippedStart).toBe(false);
        expect(block!.clippedEnd).toBe(false);
    });

    it('clips a program that started before the window', () => {
        const block = programToBlock(iso(-60), iso(30), win);
        expect(block).not.toBeNull();
        expect(block!.left).toBe(0);
        expect(block!.width).toBe(PX_PER_HALF_HOUR);
        expect(block!.clippedStart).toBe(true);
    });

    it('clips a program that ends after the window', () => {
        const totalMin = WINDOW_HALF_HOURS * 30;
        const block = programToBlock(iso(totalMin - 30), iso(totalMin + 60), win);
        expect(block).not.toBeNull();
        expect(block!.width).toBe(PX_PER_HALF_HOUR);
        expect(block!.clippedEnd).toBe(true);
    });

    it('returns null for programs fully outside the window', () => {
        expect(programToBlock(iso(-120), iso(-60), win)).toBeNull();
        const totalMin = WINDOW_HALF_HOURS * 30;
        expect(programToBlock(iso(totalMin + 10), iso(totalMin + 70), win)).toBeNull();
    });

    it('returns null for invalid or inverted times', () => {
        expect(programToBlock('not-a-date', iso(30), win)).toBeNull();
        expect(programToBlock(iso(60), iso(30), win)).toBeNull();
    });
});

describe('nowOffsetPx', () => {
    const win = getGuideWindow(NOW);

    it('maps now into pixels from the window start', () => {
        // NOW is 47min after window start => 47/30 slots
        expect(nowOffsetPx(NOW, win)).toBeCloseTo((47 / 30) * PX_PER_HALF_HOUR, 5);
    });

    it('returns null outside the window', () => {
        expect(nowOffsetPx(win.start - 1, win)).toBeNull();
        expect(nowOffsetPx(win.end, win)).toBeNull();
    });
});

describe('isAiringNow', () => {
    it('detects the current program', () => {
        const start = new Date(NOW - 10 * 60000).toISOString();
        const end = new Date(NOW + 10 * 60000).toISOString();
        expect(isAiringNow(start, end, NOW)).toBe(true);
    });

    it('rejects past/future programs and invalid dates', () => {
        const past = new Date(NOW - 60 * 60000).toISOString();
        const pastEnd = new Date(NOW - 30 * 60000).toISOString();
        expect(isAiringNow(past, pastEnd, NOW)).toBe(false);
        expect(isAiringNow('bad', pastEnd, NOW)).toBe(false);
    });
});

describe('shiftWindow / clampWindow', () => {
    const win = getGuideWindow(NOW);
    const span = win.end - win.start;

    it('shifts forward and backward by the paging step', () => {
        const fwd = shiftWindow(win, WINDOW_SHIFT_MS, NOW);
        expect(fwd.start).toBe(win.start + WINDOW_SHIFT_MS);
        expect(fwd.end - fwd.start).toBe(span);

        const back = shiftWindow(win, -WINDOW_SHIFT_MS, NOW);
        expect(back.start).toBe(win.start - WINDOW_SHIFT_MS);
    });

    it('clamps at the past bound (now - 12h) on a 30-min lattice', () => {
        let w = win;
        for (let i = 0; i < 20; i++) w = shiftWindow(w, -WINDOW_SHIFT_MS, NOW);
        const minStart = Math.ceil((NOW + WINDOW_MIN_OFFSET_MS) / HALF_HOUR_MS) * HALF_HOUR_MS;
        expect(w.start).toBe(minStart);
        expect(w.end - w.start).toBe(span);
        expect(w.start % HALF_HOUR_MS).toBe(0);
    });

    it('clamps at the future bound (now + 36h)', () => {
        let w = win;
        for (let i = 0; i < 40; i++) w = shiftWindow(w, WINDOW_SHIFT_MS, NOW);
        const maxEnd = Math.floor((NOW + WINDOW_MAX_OFFSET_MS) / HALF_HOUR_MS) * HALF_HOUR_MS;
        expect(w.end).toBe(maxEnd);
        expect(w.end - w.start).toBe(span);
    });

    it('clampWindow keeps an in-range window untouched', () => {
        expect(clampWindow(win, NOW)).toEqual(win);
    });
});

describe('searchPrograms', () => {
    const iso = (min: number) => new Date(NOW + min * 60000).toISOString();
    const entries: Array<[string, { title: string; start: string; end: string }[]]> = [
        ['Globo', [
            { title: 'Jornal Nacional', start: iso(60), end: iso(90) },
            { title: 'Novela das Nove', start: iso(90), end: iso(150) }
        ]],
        ['SBT', [
            { title: 'Jornal do SBT', start: iso(30), end: iso(60) },
            { title: 'Cinema em Casa', start: iso(120), end: iso(240) }
        ]]
    ];

    it('matches titles case-insensitively across channels, sorted by start', () => {
        const results = searchPrograms(entries, 'jornal');
        expect(results).toHaveLength(2);
        expect(results[0].title).toBe('Jornal do SBT');
        expect(results[0].channelKey).toBe('SBT');
        expect(results[1].title).toBe('Jornal Nacional');
    });

    it('returns empty for blank queries and respects the limit', () => {
        expect(searchPrograms(entries, '   ')).toEqual([]);
        expect(searchPrograms(entries, 'a', 1)).toHaveLength(1);
    });

    it('skips programs with unparsable start times', () => {
        const bad: Array<[string, { title: string; start: string; end: string }[]]> = [
            ['X', [{ title: 'Foo', start: 'not-a-date', end: iso(30) }]]
        ];
        expect(searchPrograms(bad, 'foo')).toEqual([]);
    });
});

describe('isReplayable', () => {
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const isoAt = (ms: number) => new Date(ms).toISOString();
    const archive = { tv_archive: 1, tv_archive_duration: 3 };
    const noArchive = { tv_archive: 0, tv_archive_duration: 0 };
    const pastProgram = { start: isoAt(NOW - 3 * HOUR), end: isoAt(NOW - 2 * HOUR) };

    it('accepts a finished program on an archive channel within retention', () => {
        expect(isReplayable(pastProgram, archive, NOW)).toBe(true);
    });

    it('rejects channels without the archive flag', () => {
        expect(isReplayable(pastProgram, noArchive, NOW)).toBe(false);
    });

    it('rejects programs still airing or in the future', () => {
        const airing = { start: isoAt(NOW - HOUR), end: isoAt(NOW + HOUR) };
        const future = { start: isoAt(NOW + HOUR), end: isoAt(NOW + 2 * HOUR) };
        expect(isReplayable(airing, archive, NOW)).toBe(false);
        expect(isReplayable(future, archive, NOW)).toBe(false);
    });

    it('rejects programs older than the retention window', () => {
        const old = { start: isoAt(NOW - 4 * DAY), end: isoAt(NOW - 4 * DAY + HOUR) };
        expect(isReplayable(old, archive, NOW)).toBe(false);
        // ...but the same program passes with a longer retention
        expect(isReplayable(old, { tv_archive: 1, tv_archive_duration: 7 }, NOW)).toBe(true);
    });

    it('assumes 1-day retention when tv_archive_duration is 0/missing', () => {
        const yesterday = { start: isoAt(NOW - 20 * HOUR), end: isoAt(NOW - 19 * HOUR) };
        const older = { start: isoAt(NOW - 30 * HOUR), end: isoAt(NOW - 29 * HOUR) };
        const zeroRetention = { tv_archive: 1, tv_archive_duration: 0 };
        expect(isReplayable(yesterday, zeroRetention, NOW)).toBe(true);
        expect(isReplayable(older, zeroRetention, NOW)).toBe(false);
    });

    it('rejects malformed or inverted timestamps', () => {
        expect(isReplayable({ start: 'bogus', end: isoAt(NOW - HOUR) }, archive, NOW)).toBe(false);
        expect(isReplayable({ start: isoAt(NOW - HOUR), end: isoAt(NOW - 2 * HOUR) }, archive, NOW)).toBe(false);
    });
});

describe('replayDurationMinutes', () => {
    const isoAt = (ms: number) => new Date(ms).toISOString();

    it('returns the program duration plus the default 2-minute slack', () => {
        expect(replayDurationMinutes(isoAt(NOW), isoAt(NOW + 60 * 60 * 1000))).toBe(62);
    });

    it('rounds partial minutes up and honors a custom slack', () => {
        expect(replayDurationMinutes(isoAt(NOW), isoAt(NOW + 90 * 1000), 0)).toBe(2);
        expect(replayDurationMinutes(isoAt(NOW), isoAt(NOW + 30 * 60 * 1000), 5)).toBe(35);
    });

    it('falls back to the slack on malformed timestamps', () => {
        expect(replayDurationMinutes('bogus', isoAt(NOW))).toBe(2);
        expect(replayDurationMinutes(isoAt(NOW), isoAt(NOW))).toBe(2);
    });
});
