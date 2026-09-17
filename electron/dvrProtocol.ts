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

/** ffmpeg args to remux a finished .ts recording into .mp4 (no re-encode). */
export function buildMp4RemuxArgs(inFile: string, outFile: string): string[] {
    return [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', inFile,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y',
        outFile,
    ];
}

/** ffmpeg args for a single-frame thumbnail (~30s in, 320px wide). */
export function buildThumbnailArgs(inFile: string, outFile: string, atSeconds = 30): string[] {
    return [
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', String(Math.max(0, atSeconds)),
        '-i', inFile,
        '-vframes', '1',
        '-vf', 'scale=320:-2',
        '-y',
        outFile,
    ];
}

/**
 * Nome final de arquivo de um rename de gravação (`''` = nome inválido).
 *
 * É a mesma faxina do `recordingFilename` — e é ela que faz o alvo cair em
 * cima do próprio arquivo: quem só abre o campo ✏️ e clica fora manda o nome
 * de volta igual, porque o campo confirma no `onBlur`.
 */
export function renameTargetName(rawName: string, currentFile: string): string {
    const safe = String(rawName || '')
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    if (!safe) return '';
    const ext = currentFile.toLowerCase().endsWith('.mp4') ? '.mp4' : '.ts';
    return safe.toLowerCase().endsWith(ext) ? safe : `${safe}${ext}`;
}

/**
 * Os dois caminhos são o MESMO arquivo?
 *
 * No Windows — e só nele — a caixa não conta: `jogo.ts` e `Jogo.ts` são o
 * mesmo arquivo, então trocar só a caixa não pode ser recusado com "já existe
 * uma gravação com esse nome". Em sistema sensível à caixa são dois arquivos
 * de verdade, e comparar sem caixa ali faria o rename passar POR CIMA do
 * vizinho.
 */
export function isSameRecordingFile(a: string, b: string, platform: string = process.platform): boolean {
    return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Destination .mp4 path next to a .ts recording. */
export function mp4PathFor(tsPath: string): string {
    return tsPath.replace(/\.ts$/i, '') + '.mp4';
}
