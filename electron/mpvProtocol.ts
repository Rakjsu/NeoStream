/**
 * EXPERIMENTAL — MPV playback engine PoC.
 *
 * Pure helpers for the mpv JSON IPC integration — no Electron, no sockets,
 * no child_process, no state. Everything here is unit-testable; the
 * side-effectful parts (spawn, named pipe client, ipcMain handlers) live
 * in mpvPlayer.ts.
 *
 * Protocol reference: https://mpv.io/manual/stable/#json-ipc
 */

export const MPV_WINDOW_TITLE = 'NeoStream MPV'

// Matches the User-Agent the app already uses for provider requests
// (see ipcHandlers.ts / downloadHandlers.ts).
export const MPV_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

/**
 * Properties we observe over the IPC pipe. The observe id is the array
 * index + 1 (mpv requires a non-zero id per observer).
 */
export const OBSERVED_PROPERTIES = ['time-pos', 'duration', 'pause', 'eof-reached'] as const

export interface MpvStatus {
    running: boolean
    timePos: number | null
    duration: number | null
    paused: boolean
    eofReached: boolean
}

export function createInitialStatus(running = false): MpvStatus {
    return { running, timePos: null, duration: null, paused: false, eofReached: false }
}

/**
 * Named pipe path for the mpv --input-ipc-server option (Windows).
 * `instance` disambiguates successive launches within the same app session.
 */
export function buildPipeName(pid: number, instance: number): string {
    return `\\\\.\\pipe\\neostream-mpv-${pid}-${instance}`
}

export interface MpvLaunchOptions {
    url: string
    title?: string
    startSeconds?: number
}

/**
 * Command-line arguments for the spawned mpv.exe.
 * PoC embedding: mpv opens as its own bordered window (no --wid embedding yet).
 */
export function buildMpvArgs(pipeName: string, options: MpvLaunchOptions): string[] {
    const args = [
        `--input-ipc-server=${pipeName}`,
        '--force-window=immediate',
        `--title=${MPV_WINDOW_TITLE}`,
        '--autofit=70%',
        '--no-terminal',
        `--user-agent=${MPV_USER_AGENT}`,
    ]

    if (options.title) {
        args.push(`--force-media-title=${options.title}`)
    }

    if (typeof options.startSeconds === 'number' && options.startSeconds > 0) {
        args.push(`--start=${Math.floor(options.startSeconds)}`)
    }

    // `--` stops option parsing so hostile/odd URLs can never be read as flags.
    args.push('--', options.url)
    return args
}

/**
 * Serialize one JSON IPC command line (newline-terminated, as mpv expects).
 */
export function serializeIpcCommand(command: ReadonlyArray<string | number | boolean>, requestId?: number): string {
    const payload: { command: ReadonlyArray<string | number | boolean>; request_id?: number } = { command }
    if (requestId !== undefined) {
        payload.request_id = requestId
    }
    return JSON.stringify(payload) + '\n'
}

/**
 * The observe_property commands sent right after the pipe connects.
 */
export function buildObserveCommandLines(): string[] {
    return OBSERVED_PROPERTIES.map((property, index) =>
        serializeIpcCommand(['observe_property', index + 1, property]))
}

export interface MpvIpcMessage {
    event?: string
    name?: string
    data?: unknown
    error?: string
    request_id?: number
}

/**
 * Parse one line received from the IPC pipe. Returns null for blank or
 * malformed lines (mpv occasionally logs noise when misconfigured).
 */
export function parseIpcLine(line: string): MpvIpcMessage | null {
    const trimmed = line.trim()
    if (!trimmed) return null
    try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object') {
            return parsed as MpvIpcMessage
        }
        return null
    } catch {
        return null
    }
}

/**
 * Fold one IPC message into the running status snapshot (pure reducer).
 */
export function applyIpcMessage(status: MpvStatus, message: MpvIpcMessage): MpvStatus {
    if (message.event === 'property-change') {
        switch (message.name) {
            case 'time-pos':
                return { ...status, timePos: typeof message.data === 'number' ? message.data : null }
            case 'duration':
                return { ...status, duration: typeof message.data === 'number' ? message.data : null }
            case 'pause':
                return { ...status, paused: message.data === true }
            case 'eof-reached':
                return { ...status, eofReached: message.data === true }
            default:
                return status
        }
    }

    if (message.event === 'end-file') {
        return { ...status, eofReached: true }
    }

    return status
}

/**
 * Split a pipe data chunk into complete lines, keeping the unterminated
 * remainder as the new buffer (pure line-framing helper).
 */
export function extractIpcLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
    const combined = buffer + chunk
    const parts = combined.split('\n')
    const rest = parts.pop() ?? ''
    return { lines: parts.filter((line) => line.trim().length > 0), rest }
}

export interface MpvPathEnv {
    ProgramFiles?: string
    'ProgramFiles(x86)'?: string
    LOCALAPPDATA?: string
    USERPROFILE?: string
    ChocolateyInstall?: string
}

/**
 * Well-known Windows install locations to probe when mpv isn't configured
 * and isn't on PATH (manual install, scoop shim, chocolatey shim).
 */
export function buildPathCandidates(env: MpvPathEnv): string[] {
    const candidates: string[] = []

    if (env.ProgramFiles) candidates.push(`${env.ProgramFiles}\\mpv\\mpv.exe`)
    if (env['ProgramFiles(x86)']) candidates.push(`${env['ProgramFiles(x86)']}\\mpv\\mpv.exe`)
    if (env.LOCALAPPDATA) candidates.push(`${env.LOCALAPPDATA}\\Programs\\mpv\\mpv.exe`)
    if (env.USERPROFILE) candidates.push(`${env.USERPROFILE}\\scoop\\shims\\mpv.exe`)
    if (env.ChocolateyInstall) candidates.push(`${env.ChocolateyInstall}\\bin\\mpv.exe`)
    candidates.push('C:\\ProgramData\\chocolatey\\bin\\mpv.exe')

    return candidates
}
