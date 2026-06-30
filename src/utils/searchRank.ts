/**
 * Pure search-ranking helpers for the global search overlay (Ctrl+K).
 *
 * Matching is diacritics- and case-insensitive, with a scored model that
 * prefers exact > prefix > word-boundary > substring > subsequence (fuzzy)
 * matches. The scoring is O(name length) per candidate, so ranking a few
 * thousand items per keystroke stays cheap (and the input is debounced).
 *
 * Also hosts the localStorage-backed "recent searches" helpers used by the
 * overlay's empty state.
 */

// --- Normalization ---------------------------------------------------------

/**
 * Lowercase + strip diacritics so "São"/"sao" and "ação"/"acao" compare equal.
 * Uses Unicode NFD decomposition then removes combining marks.
 */
export function normalizeForSearch(s: string): string {
    return s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();
}

// --- Scoring ---------------------------------------------------------------

// Score bands. Higher is better; 0 means "no match" (caller drops it).
// Bands are spaced wide enough that the per-match tiebreak bonuses (length /
// position, both < ~100) can never lift a lower band above a higher one.
const SCORE_EXACT = 10000;
const SCORE_PREFIX = 8000;
const SCORE_WORD_BOUNDARY = 6000;
const SCORE_SUBSTRING = 4000;
const SCORE_SUBSEQUENCE = 2000;

/**
 * Returns true if every char of `q` appears in `name` in order (not
 * necessarily contiguous). Both are expected pre-normalized. Empty `q`
 * is treated as a non-match here (callers gate empty queries earlier).
 */
function isSubsequence(q: string, name: string): boolean {
    if (q.length === 0) return false;
    let qi = 0;
    for (let ni = 0; ni < name.length && qi < q.length; ni++) {
        if (name[ni] === q[qi]) qi++;
    }
    return qi === q.length;
}

/**
 * Score how well `name` matches `query`. Returns 0 for no match.
 *
 * Ranking (high → low):
 *   exact equality > starts-with > match at a word boundary (after a space)
 *   > substring anywhere > subsequence/fuzzy.
 * Tiebreakers within a band: earlier match position and shorter names win.
 *
 * Both arguments are normalized internally, so callers may pass raw strings.
 */
export function scoreMatch(query: string, name: string): number {
    const q = normalizeForSearch(query);
    const n = normalizeForSearch(name);
    if (q.length === 0 || n.length === 0) return 0;

    // Shorter names rank slightly higher (more "exact"-feeling). Bounded so it
    // never crosses a band. ~0..50.
    const lengthBonus = Math.max(0, 50 - Math.min(n.length, 50));

    if (n === q) {
        return SCORE_EXACT + lengthBonus;
    }

    if (n.startsWith(q)) {
        return SCORE_PREFIX + lengthBonus;
    }

    const idx = n.indexOf(q);
    if (idx !== -1) {
        // Earlier matches rank higher within the band. ~0..100.
        const positionBonus = Math.max(0, 100 - idx);
        // A substring that begins right after a space is a word-boundary hit.
        if (n[idx - 1] === ' ') {
            return SCORE_WORD_BOUNDARY + positionBonus + lengthBonus * 0.1;
        }
        return SCORE_SUBSTRING + positionBonus + lengthBonus * 0.1;
    }

    if (isSubsequence(q, n)) {
        return SCORE_SUBSEQUENCE + lengthBonus;
    }

    return 0;
}

/**
 * Score every item, drop non-matches (score 0), sort best-first (stable on
 * ties via original index), and return at most `limit` items.
 *
 * O(n) scoring + O(m log m) sort over the m matches; no quadratic work.
 */
export function rankItems<T>(
    items: readonly T[],
    query: string,
    getName: (item: T) => string,
    limit: number
): T[] {
    const scored: Array<{ item: T; score: number; index: number }> = [];
    for (let i = 0; i < items.length; i++) {
        const score = scoreMatch(query, getName(items[i]));
        if (score > 0) scored.push({ item: items[i], score, index: i });
    }
    scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
    const out: T[] = [];
    for (let i = 0; i < scored.length && out.length < limit; i++) {
        out.push(scored[i].item);
    }
    return out;
}

// --- Recent searches (localStorage) ----------------------------------------

export const RECENT_SEARCHES_KEY = 'neostream_recent_searches';
export const MAX_RECENT_SEARCHES = 8;

/** Read the recent-searches list (most-recent-first). Safe on any failure. */
export function getRecentSearches(): string[] {
    try {
        const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .slice(0, MAX_RECENT_SEARCHES);
    } catch {
        return [];
    }
}

/**
 * Record a freshly-used query: trim, dedupe (case-insensitive,
 * diacritics-insensitive), unshift to the front, cap at MAX_RECENT_SEARCHES.
 * Returns the new list (also persisted). No-ops on empty/whitespace queries.
 */
export function addRecentSearch(query: string): string[] {
    const trimmed = query.trim();
    if (!trimmed) return getRecentSearches();
    const key = normalizeForSearch(trimmed);
    const existing = getRecentSearches().filter(q => normalizeForSearch(q) !== key);
    const next = [trimmed, ...existing].slice(0, MAX_RECENT_SEARCHES);
    try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
        // localStorage unavailable: the in-memory list is still returned
    }
    return next;
}

/** Clear all recent searches. Safe on any failure. */
export function clearRecentSearches(): void {
    try {
        localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
        // ignore
    }
}
