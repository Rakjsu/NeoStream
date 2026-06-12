import { describe, it, expect } from 'vitest';
import {
    HALF_HOUR_MS,
    PX_PER_HALF_HOUR,
    WINDOW_HALF_HOURS,
    getGuideWindow,
    buildTimeTicks,
    programToBlock,
    nowOffsetPx,
    isAiringNow
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
