/**
 * Unified agenda: program reminders + scheduled DVR recordings merged into a
 * single chronological list, grouped by day. Pure helpers, unit-tested.
 */

import type { ProgramReminder } from '../services/reminderService';
import type { ScheduledRecording } from '../services/scheduledRecordingService';

export interface AgendaEntry {
    kind: 'reminder' | 'recording';
    id: string;
    title: string;
    channelName: string;
    startIso: string;
    /** Recordings only. */
    endIso?: string;
    startMs: number;
}

/** Merge + sort; drops entries already finished (reminders: already started). */
export function buildAgenda(
    reminders: ProgramReminder[],
    recordings: ScheduledRecording[],
    nowMs: number
): AgendaEntry[] {
    const entries: AgendaEntry[] = [];

    for (const reminder of reminders) {
        const startMs = Date.parse(reminder.startIso);
        if (!Number.isFinite(startMs) || startMs <= nowMs) continue;
        entries.push({
            kind: 'reminder',
            id: reminder.id,
            title: reminder.title,
            channelName: reminder.channelName,
            startIso: reminder.startIso,
            startMs
        });
    }

    for (const recording of recordings) {
        const startMs = Date.parse(recording.startIso);
        const endMs = Date.parse(recording.endIso);
        // Keep recordings still to come OR currently in flight.
        if (!Number.isFinite(startMs) || (Number.isFinite(endMs) && endMs <= nowMs)) continue;
        entries.push({
            kind: 'recording',
            id: recording.id,
            title: recording.title,
            channelName: recording.channelName,
            startIso: recording.startIso,
            endIso: recording.endIso,
            startMs
        });
    }

    return entries.sort((a, b) => a.startMs - b.startMs);
}

export type AgendaDayKey = 'today' | 'tomorrow' | string; // ISO date for later days

/** Group entries by calendar day relative to `nowMs` (local time). */
export function groupAgendaByDay(entries: AgendaEntry[], nowMs: number): Array<{ day: AgendaDayKey; entries: AgendaEntry[] }> {
    const dayOf = (ms: number) => {
        const d = new Date(ms);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const todayKey = dayOf(nowMs);
    const tomorrowKey = dayOf(nowMs + 24 * 3600_000);

    const groups = new Map<string, AgendaEntry[]>();
    const order: string[] = [];
    for (const entry of entries) {
        const rawDay = dayOf(entry.startMs);
        const day: AgendaDayKey = rawDay === todayKey ? 'today' : rawDay === tomorrowKey ? 'tomorrow' : rawDay;
        if (!groups.has(day)) {
            groups.set(day, []);
            order.push(day);
        }
        groups.get(day)!.push(entry);
    }
    return order.map(day => ({ day, entries: groups.get(day)! }));
}

/** True while a recording entry is currently on air (start passed, end not). */
export function isRecordingInFlight(entry: AgendaEntry, nowMs: number): boolean {
    if (entry.kind !== 'recording' || !entry.endIso) return false;
    const endMs = Date.parse(entry.endIso);
    return entry.startMs <= nowMs && Number.isFinite(endMs) && endMs > nowMs;
}
