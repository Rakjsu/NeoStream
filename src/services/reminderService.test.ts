import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    reminderService,
    reminderId,
    computeDelay,
    isExpired,
    MAX_TIMEOUT_MS,
    EXPIRY_GRACE_MS
} from './reminderService'
import type { ProgramReminder } from './reminderService'

const STORAGE_KEY = 'program_reminders_default'

function makeReminder(overrides: Partial<Omit<ProgramReminder, 'id'>> = {}): Omit<ProgramReminder, 'id'> {
    return {
        channelName: 'BR: Globo HD',
        streamId: 42,
        categoryId: '7',
        title: 'Jornal Nacional',
        startIso: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        ...overrides
    }
}

beforeEach(() => {
    localStorage.clear()
    reminderService.scheduleAll() // clears timers left over from other tests
})

afterEach(() => {
    vi.useRealTimers()
})

describe('reminder pure helpers', () => {
    it('reminderId is deterministic and unique per channel+start', () => {
        const start = '2026-06-12T20:00:00.000Z'
        expect(reminderId('Globo', start)).toBe(reminderId('Globo', start))
        expect(reminderId('Globo', start)).not.toBe(reminderId('SBT', start))
        expect(reminderId('Globo', start)).not.toBe(reminderId('Globo', '2026-06-12T21:00:00.000Z'))
    })

    it('computeDelay clamps to [0, 2^31-1]', () => {
        const now = Date.parse('2026-06-12T12:00:00.000Z')
        expect(computeDelay('2026-06-12T12:30:00.000Z', now)).toBe(30 * 60 * 1000)
        // Already started → fire immediately
        expect(computeDelay('2026-06-12T11:00:00.000Z', now)).toBe(0)
        // Far future (> 24.8 days) → capped at the setTimeout limit
        expect(computeDelay('2026-08-12T12:00:00.000Z', now)).toBe(MAX_TIMEOUT_MS)
        // Garbage input → 0
        expect(computeDelay('not-a-date', now)).toBe(0)
    })

    it('isExpired uses a 5-minute grace window after start', () => {
        const now = Date.parse('2026-06-12T12:00:00.000Z')
        const justStarted = new Date(now - EXPIRY_GRACE_MS + 1000).toISOString()
        const longGone = new Date(now - EXPIRY_GRACE_MS - 1000).toISOString()
        const future = new Date(now + 1000).toISOString()
        expect(isExpired(future, now)).toBe(false)
        expect(isExpired(justStarted, now)).toBe(false)
        expect(isExpired(longGone, now)).toBe(true)
        expect(isExpired('not-a-date', now)).toBe(true)
    })
})

describe('reminderService add/remove/list round-trip', () => {
    it('adds, finds, and removes a reminder', () => {
        const input = makeReminder()
        const added = reminderService.addReminder(input)

        expect(added.id).toBe(reminderId(input.channelName, input.startIso))
        expect(reminderService.hasReminder(input.channelName, input.startIso)).toBe(true)
        expect(reminderService.list()).toHaveLength(1)

        // Persisted under the profile-scoped key
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
        expect(stored).toHaveLength(1)
        expect(stored[0].title).toBe('Jornal Nacional')

        reminderService.removeReminder(added.id)
        expect(reminderService.hasReminder(input.channelName, input.startIso)).toBe(false)
        expect(reminderService.list()).toHaveLength(0)
    })

    it('adding the same program twice does not duplicate', () => {
        const input = makeReminder()
        reminderService.addReminder(input)
        reminderService.addReminder(input)
        expect(reminderService.list()).toHaveLength(1)
    })

    it('notifies subscribers on add and remove', () => {
        const callback = vi.fn()
        const unsubscribe = reminderService.subscribe(callback)
        const added = reminderService.addReminder(makeReminder())
        expect(callback).toHaveBeenCalled()
        callback.mockClear()
        reminderService.removeReminder(added.id)
        expect(callback).toHaveBeenCalled()
        unsubscribe()
    })
})

describe('reminderService.scheduleAll', () => {
    it('prunes reminders whose program started more than 5 minutes ago', () => {
        const fresh = makeReminder()
        const stale = makeReminder({
            channelName: 'BR: SBT HD',
            startIso: new Date(Date.now() - 10 * 60 * 1000).toISOString()
        })
        // Write directly so add's own scheduleAll does not prune early
        localStorage.setItem(STORAGE_KEY, JSON.stringify([
            { ...fresh, id: reminderId(fresh.channelName, fresh.startIso) },
            { ...stale, id: reminderId(stale.channelName, stale.startIso) }
        ]))

        reminderService.scheduleAll()

        const remaining = reminderService.list()
        expect(remaining).toHaveLength(1)
        expect(remaining[0].channelName).toBe('BR: Globo HD')
    })

    it('fires the reminder at start time: panel entry added, reminder removed, no throw without IPC', () => {
        vi.useFakeTimers()
        const input = makeReminder({ startIso: new Date(Date.now() + 2 * 60 * 1000).toISOString() })
        reminderService.addReminder(input)
        expect(reminderService.list()).toHaveLength(1)

        // window.ipcRenderer is absent in jsdom — firing must not throw
        expect(() => vi.advanceTimersByTime(2 * 60 * 1000 + 50)).not.toThrow()

        // Fired reminder is removed
        expect(reminderService.list()).toHaveLength(0)

        // App-notification entry in the shape NotificationsPanel reads
        const notifications = JSON.parse(localStorage.getItem('app_notifications_default') || '[]')
        expect(notifications).toHaveLength(1)
        expect(notifications[0].type).toBe('program_reminder')
        expect(notifications[0].title).toBe('Jornal Nacional')
        expect(notifications[0].message).toContain('Jornal Nacional')
        expect(notifications[0].message).toContain('BR: Globo HD')
        expect(notifications[0].read).toBe(false)
    })

    it('does not fire after the reminder is removed', () => {
        vi.useFakeTimers()
        const input = makeReminder({ startIso: new Date(Date.now() + 60 * 1000).toISOString() })
        const added = reminderService.addReminder(input)
        reminderService.removeReminder(added.id)

        vi.advanceTimersByTime(2 * 60 * 1000)
        const notifications = JSON.parse(localStorage.getItem('app_notifications_default') || '[]')
        expect(notifications).toHaveLength(0)
    })
})
