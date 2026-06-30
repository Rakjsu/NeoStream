/**
 * Pure helpers for the opt-in diagnostics / error-report feature — no Electron,
 * no fs, no network, no state. The side-effectful parts (reading main.log,
 * showSaveDialog, writeFile, shell.openPath) live in diagnosticsHandlers.ts.
 *
 * Two pure functions are unit-tested here:
 *   - redactSecrets(text): masks obvious credentials that may have leaked into
 *     logs (username=/password= query params, "password":"..." JSON).
 *   - buildReportText({...}): assembles the human-readable .txt report. The
 *     log tail and breadcrumbs are redacted before being embedded.
 */

export interface ReportSystemInfo {
    platform: string
    arch: string
    electron?: string
    chrome?: string
    node?: string
    osRelease?: string
    osVersion?: string
    /** e.g. "America/Sao_Paulo" or a UTC offset string — best effort. */
    locale?: string
}

export interface BuildReportInput {
    version: string
    /** ISO-8601 timestamp for the report header. */
    timestamp: string
    system: ReportSystemInfo
    /** Detailed breadcrumbs — only present when the opt-in is enabled. */
    breadcrumbs?: string
    /** Tail of main.log (already truncated to the size budget). */
    logTail?: string
}

/**
 * Masks obvious secrets that may appear in the assembled report text:
 *   - `username=<v>` / `password=<v>` query-string params → value replaced.
 *   - `"password":"<v>"` JSON fields → value replaced.
 *
 * Conservative on purpose: only touches well-known credential shapes so the
 * report stays useful for debugging.
 */
export function redactSecrets(text: string): string {
    if (!text) return text

    return text
        // username= / password= in URLs or query strings. Value runs until the
        // next & or whitespace (so we don't eat the rest of the line/URL).
        .replace(/\b(username|password)=([^&\s"']*)/gi, '$1=***REDACTED***')
        // "password":"..." (and 'password':'...') JSON-ish fields. Tolerates
        // spaces around the colon.
        .replace(/(["']password["']\s*:\s*)["']([^"']*)["']/gi, '$1"***REDACTED***"')
}

/**
 * Assembles the readable .txt diagnostics report. Breadcrumbs and the main.log
 * tail are redacted before being embedded so leaked credentials never reach the
 * shareable file.
 */
export function buildReportText(input: BuildReportInput): string {
    const { version, timestamp, system, breadcrumbs, logTail } = input

    const lines: string[] = []
    lines.push('NeoStream — Relatório de diagnóstico / Error report')
    lines.push('='.repeat(60))
    lines.push(`App version : ${version}`)
    lines.push(`Generated   : ${timestamp}`)
    lines.push(`Platform    : ${system.platform} ${system.arch}`)
    if (system.osVersion || system.osRelease) {
        lines.push(`OS          : ${[system.osVersion, system.osRelease].filter(Boolean).join(' / ')}`)
    }
    lines.push(`Electron    : ${system.electron ?? 'n/a'}`)
    lines.push(`Chrome      : ${system.chrome ?? 'n/a'}`)
    lines.push(`Node        : ${system.node ?? 'n/a'}`)
    if (system.locale) {
        lines.push(`Locale/TZ   : ${system.locale}`)
    }
    lines.push('')

    if (breadcrumbs && breadcrumbs.trim()) {
        lines.push('--- Breadcrumbs ---')
        lines.push(redactSecrets(breadcrumbs.trim()))
        lines.push('')
    }

    lines.push('--- main.log (tail) ---')
    if (logTail && logTail.trim()) {
        lines.push(redactSecrets(logTail.trimEnd()))
    } else {
        lines.push('(empty or unavailable)')
    }
    lines.push('')

    return lines.join('\n')
}
