// Backup/restore of user data stored in localStorage.
//
// The backup intentionally includes only user data (profiles, favorites,
// watch-later, watch progress, configs, stats, language) and EXCLUDES:
//   - provider credentials (they live in the Electron main-process store)
//   - caches (tmdb_*, EPG test results, contentLastFetch)
//   - transient flags (shouldAutoPlayNextEpisode, parentalUnlocked)

export const BACKUP_VERSION = 1;
export const BACKUP_APP = 'neostream';

export interface BackupPayload {
    version: number;
    exportedAt: string;
    app: typeof BACKUP_APP;
    data: Record<string, string>;
}

export interface ApplyReport {
    applied: number;
    skipped: string[];
}

// Keys included by exact name
const EXACT_KEYS = [
    'neostream_profiles',     // profiles + active profile + watch-later lists
    'neostream_language',     // UI language
    'parentalConfig',         // parental control config (PIN hash included)
    'playerVolume',           // last player volume
    'watchLater',             // legacy pre-profile watch-later list
];

// Keys included when they start with one of these prefixes
const PREFIX_KEYS = [
    'neostream_profile_',     // per-profile favorites, incl. _<profileId>__pl_<playlistId>
    'playbackConfig',         // playbackConfig and playbackConfig_<profileId>
    'movie_watch_progress',   // movie resume positions, incl. per-(profile,playlist)
    'series_watch_progress',  // series progress, incl. per-(profile,playlist)
    'usage_stats',            // usage_stats_<profileId> / usage_stats_default
];

export function isBackupKey(key: string): boolean {
    return EXACT_KEYS.includes(key) || PREFIX_KEYS.some(prefix => key.startsWith(prefix));
}

export function collectBackup(): BackupPayload {
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
        data
    };
}

export function applyBackup(parsed: unknown): ApplyReport {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid backup: payload is not an object');
    }

    const payload = parsed as Partial<BackupPayload>;

    if (payload.app !== BACKUP_APP) {
        throw new Error(`Invalid backup: not a ${BACKUP_APP} backup file`);
    }
    if (payload.version !== BACKUP_VERSION) {
        throw new Error(`Invalid backup: unsupported version "${String(payload.version)}" (expected ${BACKUP_VERSION})`);
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

    return { applied, skipped };
}
