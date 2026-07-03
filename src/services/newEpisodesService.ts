/**
 * New-episode detection for series the user follows (favorites + series with
 * watch progress), based on the `last_modified` field of the provider's
 * series list — zero extra network calls.
 *
 * Baseline semantics: the first time a followed series is seen it is recorded
 * silently (nothing is "new" on first run). From then on, a bumped
 * last_modified means the provider touched the series (new episode) until the
 * user opens it (markSeen).
 */

import { profileService } from './profileService';
import { playlistScopedKey } from './activePlaylistService';

export interface FollowableSeries {
    series_id: number;
    name: string;
    last_modified?: string;
}

type SeenMap = Record<string, number>;

const KEY_BASE = 'neostream_series_seen';

function storageKey(): string | null {
    const profile = profileService.getActiveProfile();
    if (!profile) return null;
    return playlistScopedKey(KEY_BASE, profile.id);
}

function loadSeen(): SeenMap {
    const key = storageKey();
    if (!key) return {};
    try {
        return JSON.parse(localStorage.getItem(key) || '{}') as SeenMap;
    } catch {
        return {};
    }
}

function saveSeen(seen: SeenMap): void {
    const key = storageKey();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify(seen));
    } catch { /* best-effort */ }
}

/** Parse the provider's last_modified (epoch seconds as string) defensively. */
export function parseLastModified(value: string | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Pure core: which followed series have last_modified newer than the seen
 * baseline. Series absent from the baseline are NOT flagged (first sighting).
 */
export function findUpdatedSeries<T extends FollowableSeries>(
    seriesList: T[],
    followedIds: Set<string>,
    seen: SeenMap
): T[] {
    const updated: Array<{ series: T; modified: number }> = [];
    for (const series of seriesList) {
        const id = String(series.series_id);
        if (!followedIds.has(id)) continue;
        const baseline = seen[id];
        if (baseline === undefined) continue;
        const modified = parseLastModified(series.last_modified);
        if (modified > baseline) updated.push({ series, modified });
    }
    return updated.sort((a, b) => b.modified - a.modified).map(u => u.series);
}

/** Pure core: baseline entries to add for followed series seen for the first time. */
export function buildBaselineAdditions(
    seriesList: FollowableSeries[],
    followedIds: Set<string>,
    seen: SeenMap
): SeenMap {
    const additions: SeenMap = {};
    for (const series of seriesList) {
        const id = String(series.series_id);
        if (!followedIds.has(id) || seen[id] !== undefined) continue;
        additions[id] = parseLastModified(series.last_modified);
    }
    return additions;
}

export const newEpisodesService = {
    /** Followed series with updates since last seen (also seeds the baseline). */
    getUpdatedSeries<T extends FollowableSeries>(seriesList: T[], followedIds: Set<string>): T[] {
        const seen = loadSeen();
        const additions = buildBaselineAdditions(seriesList, followedIds, seen);
        if (Object.keys(additions).length > 0) {
            saveSeen({ ...seen, ...additions });
        }
        return findUpdatedSeries(seriesList, followedIds, seen);
    },

    /** User opened the series — updates stop being "new". */
    markSeen(seriesId: string | number, lastModified?: string): void {
        const seen = loadSeen();
        seen[String(seriesId)] = Math.max(parseLastModified(lastModified), Math.floor(Date.now() / 1000));
        saveSeen(seen);
    }
};
