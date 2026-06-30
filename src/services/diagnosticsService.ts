// Diagnostics Service (renderer)
//
// Two responsibilities:
//   1) An opt-in "detailed diagnostics" flag (localStorage, default FALSE).
//      When OFF, an exported report still includes the main.log tail + system
//      info; only the extra in-app breadcrumbs are withheld (privacy-conscious).
//   2) A tiny in-memory ring buffer of recent breadcrumbs/errors. This is
//      always recorded (it's just memory and never persisted), but is only
//      INCLUDED in an exported report when the opt-in is enabled.
//
// The buffer is intentionally cheap: a fixed-size array, no I/O, no React.

export interface DiagnosticEntry {
    /** ISO-8601 timestamp. */
    time: string;
    level: 'error' | 'warn' | 'info';
    message: string;
}

const STORAGE_KEY = 'neostream_diagnostics_enabled';
const BUFFER_CAP = 50;

// Ring buffer: when full, the oldest entry is dropped. Order preserved
// (oldest → newest).
const buffer: DiagnosticEntry[] = [];

/** Whether detailed diagnostics (breadcrumbs in exports) are opted in. */
export function isEnabled(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

/** Persist the opt-in flag. */
export function setEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
        // localStorage unavailable (e.g. tests) — nothing to persist.
    }
}

/**
 * Records a breadcrumb/error into the in-memory ring buffer. Always cheap and
 * always on — recording does not depend on the opt-in flag (only the EXPORT
 * does). Drops the oldest entry once the cap is reached.
 */
export function record(entry: DiagnosticEntry): void {
    buffer.push(entry);
    if (buffer.length > BUFFER_CAP) {
        buffer.splice(0, buffer.length - BUFFER_CAP);
    }
}

/** Returns a copy of the current breadcrumbs (oldest → newest). */
export function getBreadcrumbs(): DiagnosticEntry[] {
    return buffer.slice();
}

/** Test-only: clears the in-memory buffer. */
export function _resetBuffer(): void {
    buffer.length = 0;
}

/** Formats the breadcrumbs as a plain-text block for the exported report. */
export function formatBreadcrumbs(entries: DiagnosticEntry[] = getBreadcrumbs()): string {
    return entries
        .map((e) => `[${e.time}] [${e.level}] ${e.message}`)
        .join('\n');
}

export const diagnosticsService = {
    isEnabled,
    setEnabled,
    record,
    getBreadcrumbs,
    formatBreadcrumbs,
    _resetBuffer,
};

export default diagnosticsService;
