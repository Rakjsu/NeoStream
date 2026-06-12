// Pure time/layout helpers for the EPG guide grid (Guia de TV).
// Kept dependency-free so they can be unit-tested in isolation.

export const HALF_HOUR_MS = 30 * 60 * 1000;
/** Horizontal pixels per 30-minute slot. */
export const PX_PER_HALF_HOUR = 200;
/** Total 30-min slots in the window: -30min .. +4h from "now floor 30min". */
export const WINDOW_HALF_HOURS = 9;

export interface GuideWindow {
    /** Window start (ms since epoch) */
    start: number;
    /** Window end (ms since epoch, exclusive) */
    end: number;
}

export interface ProgramBlock {
    /** Offset from the timeline origin, px */
    left: number;
    /** Block width, px */
    width: number;
    /** True when the program started before the window (clipped at left edge) */
    clippedStart: boolean;
    /** True when the program ends after the window (clipped at right edge) */
    clippedEnd: boolean;
}

/**
 * Window bounds: floor "now" to the previous 30-min boundary, back up one
 * extra slot (so the current program has context) and span 4.5 hours total.
 */
export function getGuideWindow(now: number = Date.now()): GuideWindow {
    const floored = Math.floor(now / HALF_HOUR_MS) * HALF_HOUR_MS;
    const start = floored - HALF_HOUR_MS;
    return { start, end: start + WINDOW_HALF_HOURS * HALF_HOUR_MS };
}

/** Timestamps (ms) for every 30-min tick in the window, including the start. */
export function buildTimeTicks(window: GuideWindow): number[] {
    const ticks: number[] = [];
    for (let t = window.start; t < window.end; t += HALF_HOUR_MS) {
        ticks.push(t);
    }
    return ticks;
}

/**
 * Maps a program (ISO start/end) to a positioned block inside the window.
 * Returns null when the program is invalid or fully outside the window.
 */
export function programToBlock(
    startIso: string,
    endIso: string,
    window: GuideWindow,
    pxPerHalfHour: number = PX_PER_HALF_HOUR
): ProgramBlock | null {
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;

    const clampedStart = Math.max(start, window.start);
    const clampedEnd = Math.min(end, window.end);
    if (clampedEnd <= clampedStart) return null;

    const pxPerMs = pxPerHalfHour / HALF_HOUR_MS;
    return {
        left: (clampedStart - window.start) * pxPerMs,
        width: (clampedEnd - clampedStart) * pxPerMs,
        clippedStart: start < window.start,
        clippedEnd: end > window.end
    };
}

/** Pixel offset of "now" inside the window, or null when outside it. */
export function nowOffsetPx(
    now: number,
    window: GuideWindow,
    pxPerHalfHour: number = PX_PER_HALF_HOUR
): number | null {
    if (now < window.start || now >= window.end) return null;
    return ((now - window.start) / HALF_HOUR_MS) * pxPerHalfHour;
}

/** True when "now" falls within [start, end) of the program. */
export function isAiringNow(startIso: string, endIso: string, now: number = Date.now()): boolean {
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return now >= start && now < end;
}

/** HH:MM label for a tick / program time (local time, 24h). */
export function formatGuideTime(ms: number): string {
    return new Date(ms).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}
