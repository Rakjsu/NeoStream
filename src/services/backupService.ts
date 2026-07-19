// Backup/restore of user data.
//
// v1 covered only localStorage user data. v2 adds:
//   - theme, scheduled recordings, program reminders, MPV track prefs
//   - saved playlists from the main-process store (passwords base64-encoded —
//     obfuscation for shoulder-surfing, NOT encryption; the UI warns that the
//     file contains provider access data)
// v3 adds the user's API keys, so a restore/new machine doesn't lose them:
//   - TMDB key (localStorage, rides the normal data map)
//   - OpenSubtitles credentials (live in the main-process store; the caller
//     fetches/applies them over IPC — this module stays IPC-free)
// Still EXCLUDED: caches (tmdb_*, EPG test results, contentLastFetch) and
// transient flags (shouldAutoPlayNextEpisode, parentalUnlocked).

export const BACKUP_VERSION = 3;
export const BACKUP_APP = 'neostream';

export interface BackupPlaylist {
    name: string;
    url: string;
    username: string;
    /** base64(password) — see header note. */
    passwordB64: string;
}

export interface BackupOpenSubtitles {
    apiKey: string;
    username: string;
    /** base64(password) — same obfuscation note as the playlists. */
    passwordB64: string;
}

/** Decoded form the callers hand to `opensubtitles:set-config`. */
export interface OpenSubtitlesCreds {
    apiKey: string;
    username: string;
    password: string;
}

export interface BackupPayload {
    version: number;
    exportedAt: string;
    app: typeof BACKUP_APP;
    data: Record<string, string>;
    /** v2+: saved Xtream playlists (absent on v1 files). */
    playlists?: BackupPlaylist[];
    /** v3+: the user's OpenSubtitles credentials (absent when not configured). */
    openSubtitles?: BackupOpenSubtitles;
}

export interface ApplyReport {
    applied: number;
    skipped: string[];
    /** Playlists accepted for import in the main process. */
    playlistsImported: number;
}

// Keys included by exact name
const EXACT_KEYS = [
    'neostream_profiles',     // profiles + active profile + watch-later lists
    'neostream_language',     // UI language
    'neostream_theme',        // background + accent color (v2)
    'parentalConfig',         // parental control config (PIN hash included)
    'playerVolume',           // last player volume
    'neostream_mpv_volume',   // last MPV volume (stable player)
    'watchLater',             // legacy pre-profile watch-later list
    'neostream_sync_tombstones', // deletions ledger (sync propagates removals)
    'neostream_tmdb_api_key', // the user's own TMDB key (v3) — also synced
    'neostream_keymap_v1',    // atalhos de teclado personalizados do player
    'neostream_resume_on_open', // toggle "retomar ao abrir"
    'neostream_cinema_mode',  // 🎬 modo cinema do player (item 29)
    'neostream_reminder_autotune', // 📺 lembrete sintoniza sozinho (item 32)
];

// Keys included when they start with one of these prefixes
const PREFIX_KEYS = [
    'neostream_profile_',     // per-profile favorites, incl. _<profileId>__pl_<playlistId>
    'neostream_watchlater_',  // per-(profile,playlist) watch-later, _<profileId>__pl_<playlistId>
    'neostream_mpv_tracks_',  // per-profile MPV audio/subtitle language prefs (v2)
    'playbackConfig',         // playbackConfig and playbackConfig_<profileId>
    'movie_watch_progress',   // movie resume positions, incl. per-(profile,playlist)
    'series_watch_progress',  // series progress, incl. per-(profile,playlist)
    'usage_stats',            // usage_stats_<profileId> / usage_stats_default
    'scheduled_recordings',   // per-profile scheduled DVR recordings (v2)
    'program_reminders',      // per-profile EPG program reminders (v2)
];

export function isBackupKey(key: string): boolean {
    return EXACT_KEYS.includes(key) || PREFIX_KEYS.some(prefix => key.startsWith(prefix));
}

export function encodePlaylistPassword(password: string): string {
    // btoa handles latin1 only; round-trip via encodeURIComponent for unicode.
    return btoa(unescape(encodeURIComponent(password)));
}

export function decodePlaylistPassword(passwordB64: string): string {
    return decodeURIComponent(escape(atob(passwordB64)));
}

/** Validates and normalizes the optional v2 playlists array from a parsed file. */
export function sanitizeBackupPlaylists(raw: unknown): BackupPlaylist[] {
    if (!Array.isArray(raw)) return [];
    const result: BackupPlaylist[] = [];
    for (const item of raw) {
        if (item === null || typeof item !== 'object') continue;
        const p = item as Record<string, unknown>;
        if (typeof p.url !== 'string' || typeof p.username !== 'string' || typeof p.passwordB64 !== 'string') continue;
        if (!p.url.trim() || !p.username.trim()) continue;
        try {
            decodePlaylistPassword(p.passwordB64);
        } catch {
            continue; // corrupted base64 — skip this entry
        }
        result.push({
            name: typeof p.name === 'string' ? p.name : '',
            url: p.url,
            username: p.username,
            passwordB64: p.passwordB64
        });
    }
    return result;
}

