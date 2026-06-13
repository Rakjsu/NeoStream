// Program Reminder Service
// Lets the user pick a FUTURE program in the EPG guide and get a native
// Windows notification when it starts. Reminders are stored per profile in
// localStorage and scheduled with setTimeout while the app is running.

import { profileService } from './profileService';
import { appNotificationService } from './episodeNotificationService';
import { languageService } from './languageService';

export interface ProgramReminder {
    /** Deterministic id derived from channel + program start (see reminderId). */
    id: string;
    channelName: string;
    streamId: number;
    categoryId?: string;
    title: string;
    /** Program start in ISO-8601. */
    startIso: string;
}

const STORAGE_KEY_PREFIX = 'program_reminders';

/** setTimeout overflows above 2^31-1 ms (~24.8 days) — cap the delay there. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Reminders whose program started more than this long ago are pruned. */
export const EXPIRY_GRACE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure helpers (exported for vitest)
// ---------------------------------------------------------------------------

/** Deterministic id for a (channel, program start) pair — djb2 hash, hex. */
export function reminderId(channelKey: string, startIso: string): string {
    const input = `${channelKey}|${startIso}`;
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
    }
    return `rem_${hash.toString(16)}_${Date.parse(startIso) || 0}`;
}

/** Milliseconds until the program starts, clamped to [0, MAX_TIMEOUT_MS]. */
export function computeDelay(startIso: string, nowMs: number): number {
    const startMs = Date.parse(startIso);
    if (Number.isNaN(startMs)) return 0;
    return Math.min(Math.max(startMs - nowMs, 0), MAX_TIMEOUT_MS);
}

/** A reminder is expired once the program started over 5 minutes ago. */
export function isExpired(startIso: string, nowMs: number): boolean {
    const startMs = Date.parse(startIso);
    if (Number.isNaN(startMs)) return true;
    return startMs < nowMs - EXPIRY_GRACE_MS;
}

// ---------------------------------------------------------------------------
// Service singleton
// ---------------------------------------------------------------------------

type ReminderCallback = (reminders: ProgramReminder[]) => void;

class ReminderService {
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private listeners: ReminderCallback[] = [];

    private getStorageKey(): string {
        const activeProfile = profileService.getActiveProfile();
        return `${STORAGE_KEY_PREFIX}_${activeProfile?.id ?? 'default'}`;
    }

    /** All stored reminders for the active profile (expired ones included until pruned). */
    list(): ProgramReminder[] {
        try {
            const data = localStorage.getItem(this.getStorageKey());
            if (!data) return [];
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private save(reminders: ProgramReminder[]): void {
        localStorage.setItem(this.getStorageKey(), JSON.stringify(reminders));
        this.notifyListeners(reminders);
    }

    hasReminder(channelKey: string, startIso: string): boolean {
        const id = reminderId(channelKey, startIso);
        return this.list().some(r => r.id === id);
    }

    addReminder(input: Omit<ProgramReminder, 'id'>): ProgramReminder {
        const reminder: ProgramReminder = {
            ...input,
            id: reminderId(input.channelName, input.startIso)
        };
        const reminders = this.list().filter(r => r.id !== reminder.id);
        reminders.push(reminder);
        this.save(reminders);
        this.scheduleAll();
        return reminder;
    }

    removeReminder(id: string): void {
        this.save(this.list().filter(r => r.id !== id));
        this.scheduleAll();
    }

    /**
     * Clears all timers, prunes expired reminders, and re-arms one setTimeout
     * per remaining reminder. Called on app boot and after every add/remove.
     */
    scheduleAll(): void {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();

        const now = Date.now();
        const all = this.list();
        const valid = all.filter(r => !isExpired(r.startIso, now));
        if (valid.length !== all.length) {
            this.save(valid);
        }

        for (const reminder of valid) {
            const delay = computeDelay(reminder.startIso, now);
            this.timers.set(reminder.id, setTimeout(() => {
                this.timers.delete(reminder.id);
                this.fire(reminder);
            }, delay));
        }
    }

    /** Reminder fired: native notification + panel entry, then remove it. */
    private fire(reminder: ProgramReminder): void {
        const t = (section: string, key: string) => languageService.t(section, key);
        const message = t('notifications', 'programReminderStarting')
            .replace('{title}', reminder.title)
            .replace('{channel}', reminder.channelName);

        // (a) Native Windows notification via the main process. Gracefully
        // no-ops when the IPC bridge is unavailable (tests / plain browser).
        try {
            const ipc = typeof window !== 'undefined' ? window.ipcRenderer : undefined;
            if (ipc) {
                void ipc.invoke('notify:show', {
                    title: `🔔 ${reminder.title}`,
                    body: message
                }).catch((err: unknown) => console.warn('[Reminders] notify:show failed:', err));
            } else {
                console.warn('[Reminders] IPC unavailable, skipping native notification:', message);
            }
        } catch (err) {
            console.warn('[Reminders] notify:show failed:', err);
        }

        // (b) Entry in the in-app notifications panel.
        appNotificationService.addNotification({
            type: 'program_reminder',
            title: reminder.title,
            message
        });

        // (c) Remove the fired reminder (save() already notifies subscribers).
        this.save(this.list().filter(r => r.id !== reminder.id));
    }

    subscribe(callback: ReminderCallback): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private notifyListeners(reminders: ProgramReminder[]): void {
        this.listeners.forEach(callback => callback(reminders));
    }
}

export const reminderService = new ReminderService();

// Dev-only helper: lets a reminder be set from the DevTools console, e.g.
//   reminderService.addReminder({ channelName: 'Teste', streamId: 1,
//       title: 'Programa Teste', startIso: new Date(Date.now() + 120000).toISOString() })
if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).reminderService = reminderService;
}
