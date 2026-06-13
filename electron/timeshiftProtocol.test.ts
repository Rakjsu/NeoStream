/**
 * Unit tests for the pure Xtream timeshift (catch-up/replay) helpers.
 */
import { describe, it, expect } from 'vitest'
import {
    buildTimeshiftM3u8Url,
    buildTimeshiftPhpUrl,
    formatTimeshiftStart,
} from './timeshiftProtocol'

describe('formatTimeshiftStart', () => {
    // 2026-06-12T15:30:00Z
    const INSTANT = Date.UTC(2026, 5, 12, 15, 30, 0)

    it('formats UTC instants as YYYY-MM-DD:HH-MM at offset 0', () => {
        expect(formatTimeshiftStart(INSTANT, 0)).toBe('2026-06-12:15-30')
    })

    it('applies a negative provider offset (UTC-3)', () => {
        expect(formatTimeshiftStart(INSTANT, -180)).toBe('2026-06-12:12-30')
    })

    it('applies a positive provider offset (UTC+2)', () => {
        expect(formatTimeshiftStart(INSTANT, 120)).toBe('2026-06-12:17-30')
    })

    it('handles half-hour offsets (UTC+5:30)', () => {
        expect(formatTimeshiftStart(INSTANT, 330)).toBe('2026-06-12:21-00')
    })

    it('crosses the day boundary backwards', () => {
        // 2026-06-12T01:00:00Z at UTC-3 == 2026-06-11 22:00
        expect(formatTimeshiftStart(Date.UTC(2026, 5, 12, 1, 0, 0), -180)).toBe('2026-06-11:22-00')
    })

    it('crosses the day boundary forwards', () => {
        // 2026-06-12T23:30:00Z at UTC+2 == 2026-06-13 01:30
        expect(formatTimeshiftStart(Date.UTC(2026, 5, 12, 23, 30, 0), 120)).toBe('2026-06-13:01-30')
    })

    it('zero-pads months, days, hours and minutes', () => {
        expect(formatTimeshiftStart(Date.UTC(2026, 0, 5, 4, 7, 0), 0)).toBe('2026-01-05:04-07')
    })
})

describe('timeshift URL builders', () => {
    it('builds the path form (a) ending in .m3u8', () => {
        expect(buildTimeshiftM3u8Url('http://host:8080/', 'user', 'pass', 42, '2026-06-12:12-30', 62))
            .toBe('http://host:8080/timeshift/user/pass/62/2026-06-12:12-30/42.m3u8')
    })

    it('builds the streaming/timeshift.php form (b)', () => {
        expect(buildTimeshiftPhpUrl('http://host:8080', 'user', 'pass', 42, '2026-06-12:12-30', 62))
            .toBe('http://host:8080/streaming/timeshift.php?username=user&password=pass'
                + '&stream=42&start=2026-06-12%3A12-30&duration=62')
    })

    it('URL-encodes credentials', () => {
        expect(buildTimeshiftM3u8Url('http://host', 'user name', 'p&ss', 7, '2026-06-12:12-30', 30))
            .toBe('http://host/timeshift/user%20name/p%26ss/30/2026-06-12:12-30/7.m3u8')
        expect(buildTimeshiftPhpUrl('http://host', 'user name', 'p&ss', 7, '2026-06-12:12-30', 30))
            .toContain('username=user%20name&password=p%26ss')
    })
})
