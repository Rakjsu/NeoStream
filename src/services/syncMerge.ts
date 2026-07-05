// Multi-machine sync: pure merge of another machine's synced data into ours.
//
// Each machine drops its own `neostream-sync-<machineId>.json` (same payload
// as the backup export) into a user-chosen synced folder (Dropbox, Drive,
// OneDrive, network share...). On each cycle every machine merges the OTHER
// machines' files into its localStorage and rewrites its own file.
//
// Merge philosophy: keys the app knows how to merge item-by-item are merged
// (unions / newest-wins per item); everything else is adopted only when
// missing locally. Deletions propagate through the tombstones ledger
// (syncTombstones.ts): an item loses to a tombstone NEWER than its addedAt,
// so a re-add after a deletion still survives.

import { isBackupKey } from './backupService';
import { TOMBSTONES_KEY, pruneTombstones, type TombstoneMap } from './syncTombstones';

export interface SyncMergeResult {
    /** Keys whose merged value differs from the local one (need writing). */
    changed: Record<string, string>;
    /** Item-level counters for user feedback. */
    addedItems: number;
    adoptedKeys: number;
    removedItems: number;
}

interface FavoriteLike {
    id: string | number;
    type?: string;
    addedAt?: string;
}

interface MovieProgressLike {
    movieId: string;
    watchedAt: number;
}

interface EpisodeProgressLike {
    seriesId: string;
    seasonNumber: number;
    episodeNumber: number;
    watchedAt: number;
}

