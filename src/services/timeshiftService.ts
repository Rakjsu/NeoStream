// Thin renderer-side wrapper over the 'streams:get-timeshift-url' IPC.
// The main process picks the URL form (path .m3u8 vs streaming/timeshift.php)
// via a session-cached probe and converts the start to provider-local time.

export interface TimeshiftRequest {
    streamId: number;
    /** Program start in ISO-8601 (what the EPG data already carries). */
    startIso: string;
    /** Playback span in minutes (program duration + slack). */
    durationMin: number;
}

export interface TimeshiftUrlResult {
    url: string;
    /** The other URL form, in case the chosen one fails at playback time. */
    fallbackUrl?: string;
    form?: 'm3u8' | 'php';
}

export async function getTimeshiftUrl(request: TimeshiftRequest): Promise<TimeshiftUrlResult> {
    const result = await window.ipcRenderer.invoke('streams:get-timeshift-url', request);
    if (result?.success && result.url) {
        return { url: result.url, fallbackUrl: result.fallbackUrl, form: result.form };
    }
    throw new Error(result?.error || 'Não foi possível montar a URL de replay');
}
