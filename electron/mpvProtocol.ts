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
export const OBSERVED_PROPERTIES = ['time-pos', 'duration', 'pause', 'eof-reached', 'volume', 'fullscreen', 'track-list', 'aid', 'sid'] as const

/** Audio/subtitle track parsed from mpv's track-list (MP4s carry several). */
export interface MpvTrack {
    id: number
    type: 'audio' | 'sub'
    title: string | null
    lang: string | null
    isDefault: boolean
}

export interface MpvStatus {
    running: boolean
    timePos: number | null
    duration: number | null
    paused: boolean
    eofReached: boolean
    /** 0..100 (mpv allows >100 but we never set it above 100). */
    volume: number | null
    fullscreen: boolean
    /** Audio + subtitle tracks of the current file (empty until loaded). */
    tracks: MpvTrack[]
    /** Selected audio track id (null = none). */
    audioTrackId: number | null
    /** Selected subtitle track id (null = subtitles off). */
    subtitleTrackId: number | null
}

export function createInitialStatus(running = false): MpvStatus {
    return {
        running, timePos: null, duration: null, paused: false, eofReached: false,
        volume: null, fullscreen: false, tracks: [], audioTrackId: null, subtitleTrackId: null
    }
}

/** Parse mpv's raw track-list into the audio/sub tracks the UI offers. */
export function parseTrackList(data: unknown): MpvTrack[] {
    if (!Array.isArray(data)) return []
    const tracks: MpvTrack[] = []
    for (const raw of data) {
        if (!raw || typeof raw !== 'object') continue
        const t = raw as Record<string, unknown>
        if (t.type !== 'audio' && t.type !== 'sub') continue
        if (typeof t.id !== 'number') continue
        tracks.push({
            id: t.id,
            type: t.type,
            title: typeof t.title === 'string' ? t.title : null,
            lang: typeof t.lang === 'string' ? t.lang : null,
            isDefault: t.default === true,
        })
    }
    return tracks
}

/** mpv reports aid/sid as a number, or false when off — normalize to id|null. */
export function parseTrackSelection(data: unknown): number | null {
    return typeof data === 'number' ? data : null
}

/**
 * Height (px) of the in-app controls strip reserved at the bottom of the
 * window's client area. The mpv window covers everything above it, so the
 * React controls bar must use the same constant (MpvPlayerView.tsx).
 */
export const MPV_CONTROLS_HEIGHT = 96

export interface MpvGeometry {
    x: number
    y: number
    width: number
    height: number
}

/**
 * Where the mpv window should sit, given the app window's content bounds
 * (screen coordinates of the client area): the full client area minus the
 * bottom strip reserved for the in-app controls bar.
 */
export function computeMpvGeometry(
    contentBounds: { x: number; y: number; width: number; height: number },
    controlsHeight: number = MPV_CONTROLS_HEIGHT,
): MpvGeometry {
    return {
        x: Math.round(contentBounds.x),
        y: Math.round(contentBounds.y),
        width: Math.max(1, Math.round(contentBounds.width)),
        height: Math.max(1, Math.round(contentBounds.height - controlsHeight)),
    }
}

/**
 * Serialize geometry for mpv's --geometry option / `geometry` property
 * (X11 geometry spec: WxH+X+Y). Negative offsets serialize as `+-N`,
 * which the spec defines as a negative absolute position — needed for
 * monitors left of / above the primary display.
 */
export function formatMpvGeometry(geometry: MpvGeometry): string {
    return `${geometry.width}x${geometry.height}+${geometry.x}+${geometry.y}`
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
    /**
     * Pseudo-embedded mode: open mpv as a borderless always-on-top window at
     * exactly this screen geometry (the app window's client area minus the
     * controls strip). When omitted, mpv opens as a normal standalone window.
     */
    geometry?: MpvGeometry
}

/**
 * Command-line arguments for the spawned mpv.exe.
 *
 * Embedding approach (phase 2) — evaluated options:
 *   (a) --wid=<app HWND>: mpv becomes a child of the whole Electron window and
 *       paints over ALL the React UI; repositioning the child would need a
 *       native module (SetWindowPos) which we don't ship. Rejected.
 *   (c) --wid + transparent child BrowserWindow just for the controls:
 *       two windows to keep in sync plus --wid quirks. Rejected as too complex.
 *   (d) CHOSEN: mpv stays its own top-level window but borderless + ontop,
 *       positioned exactly over the app's client area minus a bottom controls
 *       strip (--geometry). The main process re-applies the `geometry`
 *       property whenever the app window moves/resizes, and mirrors
 *       minimize/hide via the `window-minimized` property — so it looks and
 *       behaves embedded without native code.
 */
export function buildMpvArgs(pipeName: string, options: MpvLaunchOptions): string[] {
    const args = [
        `--input-ipc-server=${pipeName}`,
        '--force-window=immediate',
        `--title=${MPV_WINDOW_TITLE}`,
        ...(options.geometry
            ? [
                '--no-border', // borderless: blends with the app window underneath
                '--ontop', // keep the video above the app even when our controls are clicked
                '--no-osc', // controls live in the React UI, not mpv's on-screen controller
                `--geometry=${formatMpvGeometry(options.geometry)}`,
            ]
            : ['--autofit=70%']),
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
            case 'volume':
                return { ...status, volume: typeof message.data === 'number' ? message.data : null }
            case 'fullscreen':
                return { ...status, fullscreen: message.data === true }
            case 'track-list':
                return { ...status, tracks: parseTrackList(message.data) }
            case 'aid':
                return { ...status, audioTrackId: parseTrackSelection(message.data) }
            case 'sid':
                return { ...status, subtitleTrackId: parseTrackSelection(message.data) }
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
