// Active-playlist accessor for the renderer.
//
// Per-profile user-state (favorites, movie/series watch progress) is ALSO
// namespaced by the active playlist, because stream ids are not stable across
// providers — the same numeric id means different content on each playlist, so
// a global-per-profile scope would bleed favorites/progress between providers.
//
// Switching a playlist reloads the whole app (see playlistService), so the
// active id is fixed for the lifetime of a boot. We fetch it once at boot via
// IPC, cache it in a module variable, and mirror it to localStorage so the
// synchronous getter below can answer even before init() resolves (e.g. a
// content page that mounts in the same tick).

const MIRROR_KEY = 'neostream_active_playlist_id';
const FALLBACK = 'default';

let cachedId: string | null = null;

/**
 * Fetch the active playlist id from the main process, cache it, and mirror it
 * to localStorage. Re-runs each boot (a playlist switch reloads the app). Best
 * effort: failures leave the previous mirror in place.
 */
export async function init(): Promise<void> {
    // Re-resolve from scratch each boot; if the IPC fails we fall back to the
    // localStorage mirror rather than a stale in-memory id.
    cachedId = null;
    try {
        const result = await window.ipcRenderer.invoke('playlists:get-active-id');
        const id = result && typeof result.id === 'string' ? result.id : null;
        cachedId = id;
        if (id) {
            localStorage.setItem(MIRROR_KEY, id);
        } else {
            // No active playlist (logged out / none): drop the stale mirror so
            // we fall back to FALLBACK instead of a previous playlist's id.
            localStorage.removeItem(MIRROR_KEY);
        }
    } catch {
        // Keep whatever the mirror already had; getActivePlaylistId() handles it.
    }
}

/**
 * The active playlist id, SYNCHRONOUSLY. Resolution order:
 *   1. module variable (set by init this boot)
 *   2. localStorage mirror (set by a previous init)
 *   3. 'default' fallback (no playlist known yet)
 */
export function getActivePlaylistId(): string {
    if (cachedId) return cachedId;
    try {
        const mirrored = localStorage.getItem(MIRROR_KEY);
        if (mirrored) return mirrored;
    } catch {
        /* localStorage unavailable — fall through */
    }
    return FALLBACK;
}

/** True when a real playlist id is known (not the 'default' race fallback). */
export function hasKnownPlaylistId(): boolean {
    return getActivePlaylistId() !== FALLBACK;
}

/**
 * Build a localStorage key scoped to both a profile and the active playlist:
 *   `${base}_${profileId}__pl_${activePlaylistId}`
 * The existing `${base}_${profileId}` form is kept as the migration source.
 */
export function playlistScopedKey(base: string, profileId: string): string {
    return `${base}_${profileId}__pl_${getActivePlaylistId()}`;
}

export const activePlaylistService = {
    init,
    getActivePlaylistId,
    hasKnownPlaylistId,
    playlistScopedKey,
};
