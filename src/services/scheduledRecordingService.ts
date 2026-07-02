// Scheduled DVR recordings
// Pick a FUTURE program in the EPG guide and have the live stream recorded
// automatically (dvr:start at program start, dvr:stop at its end), while the
// app is running. Mirrors reminderService: per-profile localStorage +
// setTimeout timers rehydrated on boot.

import { profileService } from './profileService';
import { appNotificationService } from './episodeNotificationService';
import { computeDelay } from './reminderService';

export interface ScheduledRecording {
    /** Deterministic id derived from channel + program start (see scheduleId). */
    id: string;
    channelName: string;
    streamId: number;
    title: string;
    /** Program start/end in ISO-8601. */
    startIso: string;
    endIso: string;
}

const STORAGE_KEY_PREFIX = 'scheduled_recordings';

/** Extra time recorded after the announced program end (credits, delays). */
export const END_PADDING_MS = 2 * 60 * 1000;

/** Deterministic id for a (channel, program start) pair — djb2 hash, hex. */
export function scheduleId(channelKey: string, startIso: string): string {
    const input = `${channelKey}|${startIso}`;
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
    }
    return `sched_${hash.toString(16)}_${Date.parse(startIso) || 0}`;
}

/** A schedule is dead once the program END has passed (no point starting). */
export function isScheduleExpired(endIso: string, nowMs: number): boolean {
    const endMs = Date.parse(endIso);
    if (Number.isNaN(endMs)) return true;
    return endMs < nowMs;
}

type ScheduleCallback = (schedules: ScheduledRecording[]) => void;

class ScheduledRecordingService {
    private startTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private stopTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Live DVR recording ids for schedules currently recording. */
    private activeRecIds = new Map<string, string>();
    private listeners: ScheduleCallback[] = [];

    private getStorageKey(): string {
        const activeProfile = profileService.getActiveProfile();
        return `${STORAGE_KEY_PREFIX}_${activeProfile?.id ?? 'default'}`;
    }

    list(): ScheduledRecording[] {
        try {
            const data = localStorage.getItem(this.getStorageKey());
            if (!data) return [];
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private save(schedules: ScheduledRecording[]): void {
        try {
            localStorage.setItem(this.getStorageKey(), JSON.stringify(schedules));
        } catch { /* best-effort */ }
        this.listeners.forEach(cb => cb(schedules));
    }

    subscribe(cb: ScheduleCallback): () => void {
        this.listeners.push(cb);
        return () => { this.listeners = this.listeners.filter(l => l !== cb); };
    }

    add(input: Omit<ScheduledRecording, 'id'>): ScheduledRecording {
        const rec: ScheduledRecording = { ...input, id: scheduleId(input.channelName, input.startIso) };
        const all = this.list().filter(s => s.id !== rec.id);
        all.push(rec);
        this.save(all);
        this.arm(rec);
        return rec;
    }

    remove(id: string): void {
        this.save(this.list().filter(s => s.id !== id));
        const startTimer = this.startTimers.get(id);
        if (startTimer) { clearTimeout(startTimer); this.startTimers.delete(id); }
        const stopTimer = this.stopTimers.get(id);
        if (stopTimer) { clearTimeout(stopTimer); this.stopTimers.delete(id); }
        // Recording already in flight → stop it now.
        const recId = this.activeRecIds.get(id);
        if (recId) {
            this.activeRecIds.delete(id);
            void window.ipcRenderer.invoke('dvr:stop', { id: recId });
        }
    }

    /** Rehydrate timers on boot; prune schedules whose program already ended. */
    init(): void {
        const all = this.list();
        const now = Date.now();
        const alive = all.filter(s => !isScheduleExpired(s.endIso, now));
        if (alive.length !== all.length) this.save(alive);
        alive.forEach(s => this.arm(s));
    }

    private arm(rec: ScheduledRecording): void {
        const existing = this.startTimers.get(rec.id);
        if (existing) clearTimeout(existing);
        const delay = computeDelay(rec.startIso, Date.now());
        this.startTimers.set(rec.id, setTimeout(() => {
            this.startTimers.delete(rec.id);
            void this.fire(rec);
        }, delay));
    }

    private async fire(rec: ScheduledRecording): Promise<void> {
        // Program already over (slept laptop, long downtime) → drop silently.
        if (isScheduleExpired(rec.endIso, Date.now())) {
            this.save(this.list().filter(s => s.id !== rec.id));
            return;
        }
        try {
            const urlResult = await window.ipcRenderer.invoke('streams:get-live-url', { streamId: rec.streamId });
            if (!urlResult?.success || !urlResult.url) throw new Error(urlResult?.error || 'sem URL');

            const started = await window.ipcRenderer.invoke('dvr:start', {
                url: urlResult.url,
                channelName: `${rec.title} (${rec.channelName})`
            });
            if (!started?.success) throw new Error(started?.error || 'dvr:start falhou');

            this.activeRecIds.set(rec.id, started.id);
            appNotificationService.addNotification({
                type: 'dvr_recording',
                title: '⏺ Gravação iniciada',
                message: `${rec.title} — ${rec.channelName}`
            });

            // Stop when the program ends (+ padding for credits/delays).
            const stopDelay = computeDelay(rec.endIso, Date.now()) + END_PADDING_MS;
            this.stopTimers.set(rec.id, setTimeout(async () => {
                this.stopTimers.delete(rec.id);
                const recId = this.activeRecIds.get(rec.id);
                this.activeRecIds.delete(rec.id);
                if (recId) await window.ipcRenderer.invoke('dvr:stop', { id: recId });
                this.save(this.list().filter(s => s.id !== rec.id));
                appNotificationService.addNotification({
                    type: 'dvr_recording',
                    title: '⏺ Gravação concluída',
                    message: `${rec.title} — ${rec.channelName}`
                });
            }, stopDelay));
        } catch (err) {
            console.error('[DVR] scheduled recording failed:', err);
            this.save(this.list().filter(s => s.id !== rec.id));
            appNotificationService.addNotification({
                type: 'dvr_recording',
                title: '⚠️ Falha na gravação agendada',
                message: `${rec.title} — ${rec.channelName}`
            });
        }
    }
}

export const scheduledRecordingService = new ScheduledRecordingService();
