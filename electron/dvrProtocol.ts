/**
 * Pure helpers for the live-TV recorder (DVR) — testable without Electron.
 */

/** Windows-safe filename from a channel name + timestamp. */
export function recordingFilename(channelName: string, when: Date): string {
    const illegal = /[<>:"/\\|?*]/g;
    const safe = (channelName || 'canal')
        .replace(illegal, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'canal';
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}h${pad(when.getMinutes())}`;
    return `${safe} - ${stamp}.ts`;
}

/**
 * ffmpeg args for recording a live stream: copy codecs (no transcode, cheap)
 * into an MPEG-TS file — TS is append-only, so a crash mid-recording still
 * leaves a playable file.
 */
export function buildRecordingArgs(streamUrl: string, outFile: string): string[] {
    return [
        '-hide_banner',
        '-loglevel', 'info',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '10',
        '-i', streamUrl,
        '-c', 'copy',
        '-f', 'mpegts',
        '-y',
        outFile,
    ];
}

/** Parse "time=HH:MM:SS.cc" from an ffmpeg stderr chunk into seconds (or null). */
export function parseFfmpegTime(chunk: string): number | null {
    const m = chunk.match(/time=(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Format seconds as mm:ss or h:mm:ss for the REC badge. */
export function formatRecDuration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
