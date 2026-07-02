/**
 * Pure helpers for remembering the MPV audio/subtitle track choice per
 * content (movie or series), per profile. Preferences store the LANGUAGE
 * (not the track id) so they survive across episodes of the same series,
 * whose track ids may differ per file.
 */

export interface MpvTrackLike {
    id: number;
    type: 'audio' | 'sub';
    lang: string | null;
    title: string | null;
}

export interface TrackPref {
    /** Preferred audio language (lowercase) or null when never chosen. */
    audioLang: string | null;
    /** Preferred subtitle language, 'off' for explicitly disabled, null = never chosen. */
    subLang: string | 'off' | null;
}

/** Stable key for the content a preference belongs to. */
export function trackPrefKey(movieId?: string, seriesId?: string): string | null {
    if (seriesId) return `s:${seriesId}`;
    if (movieId) return `m:${movieId}`;
    return null;
}

/** Normalized language of a track (falls back to title, lowercased). */
export function trackLang(track: MpvTrackLike): string | null {
    return (track.lang || track.title || '').toLowerCase() || null;
}

/**
 * Given the file's tracks and a saved preference, decide which selections to
 * apply. Returns only the fields that should change (undefined = leave as-is).
 */
export function choosePreferredTracks(
    tracks: MpvTrackLike[],
    pref: TrackPref | null | undefined
): { audioId?: number; subtitleId?: number | null } {
    if (!pref) return {};
    const result: { audioId?: number; subtitleId?: number | null } = {};

    if (pref.audioLang) {
        const audio = tracks.find(t => t.type === 'audio' && trackLang(t) === pref.audioLang);
        if (audio) result.audioId = audio.id;
    }

    if (pref.subLang === 'off') {
        result.subtitleId = null;
    } else if (pref.subLang) {
        const sub = tracks.find(t => t.type === 'sub' && trackLang(t) === pref.subLang);
        if (sub) result.subtitleId = sub.id;
    }

    return result;
}