function parseJson<T>(raw: string | undefined | null): T | null {
    if (typeof raw !== 'string' || !raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

function itemKey(item: FavoriteLike): string {
    return `${String(item.id)}::${item.type ?? ''}`;
}

/** True when the item's tombstone is newer than its addedAt (deletion wins ties). */
function isTombstoned(item: FavoriteLike, tombs: Record<string, number> | undefined): boolean {
    const deletedAt = tombs?.[itemKey(item)];
    if (typeof deletedAt !== 'number') return false;
    const addedAt = Date.parse(item.addedAt ?? '');
    return !(Number.isFinite(addedAt) && addedAt > deletedAt);
}

/**
 * Union of two item arrays by (id,type); local order wins, new items append.
 * Tombstoned items are dropped from BOTH sides (that's how a removal made on
 * another machine lands here).
 */
function unionById<T extends FavoriteLike>(
    local: T[],
    remote: T[],
    tombs?: Record<string, number>,
): { items: T[]; added: number; removed: number } {
    const keptLocal = local.filter(item => !isTombstoned(item, tombs));
    const removed = local.length - keptLocal.length;
    const seen = new Set(keptLocal.map(itemKey));
    const items = [...keptLocal];
    let added = 0;
    for (const item of remote) {
        if (item === null || typeof item !== 'object' || item.id === undefined) continue;
        if (seen.has(itemKey(item)) || isTombstoned(item, tombs)) continue;
        seen.add(itemKey(item));
        items.push(item);
        added++;
    }
    return { items, added, removed };
}

/** Union of two tombstone maps, newest deletion wins per item. */
export function mergeTombstoneMaps(a: TombstoneMap, b: TombstoneMap): TombstoneMap {
    const merged: TombstoneMap = {};
    for (const source of [a, b]) {
        for (const [storageKey, items] of Object.entries(source ?? {})) {
            if (items === null || typeof items !== 'object') continue;
            if (!merged[storageKey]) merged[storageKey] = {};
            for (const [item, deletedAt] of Object.entries(items)) {
                if (typeof deletedAt !== 'number') continue;
                if (!(item in merged[storageKey]) || deletedAt > merged[storageKey][item]) {
                    merged[storageKey][item] = deletedAt;
                }
            }
        }
    }
    return merged;
}

/** Per-movie newest-wins by watchedAt. */
function mergeMovieProgress(local: MovieProgressLike[], remote: MovieProgressLike[]): { items: MovieProgressLike[]; added: number } {
    const byId = new Map<string, MovieProgressLike>();
    for (const entry of local) {
        if (entry && typeof entry.movieId === 'string') byId.set(entry.movieId, entry);
    }
    let added = 0;
    for (const entry of remote) {
        if (!entry || typeof entry.movieId !== 'string') continue;
        const current = byId.get(entry.movieId);
        if (!current || (entry.watchedAt ?? 0) > (current.watchedAt ?? 0)) {
            byId.set(entry.movieId, entry);
            added++;
        }
    }
    return { items: [...byId.values()], added };
}

/** Per-episode newest-wins by watchedAt. */
function mergeEpisodeProgress(local: EpisodeProgressLike[], remote: EpisodeProgressLike[]): { items: EpisodeProgressLike[]; added: number } {
    const key = (e: EpisodeProgressLike) => `${e.seriesId}:${e.seasonNumber}:${e.episodeNumber}`;
    const byKey = new Map<string, EpisodeProgressLike>();
    for (const entry of local) {
        if (entry && typeof entry.seriesId === 'string') byKey.set(key(entry), entry);
    }
    let added = 0;
    for (const entry of remote) {
        if (!entry || typeof entry.seriesId !== 'string') continue;
        const current = byKey.get(key(entry));
        if (!current || (entry.watchedAt ?? 0) > (current.watchedAt ?? 0)) {
            byKey.set(key(entry), entry);
            added++;
        }
    }
    return { items: [...byKey.values()], added };
}

/** Profiles registry: add remote-only profiles; local versions win on conflict. */
function mergeProfilesRegistry(localRaw: string, remoteRaw: string): { value: string; added: number } | null {
    const local = parseJson<Record<string, unknown>>(localRaw);
    const remote = parseJson<Record<string, unknown>>(remoteRaw);
    if (!local || !remote) return null;
    const localProfiles = Array.isArray(local.profiles) ? local.profiles as FavoriteLike[] : null;
    const remoteProfiles = Array.isArray(remote.profiles) ? remote.profiles as FavoriteLike[] : null;
    if (!localProfiles || !remoteProfiles) return null;
    const { items, added } = unionById(localProfiles, remoteProfiles);
    if (added === 0) return { value: localRaw, added: 0 };
    return { value: JSON.stringify({ ...local, profiles: items }), added };
}

/** Profile data object (`neostream_profile_*`): union of the favorites array. */
function mergeProfileData(
    localRaw: string,
    remoteRaw: string,
    tombs?: Record<string, number>,
): { value: string; added: number; removed: number } | null {
    const local = parseJson<Record<string, unknown>>(localRaw);
    const remote = parseJson<Record<string, unknown>>(remoteRaw);
    if (!local || !remote) return null;
    const localFavs = Array.isArray(local.favorites) ? local.favorites as FavoriteLike[] : [];
    const remoteFavs = Array.isArray(remote.favorites) ? remote.favorites as FavoriteLike[] : [];
    const { items, added, removed } = unionById(localFavs, remoteFavs, tombs);
    if (added === 0 && removed === 0) return { value: localRaw, added: 0, removed: 0 };
    return { value: JSON.stringify({ ...local, favorites: items }), added, removed };
}

function mergeArrayKey<T>(
    localRaw: string,
    remoteRaw: string,
    merge: (local: T[], remote: T[]) => { items: T[]; added: number; removed?: number },
): { value: string; added: number; removed: number } | null {
    const local = parseJson<T[]>(localRaw);
    const remote = parseJson<T[]>(remoteRaw);
    if (!Array.isArray(remote)) return null;
    const safeLocal = Array.isArray(local) ? local : [];
    const { items, added, removed = 0 } = merge(safeLocal, remote);
    if (added === 0 && removed === 0) return { value: localRaw, added: 0, removed: 0 };
    return { value: JSON.stringify(items), added, removed };
}

/**
 * Merge one remote machine's `data` map into a snapshot of ours. Returns only
 * the keys that must be written back. Pure — no localStorage access.
 */
export function mergeSyncData(
    local: Record<string, string>,
    remote: Record<string, string>,
    nowMs: number = Date.now(),
): SyncMergeResult {
    const changed: Record<string, string> = {};
    let addedItems = 0;
    let adoptedKeys = 0;
    let removedItems = 0;

    // Deletions ledger first: the unions below consult the COMBINED map so a
    // removal made on either machine wins over stale copies.
    const tombstones = pruneTombstones(
        mergeTombstoneMaps(
            parseJson<TombstoneMap>(local[TOMBSTONES_KEY]) ?? {},
            parseJson<TombstoneMap>(remote[TOMBSTONES_KEY]) ?? {},
        ),
        nowMs,
    );
    const tombstonesJson = JSON.stringify(tombstones);
    const hadTombstones = local[TOMBSTONES_KEY] !== undefined || Object.keys(tombstones).length > 0;
    if (hadTombstones && tombstonesJson !== local[TOMBSTONES_KEY]) {
        changed[TOMBSTONES_KEY] = tombstonesJson;
    }

    const mergeOne = (key: string, localValue: string, remoteValue: string) => {
        let result: { value: string; added: number; removed?: number } | null = null;
        if (key === 'neostream_profiles') {
            result = mergeProfilesRegistry(localValue, remoteValue);
        } else if (key.startsWith('neostream_profile_')) {
            result = mergeProfileData(localValue, remoteValue, tombstones[key]);
        } else if (key.startsWith('neostream_watchlater_') || key === 'watchLater') {
            result = mergeArrayKey<FavoriteLike>(localValue, remoteValue, (a, b) => unionById(a, b, tombstones[key]));
        } else if (key.startsWith('movie_watch_progress')) {
            result = mergeArrayKey<MovieProgressLike>(localValue, remoteValue, mergeMovieProgress);
        } else if (key.startsWith('series_watch_progress')) {
            result = mergeArrayKey<EpisodeProgressLike>(localValue, remoteValue, mergeEpisodeProgress);
        }
        // Anything else (scalar prefs, parental config, stats...): local wins.
        if (!result || (result.added === 0 && (result.removed ?? 0) === 0)) return;
        changed[key] = result.value;
        addedItems += result.added;
        removedItems += result.removed ?? 0;
    };

    const processed = new Set<string>([TOMBSTONES_KEY]);
    for (const [key, remoteValue] of Object.entries(remote)) {
        if (key === TOMBSTONES_KEY) continue;
        if (typeof remoteValue !== 'string' || !isBackupKey(key)) continue;
        processed.add(key);

        const localValue = local[key];

        // Key we don't have at all: adopt the remote value wholesale (minus
        // anything the ledger already condemned).
        if (localValue === undefined) {
            if (tombstones[key]) {
                mergeOne(key, '[]', remoteValue);
            } else {
                changed[key] = remoteValue;
            }
            adoptedKeys++;
            continue;
        }
        // Identical values can still owe deletions to the ledger.
        if (localValue === remoteValue && !tombstones[key]) continue;

        mergeOne(key, localValue, remoteValue);
    }

    // Keys the remote doesn't carry but whose items the ledger condemns:
    // apply the deletions locally too.
    for (const key of Object.keys(tombstones)) {
        if (processed.has(key) || local[key] === undefined || !isBackupKey(key)) continue;
        mergeOne(key, local[key], local[key]);
    }

    return { changed, addedItems, adoptedKeys, removedItems };
}
