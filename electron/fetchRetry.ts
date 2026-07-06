/**
 * Single-retry wrapper for the external EPG fetchers — PURE (no net import),
 * so the retry decision logic is unit-testable.
 *
 * Round R39 added timeouts (a hung site can't stall the app); this adds one
 * bounded retry for TRANSIENT failures (network error / timeout / 5xx / 429),
 * so a DNS blip or momentary 502 doesn't cost a whole EPG refresh cycle.
 * Permanent failures (404, 403...) are returned as-is — retrying wouldn't help.
 */

/** Worth retrying: server-side hiccups and rate limits, not client errors. */
export function isTransientHttpStatus(status: number): boolean {
    return status >= 500 || status === 429
}

interface ResponseLike {
    ok: boolean
    status: number
}

export interface FetchRetryOptions {
    /** Extra attempts after the first (default 1 — two tries total). */
    retries?: number
    /** Pause before a retry (default 800ms). */
    backoffMs?: number
}

/**
 * Run `doFetch` and retry once (by default) when it throws (network error,
 * abort/timeout) or returns a transient HTTP status. The factory is invoked
 * fresh per attempt so per-try AbortSignal timeouts work naturally.
 */
export async function fetchWithRetry<T extends ResponseLike>(
    doFetch: () => Promise<T>,
    options: FetchRetryOptions = {},
): Promise<T> {
    const retries = options.retries ?? 1
    const backoffMs = options.backoffMs ?? 800

    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, backoffMs))
        try {
            const response = await doFetch()
            if (attempt < retries && isTransientHttpStatus(response.status)) {
                lastError = new Error(`HTTP ${response.status}`)
                continue
            }
            return response
        } catch (error) {
            lastError = error
            if (attempt >= retries) throw error
        }
    }
    throw lastError
}
