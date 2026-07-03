// Multi-machine sync: pure merge of another machine's synced data into ours.
//
// Each machine drops its own `neostream-sync-<machineId>.json` (same payload
// as the backup export) into a user-chosen synced folder (Dropbox, Drive,
// OneDrive, network share...). On each cycle every machine merges the OTHER
// machines' files into its localStorage and rewrites its own file.
//
// Merge philosophy (v1): NEVER destroy local data. Keys the app knows how to
// merge item-by-item are merged (unions / newest-wins per item); everything
// else is adopted only when missing locally. Deletions don't propagate — the
// cost of not having per-item tombstones, accepted for v1.

import { isBackupKey } from './backupService';

export interface SyncMergeResult {
    /** Keys whose merged value differs from the local one (need writing). */
    changed: Record<string, string>;
    /** Item-level counters for user feedback. */
    addedItems: number;
    adoptedKeys: number;
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

/** Union of two item arrays by (id,type); local order wins, new items append. */
function unionById<T extends FavoriteLike>(local: T[], remote: T[]): { items: T[]; added: number } {
    const seen = new Set(local.map(itemKey));
    const items = [...local];
    let added = 0;
    for (const item of remote) {
        if (item === null || typeof item !== 'object' || item.id === undefined) continue;
        if (seen.has(itemKey(item))) continue;
        seen.add(itemKey(item));
        items.push(item);
        added++;
    }
    return { items, added };
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
function mergeProfileData(localRaw: string, remoteRaw: string): { value: string; added: number } | null {
    const local = parseJson<Record<string, unknown>>(localRaw);
    const remote = parseJson<Record<string, unknown>>(remoteRaw);
    if (!local || !remote) return null;
    const localFavs = Array.isArray(local.favorites) ? local.favorites as FavoriteLike[] : [];
    const remoteFavs = Array.isArray(remote.favorites) ? remote.favorites as FavoriteLike[] : [];
    const { items, added } = unionById(localFavs, remoteFavs);
    if (added === 0) return { value: localRaw, added: 0 };
    return { value: JSON.stringify({ ...local, favorites: items }), added };
}

function mergeArrayKey<T>(
    localRaw: string,
    remoteRaw: string,
    merge: (local: T[], remote: T[]) => { items: T[]; added: number },
): { value: string; added: number } | null {
    const local = parseJson<T[]>(localRaw);
    const remote = parseJson<T[]>(remoteRaw);
    if (!Array.isArray(remote)) return null;
    const safeLocal = Array.isArray(local) ? local : [];
    const { items, added } = merge(safeLocal, remote);
    if (added === 0) return { value: localRaw, added: 0 };
    return { value: JSON.stringify(items), added };
}

/**
 * Merge one remote machine's `data` map into a snapshot of ours. Returns only
 * the keys that must be written back. Pure — no localStorage access.
 */
export function mergeSyncData(
    local: Record<string, string>,
    remote: Record<string, string>,
): SyncMergeResult {
    const changed: Record<string, string> = {};
    let addedItems = 0;
    let adoptedKeys = 0;

    for (const [key, remoteValue] of Object.entries(remote)) {
        if (typeof remoteValue !== 'string' || !isBackupKey(key)) continue;

        const localValue = local[key];

        // Key we don't have at all: adopt the remote value wholesale.
        if (localValue === undefined) {
            changed[key] = remoteValue;
            adoptedKeys++;
            continue;
        }
        if (localValue === remoteValue) continue;

        let result: { value: string; added: number } | null = null;
        if (key === 'neostream_profiles') {
            result = mergeProfilesRegistry(localValue, remoteValue);
        } else if (key.startsWith('neostream_profile_')) {
            result = mergeProfileData(localValue, remoteValue);
        } else if (key.startsWith('neostream_watchlater_') || key === 'watchLater') {
            result = mergeArrayKey<FavoriteLike>(localValue, remoteValue, unionById);
        } else if (key.startsWith('movie_watch_progress')) {
            result = mergeArrayKey<MovieProgressLike>(localValue, remoteValue, mergeMovieProgress);
        } else if (key.startsWith('series_watch_progress')) {
            result = mergeArrayKey<EpisodeProgressLike>(localValue, remoteValue, mergeEpisodeProgress);
        }
        // Anything else (scalar prefs, parental config, stats...): local wins.
        if (!result || result.added === 0) continue;

        changed[key] = result.value;
        addedItems += result.added;
    }

    return { changed, addedItems, adoptedKeys };
}
