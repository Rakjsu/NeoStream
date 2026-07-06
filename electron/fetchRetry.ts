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

/** Anything with an HTTP status — node-fetch Response and axios responses fit. */
interface ResponseLike {
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

/**
 * Axios-style transiency: axios THROWS on non-2xx, carrying response.status.
 * No response at all = network error / timeout → transient. A carried 4xx
 * (404, 403, 401...) is permanent — retrying wouldn't help.
 */
export function isTransientRequestError(error: unknown): boolean {
    const status = (error as { response?: { status?: unknown } } | null)?.response?.status
    if (typeof status === 'number') return isTransientHttpStatus(status)
    return true
}

/**
 * fetchWithRetry's sibling for axios-style callers (throw on failure): retry
 * once when the thrown error is transient; permanent errors rethrow untouched.
 */
export async function requestWithRetry<T>(
    doRequest: () => Promise<T>,
    options: FetchRetryOptions = {},
): Promise<T> {
    const retries = options.retries ?? 1
    const backoffMs = options.backoffMs ?? 800

    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, backoffMs))
        try {
            return await doRequest()
        } catch (error) {
            lastError = error
            if (attempt >= retries || !isTransientRequestError(error)) throw error
        }
    }
    throw lastError
}
