/**
 * Pure helpers for series episodes — kept out of the modal so they're unit-testable.
 */

/**
 * Turn a raw provider episode title into a clean, human display title.
 * Strips series-name/season-episode markers and generic filler; falls back to
 * "Episódio N" when nothing meaningful remains.
 */
export function episodeDisplayTitle(rawTitle: string | undefined | null, epNum: number): string {
    const cleanTitle = (rawTitle || '')
        // Bracketed forms first — otherwise the prefix regex below eats
        // "Title [S01E01]" down to a stray "]".
        .replace(/\s*[[(]S\d+[\s.-]*E\d+[\])]\s*/gi, '')              // "[S01E01]" / "(S01.E01)"
        .replace(/^(.*?)[\s\-–—]*S\d+[\s\-:.]*E\d+[\s\-:.–—]*/i, '') // "SeriesName S01E01 -"
        .replace(/\s*S\d+[\s.-]*E\d+\s*/gi, '')                       // bare "S01E01" leftovers
        .replace(/\s*-\s*Temporada\s*\d+\s*Epis[óo]dio\s*\d+\s*/gi, '') // "- Temporada X Episódio Y"
        .replace(/\s*Temp\s*\d+\s*Ep\s*\d+\s*/gi, '')                 // "Temp X Ep Y"
        .replace(/Episode\s*\d+/gi, '')                               // "Episode X"
        .replace(/^\d+\.?\s*/, '')                                    // leading "1. " / "01 "
        .trim();

    const genericPatterns = [
        /^ep\s*\d+$/i,
        /^\d+$/,
        /^temporada\s*\d+\s*episodio\s*\d+$/i,
        /^episode$/i,
    ];
    const isValidTitle = cleanTitle.length > 0 && !genericPatterns.some(p => p.test(cleanTitle));

    return isValidTitle ? cleanTitle : `Episódio ${epNum}`;
}

/** Season keys of a series-info episodes map, sorted numerically ascending. */
export function sortedSeasonKeys(episodes: Record<string, unknown> | undefined | null): string[] {
    if (!episodes) return [];
    return Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
}
