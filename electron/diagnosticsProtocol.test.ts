/**
 * Unit tests for the pure diagnostics report helpers (no Electron).
 */
import { describe, it, expect } from 'vitest'
import { buildReportText, redactSecrets } from './diagnosticsProtocol'

describe('redactSecrets', () => {
    it('masks password= query params', () => {
        const out = redactSecrets('http://host/api?username=joe&password=s3cr3t&x=1')
        expect(out).toContain('username=***REDACTED***')
        expect(out).toContain('password=***REDACTED***')
        expect(out).not.toContain('s3cr3t')
        expect(out).not.toContain('=joe')
        // Non-secret params are preserved.
        expect(out).toContain('x=1')
    })

    it('masks "password":"..." JSON fields', () => {
        const out = redactSecrets('{"user":"joe","password":"hunter2"}')
        expect(out).not.toContain('hunter2')
        expect(out).toContain('"password":"***REDACTED***"')
        // Other JSON fields untouched.
        expect(out).toContain('"user":"joe"')
    })

    it('handles single quotes and spaces around the JSON colon', () => {
        const out = redactSecrets("{'password' : 'abc123'}")
        expect(out).not.toContain('abc123')
        expect(out).toContain('***REDACTED***')
    })

    it('is case-insensitive on the key', () => {
        expect(redactSecrets('PASSWORD=topsecret')).not.toContain('topsecret')
        expect(redactSecrets('Username=admin')).toContain('Username=***REDACTED***')
    })

    it('does not over-eat past the value boundary', () => {
        const out = redactSecrets('password=abc&keep=this')
        expect(out).toContain('keep=this')
    })

    it('returns empty input unchanged', () => {
        expect(redactSecrets('')).toBe('')
    })
})

describe('buildReportText', () => {
    const base = {
        version: '3.14.0',
        timestamp: '2026-06-30T12:00:00.000Z',
        system: {
            platform: 'win32',
            arch: 'x64',
            electron: '42.0.0',
            chrome: '130.0.0',
            node: '20.0.0',
            osRelease: '10.0.26200',
            osVersion: 'Windows 11 Pro',
            locale: 'America/Sao_Paulo',
        },
    }

    it('includes a header with version, timestamp and system info', () => {
        const out = buildReportText(base)
        expect(out).toContain('App version : 3.14.0')
        expect(out).toContain('2026-06-30T12:00:00.000Z')
        expect(out).toContain('win32 x64')
        expect(out).toContain('Electron    : 42.0.0')
        expect(out).toContain('main.log (tail)')
    })

    it('omits the breadcrumbs section when breadcrumbs are absent', () => {
        const out = buildReportText(base)
        expect(out).not.toContain('--- Breadcrumbs ---')
    })

    it('includes the breadcrumbs section when provided', () => {
        const out = buildReportText({ ...base, breadcrumbs: '[t] [error] boom' })
        expect(out).toContain('--- Breadcrumbs ---')
        expect(out).toContain('boom')
    })

    it('redacts secrets in the embedded log tail and breadcrumbs', () => {
        const out = buildReportText({
            ...base,
            breadcrumbs: 'failed http://h/?password=brkdcrumb',
            logTail: 'GET http://h/api?username=joe&password=logsecret 200',
        })
        expect(out).not.toContain('logsecret')
        expect(out).not.toContain('brkdcrumb')
        expect(out).toContain('***REDACTED***')
    })

    it('shows a placeholder when the log tail is empty', () => {
        const out = buildReportText({ ...base, logTail: '' })
        expect(out).toContain('(empty or unavailable)')
    })
})
