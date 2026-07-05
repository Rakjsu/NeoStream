// Sync tombstones: deletions ledger so removals propagate between machines.
//
// When the user removes a favorite / watch-later item, the removal is
// recorded here as `storageKey -> itemKey -> deletedAtMs`. The ledger travels
// inside the sync payload (backup allowlist) and syncMerge honours it on both
// sides: an item loses to a tombstone NEWER than its addedAt, so re-adding
// after a deletion still works. Entries expire after 30 days.

export const TOMBSTONES_KEY = 'neostream_sync_tombstones';
export const TOMBSTONE_TTL_MS = 30 * 24 * 3600_000;

export type TombstoneMap = Record<string, Record<string, number>>;

/** Item identity — MUST match syncMerge's union key ("id::type"). */
export function tombstoneItemKey(id: string | number, type?: string): string {
    return `${String(id)}::${type ?? ''}`;
}

function load(): TombstoneMap {
    try {
        const raw = localStorage.getItem(TOMBSTONES_KEY);
        const parsed = raw ? JSON.parse(raw) as TombstoneMap : {};
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/** Drop expired entries (pure). */
export function pruneTombstones(map: TombstoneMap, nowMs: number): TombstoneMap {
    const next: TombstoneMap = {};
    for (const [storageKey, items] of Object.entries(map)) {
        if (items === null || typeof items !== 'object') continue;
        const kept: Record<string, number> = {};
        for (const [itemKey, deletedAt] of Object.entries(items)) {
            if (typeof deletedAt === 'number' && nowMs - deletedAt < TOMBSTONE_TTL_MS) {
                kept[itemKey] = deletedAt;
            }
        }
        if (Object.keys(kept).length > 0) next[storageKey] = kept;
    }
    return next;
}

export const syncTombstones = {
    /** Record one deletion (called by the favorites/watch-later services). */
    record(storageKey: string, itemKey: string): void {
        try {
            const now = Date.now();
            const map = pruneTombstones(load(), now);
            if (!map[storageKey]) map[storageKey] = {};
            map[storageKey][itemKey] = now;
            localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(map));
        } catch { /* ledger is best-effort */ }
    },
};
