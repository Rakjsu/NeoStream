/**
 * Provider health probe results — classification helpers (pure, unit-tested).
 * The actual probing happens in the main process (diagnostics:provider-health).
 */

export interface ProbeResult {
    name: string;
    ok: boolean;
    status: number | null;
    ms: number;
    error?: string;
}

export type LatencyBand = 'good' | 'ok' | 'slow';
export type OverallStatus = 'online' | 'degraded' | 'offline';

export function classifyLatency(ms: number): LatencyBand {
    if (ms < 500) return 'good';
    if (ms < 1500) return 'ok';
    return 'slow';
}

export const LATENCY_COLORS: Record<LatencyBand, string> = {
    good: '#10b981',
    ok: '#f59e0b',
    slow: '#ef4444'
};

/** online = everything answered; offline = nothing did; degraded = in between. */
export function overallStatus(results: ProbeResult[]): OverallStatus {
    if (results.length === 0) return 'offline';
    const okCount = results.filter(r => r.ok).length;
    if (okCount === results.length) return 'online';
    if (okCount === 0) return 'offline';
    return 'degraded';
}
