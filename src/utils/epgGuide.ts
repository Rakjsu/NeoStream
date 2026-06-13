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

/** Paging step for the ◀/▶ guide buttons. */
export const WINDOW_SHIFT_MS = 2 * 60 * 60 * 1000;
/** Earliest reachable point relative to "now" (provider EPG holds ~now-24h). */
export const WINDOW_MIN_OFFSET_MS = -12 * 60 * 60 * 1000;
/** Latest reachable point relative to "now" (provider EPG holds ~now+48h). */
export const WINDOW_MAX_OFFSET_MS = 36 * 60 * 60 * 1000;

/**
 * Clamps a window into [now-12h, now+36h], preserving its span and keeping
 * the start on the absolute 30-min lattice (bounds are rounded inward).
 */
export function clampWindow(window: GuideWindow, now: number = Date.now()): GuideWindow {
    const span = window.end - window.start;
    const minStart = Math.ceil((now + WINDOW_MIN_OFFSET_MS) / HALF_HOUR_MS) * HALF_HOUR_MS;
    const maxEnd = Math.floor((now + WINDOW_MAX_OFFSET_MS) / HALF_HOUR_MS) * HALF_HOUR_MS;
    let start = window.start;
    if (start + span > maxEnd) start = maxEnd - span;
    if (start < minStart) start = minStart;
    return { start, end: start + span };
}

/** Shifts the window by deltaMs (e.g. ±WINDOW_SHIFT_MS), clamped to the data range. */
export function shiftWindow(window: GuideWindow, deltaMs: number, now: number = Date.now()): GuideWindow {
    return clampWindow({ start: window.start + deltaMs, end: window.end + deltaMs }, now);
}

/** Minimal program shape the search helper needs. */
export interface GuideProgramLike {
    title: string;
    start: string;
    end: string;
}

export interface ProgramSearchResult {
    /** Channel key (the EPG cache key, i.e. the channel name) */
    channelKey: string;
    title: string;
    /** ISO start (used to page the window to the program) */
    start: string;
    /** Parsed start in ms (for sorting/labels) */
    startMs: number;
}

/**
 * Case-insensitive title search across already-loaded EPG data.
 * Results are sorted by start time and capped at `limit`.
 */
export function searchPrograms(
    entries: Iterable<[string, GuideProgramLike[]]>,
    query: string,
    limit: number = 12
): ProgramSearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: ProgramSearchResult[] = [];
    for (const [channelKey, programs] of entries) {
        for (const program of programs) {
            if (!program.title || !program.title.toLowerCase().includes(q)) continue;
            const startMs = Date.parse(program.start);
            if (Number.isNaN(startMs)) continue;
            results.push({ channelKey, title: program.title, start: program.start, startMs });
        }
    }
    results.sort((a, b) => a.startMs - b.startMs);
    return results.slice(0, limit);
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal channel shape for replay checks (Xtream live stream fields). */
export interface ReplayChannelLike {
    /** 1 when the provider archives this channel (catch-up available). */
    tv_archive: number;
    /** Retention in days (0/undefined → assume 1 day). */
    tv_archive_duration: number;
}

/**
 * True when an already-finished program can be replayed via timeshift:
 * the channel has the archive flag, the program has ended, and its start
 * still falls inside the provider's retention window.
 */
export function isReplayable(
    program: { start: string; end: string },
    channel: ReplayChannelLike,
    nowMs: number = Date.now()
): boolean {
    if (channel.tv_archive !== 1) return false;
    const start = Date.parse(program.start);
    const end = Date.parse(program.end);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return false;
    if (end >= nowMs) return false;
    const retentionDays = channel.tv_archive_duration > 0 ? channel.tv_archive_duration : 1;
    return start >= nowMs - retentionDays * DAY_MS;
}

/**
 * Timeshift duration in whole minutes for a program: its real duration plus
 * a small slack so the tail isn't cut off. Falls back to the slack alone on
 * malformed timestamps.
 */
export function replayDurationMinutes(startIso: string, endIso: string, slackMin: number = 2): number {
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return Math.max(1, slackMin);
    return Math.ceil((end - start) / 60000) + slackMin;
}

/** HH:MM label for a tick / program time (local time, 24h). */
export function formatGuideTime(ms: number): string {
    return new Date(ms).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}
