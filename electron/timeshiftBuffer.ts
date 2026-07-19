/**
 * ⏪ Item 15 — timeshift da TV ao vivo: helpers PUROS do buffer circular.
 *
 * O ffmpeg copia o stream do canal (sem re-encode) pra um HLS local com
 * janela deslizante (delete_segments): pausar vira possível porque o "ao
 * vivo" passa a ser servido do disco. Testado em timeshiftBuffer.test.ts.
 */

import path from 'node:path'

/** Duração alvo de cada segmento (s). */
export const TIMESHIFT_SEGMENT_SECONDS = 4
/** Janela do buffer circular (~30 min = 450 segmentos de 4s). */
export const TIMESHIFT_WINDOW_SEGMENTS = 450

/** Argumentos do ffmpeg: cópia do stream pra HLS com janela deslizante. */
export function buildTimeshiftArgs(url: string, dir: string): string[] {
    return [
        '-hide_banner', '-loglevel', 'error',
        // Reconexão automática quando o provedor soluça (stream http).
        '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
        '-i', url,
        '-c', 'copy',
        '-f', 'hls',
        '-hls_time', String(TIMESHIFT_SEGMENT_SECONDS),
        '-hls_list_size', String(TIMESHIFT_WINDOW_SEGMENTS),
        '-hls_flags', 'delete_segments',
        '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
        path.join(dir, 'buffer.m3u8'),
    ]
}

/** Content-Type dos arquivos que o servidor local do buffer entrega. */
export function timeshiftContentType(fileName: string): string {
    if (fileName.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
    if (fileName.endsWith('.ts')) return 'video/mp2t'
    return 'application/octet-stream'
}

/**
 * Resolve um caminho de URL pra um arquivo DENTRO da pasta do buffer.
 * null = nome inválido/path traversal (o servidor responde 404).
 */
export function resolveTimeshiftFile(rootDir: string, urlPath: string): string | null {
    const name = urlPath.replace(/^\/+/, '').split('?')[0]
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null
    if (!/^[\w.-]+\.(m3u8|ts)$/i.test(name)) return null
    return path.join(rootDir, name)
}

/** Segundos bufferizados: soma dos #EXTINF da playlist. */
export function bufferedSecondsFromPlaylist(m3u8Text: string): number {
    let total = 0
    for (const match of m3u8Text.matchAll(/#EXTINF:([\d.]+)/g)) {
        const seconds = Number(match[1])
        if (Number.isFinite(seconds)) total += seconds
    }
    return Math.round(total)
}