/** Validates the optional v3 OpenSubtitles block; null when absent/corrupted. */
export function sanitizeBackupOpenSubtitles(raw: unknown): OpenSubtitlesCreds | null {
    if (raw === null || typeof raw !== 'object') return null;
    const os = raw as Record<string, unknown>;
    if (typeof os.apiKey !== 'string' || !os.apiKey.trim()) return null;
    const username = typeof os.username === 'string' ? os.username : '';
    let password = '';
    if (typeof os.passwordB64 === 'string' && os.passwordB64) {
        try {
            password = decodePlaylistPassword(os.passwordB64);
        } catch {
            return null; // corrupted base64 — drop the whole block
        }
    }
    return { apiKey: os.apiKey.trim(), username, password };
}

export function collectBackup(
    playlists: BackupPlaylist[] = [],
    openSubtitles?: OpenSubtitlesCreds,
): BackupPayload {
    const data: Record<string, string> = {};

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key === null || !isBackupKey(key)) continue;

        const value = localStorage.getItem(key);
        if (value !== null) {
            data[key] = value;
        }
    }

    return {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        app: BACKUP_APP,
        data,
        playlists,
        // Only worth carrying when actually configured.
        ...(openSubtitles?.apiKey ? {
            openSubtitles: {
                apiKey: openSubtitles.apiKey,
                username: openSubtitles.username,
                passwordB64: encodePlaylistPassword(openSubtitles.password),
            },
        } : {}),
    };
}

/**
 * Validates the parsed payload and applies the localStorage portion.
 * Returns the sanitized playlists (v2) for the caller to hand to the main
 * process — this module stays free of IPC so it remains unit-testable.
 */
export function applyBackup(parsed: unknown): ApplyReport & { playlists: BackupPlaylist[]; openSubtitles: OpenSubtitlesCreds | null } {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid backup: payload is not an object');
    }

    const payload = parsed as Partial<BackupPayload>;

    if (payload.app !== BACKUP_APP) {
        throw new Error(`Invalid backup: not a ${BACKUP_APP} backup file`);
    }
    if (typeof payload.version !== 'number' || payload.version < 1 || payload.version > BACKUP_VERSION) {
        throw new Error(`Invalid backup: unsupported version "${String(payload.version)}" (expected 1..${BACKUP_VERSION})`);
    }
    if (payload.data === null || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
        throw new Error('Invalid backup: missing data object');
    }

    let applied = 0;
    const skipped: string[] = [];

    for (const [key, value] of Object.entries(payload.data)) {
        if (typeof value !== 'string' || !isBackupKey(key)) {
            skipped.push(key);
            continue;
        }
        localStorage.setItem(key, value);
        applied++;
    }

    const playlists = payload.version >= 2 ? sanitizeBackupPlaylists(payload.playlists) : [];
    const openSubtitles = payload.version >= 3 ? sanitizeBackupOpenSubtitles(payload.openSubtitles) : null;

    return { applied, skipped, playlistsImported: 0, playlists, openSubtitles };
}

// ----------------- backup com senha (AES-GCM + PBKDF2, Web Crypto) -----------------
// Opcional: com senha o arquivo sai criptografado inteiro, com o prefixo
// abaixo marcando o formato (salt 16 + iv 12 + cifra, tudo em base64).

export const ENCRYPTED_PREFIX = 'NEOENC2:';

export function isEncryptedBackup(text: string): boolean {
    return text.startsWith(ENCRYPTED_PREFIX);
}

function bytesToB64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function deriveBackupKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptBackup(json: string, password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(password, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(json)));
    const packed = new Uint8Array(salt.length + iv.length + cipher.length);
    packed.set(salt, 0);
    packed.set(iv, salt.length);
    packed.set(cipher, salt.length + iv.length);
    return ENCRYPTED_PREFIX + bytesToB64(packed);
}

/** null = senha errada ou arquivo corrompido (o GCM autentica a cifra). */
export async function decryptBackup(text: string, password: string): Promise<string | null> {
    if (!isEncryptedBackup(text)) return text;
    try {
        const packed = b64ToBytes(text.slice(ENCRYPTED_PREFIX.length).trim());
        const salt = packed.subarray(0, 16);
        const iv = packed.subarray(16, 28);
        const cipher = packed.subarray(28);
        const key = await deriveBackupKey(password, salt);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource);
        return new TextDecoder().decode(plain);
    } catch {
        return null;
    }
}
