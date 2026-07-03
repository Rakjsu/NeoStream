/**
 * Rescue-transcode protocol — pure helpers (unit-tested).
 *
 * When a stream fails in Chromium because of codecs (HEVC video, AC3/EAC3
 * audio are the IPTV classics), ffmpeg re-encodes it into a live HLS the
 * internal player can always play. Two variants, tried in order:
 *   - 'audio': video copied, audio → AAC (cheap; covers the AC3 cases)
 *   - 'full':  video → H.264 veryfast + audio → AAC (universal, CPU-heavy)
 */

export type TranscodeVariant = 'audio' | 'full'

/** ffmpeg argv for a live HLS rescue of `sourceUrl`, writing into cwd. */
export function buildTranscodeArgs(sourceUrl: string, variant: TranscodeVariant): string[] {
    const video = variant === 'audio'
        ? ['-c:v', 'copy']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p']
    return [
        '-hide_banner',
        '-loglevel', 'error',
        // Reconnect flags keep flaky IPTV sources alive.
        '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4',
        '-i', sourceUrl,
        ...video,
        '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '10',
        '-hls_flags', 'delete_segments+append_list',
        'index.m3u8'
    ]
}

/** Playable when the manifest lists at least `minSegments` media segments. */
export function isPlaylistReady(m3u8Text: string, minSegments: number = 2): boolean {
    const count = (m3u8Text.match(/#EXTINF:/g) || []).length
    return count >= minSegments
}

/** Strictly resolve a request path to a file inside the transcode root. */
export function safeJoinTranscodePath(root: string, requestPath: string): string | null {
    // Expected shape: /<sessionId>/<file> — no dots, no nesting tricks.
    const match = /^\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9._-]+)$/.exec(requestPath)
    if (!match) return null
    if (match[2].includes('..')) return null
    return `${root}/${match[1]}/${match[2]}`
}

export function contentTypeFor(filePath: string): string {
    if (filePath.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
    if (filePath.endsWith('.ts')) return 'video/mp2t'
    return 'application/octet-stream'
}
