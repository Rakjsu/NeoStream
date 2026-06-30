/**
 * Unit tests for the diagnostics ring buffer and opt-in flag.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    record,
    getBreadcrumbs,
    formatBreadcrumbs,
    isEnabled,
    setEnabled,
    _resetBuffer,
} from './diagnosticsService';

beforeEach(() => {
    _resetBuffer();
    localStorage.clear();
});

describe('diagnostics ring buffer', () => {
    it('records entries and returns them oldest → newest', () => {
        record({ time: 't1', level: 'error', message: 'a' });
        record({ time: 't2', level: 'warn', message: 'b' });

        const crumbs = getBreadcrumbs();
        expect(crumbs).toHaveLength(2);
        expect(crumbs[0].message).toBe('a');
        expect(crumbs[1].message).toBe('b');
    });

    it('caps the buffer at 50 entries, dropping the oldest', () => {
        for (let i = 0; i < 60; i++) {
            record({ time: `t${i}`, level: 'info', message: `m${i}` });
        }

        const crumbs = getBreadcrumbs();
        expect(crumbs).toHaveLength(50);
        // Oldest 10 dropped → first remaining is m10, last is m59.
        expect(crumbs[0].message).toBe('m10');
        expect(crumbs[crumbs.length - 1].message).toBe('m59');
    });

    it('getBreadcrumbs returns a copy (mutation does not affect the buffer)', () => {
        record({ time: 't1', level: 'error', message: 'a' });
        const crumbs = getBreadcrumbs();
        crumbs.push({ time: 't2', level: 'error', message: 'injected' });
        expect(getBreadcrumbs()).toHaveLength(1);
    });

    it('formats breadcrumbs as plain text lines', () => {
        record({ time: '2026-06-30T00:00:00Z', level: 'error', message: 'boom' });
        expect(formatBreadcrumbs()).toBe('[2026-06-30T00:00:00Z] [error] boom');
    });
});

describe('diagnostics opt-in flag', () => {
    it('defaults to false', () => {
        expect(isEnabled()).toBe(false);
    });

    it('persists when enabled', () => {
        setEnabled(true);
        expect(isEnabled()).toBe(true);
        expect(localStorage.getItem('neostream_diagnostics_enabled')).toBe('true');
    });

    it('can be disabled again', () => {
        setEnabled(true);
        setEnabled(false);
        expect(isEnabled()).toBe(false);
    });
});
