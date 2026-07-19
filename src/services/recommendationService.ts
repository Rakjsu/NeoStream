/**
 * Personalized Home recommendations — "Porque você assistiu X".
 *
 * Local-first and cheap:
 * - Seeds come from the local watch history (movies + series, most recent first).
 * - Seed genres are resolved from the local IndexedDB TMDB cache; at most 3
 *   TMDB searches are made for the most recent seeds without cached genres
 *   (results are cached fire-and-forget for next time).
 * - Candidates are scored with pure functions (genre overlap weighted by seed
 *   recency, provider category match, franchise title-prefix boost) so the
 *   core logic is unit-testable without any network.
 */

import { movieProgressService } from './movieProgressService';
import { watchProgressService } from './watchProgressService';
import { indexedDBCache } from './indexedDBCache';
import { searchMovieByName, searchSeriesByName } from './tmdb';
import { usageStatsService } from './usageStatsService';
import { blockedRecommendationsService } from './blockedRecommendationsService';
import { buildHabitProfile, habitBoost, hourBucketOf, type HabitProfile, type HourBucket } from './habitProfile';

// ==================== Types ====================

export interface RecMovie {
    stream_id: number;
    name: string;
    stream_icon: string;
    cover?: string;
    rating?: string;
    category_id?: string;
    genre?: string; // provider metadata, sometimes present
    added?: number;
}

export interface RecSeries {
    series_id: number;
    name: string;
    cover: string;
    rating?: string;
    category_id?: string;
    genre?: string; // provider metadata, sometimes present
    added?: number;
}

export interface RecSeed {
    kind: 'vod' | 'series';
    name: string;
    /** 0 = most recently watched */
    recencyRank: number;
    genres: string[];
    categoryId?: string;
}

export interface Recommendation {
    kind: 'vod' | 'series';
    item: RecMovie | RecSeries;
    becauseOf: string; // seed name that contributed the most score
    score: number;
}

export interface RecommendationGroup {
    seedName: string;
    items: Recommendation[];
}

// ==================== Pure helpers (unit-tested) ====================

/** Lowercase, strip accents/tags/quality markers, collapse whitespace. */
export function normalizeTitle(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s*\[.*?\]\s*/g, ' ')
        .replace(/\s*\(\d{4}\)\s*/g, ' ')
        .replace(/\b(4k|uhd|fhd|hd|sd|h265|h264|dual|dublado|legendado|leg|dub)\b/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const GENERIC_TOKENS = new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'e',
    'the', 'an', 'of', 'el', 'la', 'los', 'las', 'y', 'and'
]);

function titleTokens(name: string): string[] {
    return normalizeTitle(name).split(' ').filter(tk => tk.length > 0 && !GENERIC_TOKENS.has(tk));
}

/**
 * True when two titles look like the same franchise via a shared leading
 * prefix — e.g. "Homem-Aranha" / "Homem-Aranha: Sem Volta Para Casa", or
 * "Matrix" / "Matrix Reloaded".
 */
export function sharesFranchisePrefix(a: string, b: string): boolean {
    const ta = titleTokens(a);
    const tb = titleTokens(b);
    if (ta.length === 0 || tb.length === 0) return false;

    let shared = 0;
    const min = Math.min(ta.length, tb.length);
    while (shared < min && ta[shared] === tb[shared]) shared++;

    if (shared >= 2) return true;
    // Single-word franchises ("Matrix") only count when one title IS that word
    // and it is distinctive enough.
    return shared === 1 && (ta.length === 1 || tb.length === 1) && ta[0].length >= 4;
}

function normalizeGenre(genre: string): string {
    return genre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim();
}

/** Split a provider genre string ("Ação / Aventura, Sci-Fi") into tokens. */
export function splitGenres(genre: string | undefined | null): string[] {
    if (!genre) return [];
    return genre
        .split(/[,;|/&]/)
        .map(normalizeGenre)
        .filter(g => g.length > 1);
}

function genresMatch(a: string, b: string): boolean {
    if (a === b) return true;
    // "acao e aventura" should match "acao"
    return (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b));
}

export function genreOverlapCount(candidateGenres: string[], seedGenres: string[]): number {
    if (candidateGenres.length === 0 || seedGenres.length === 0) return 0;
    const normalizedSeeds = seedGenres.map(normalizeGenre);
    let count = 0;
    for (const cg of candidateGenres) {
        if (normalizedSeeds.some(sg => genresMatch(cg, sg))) count++;
    }
    return count;
}

/** Recency weight: most recent seed counts the most. */
export function seedWeight(recencyRank: number): number {
    return 1 / (1 + 0.35 * recencyRank);
}

export interface ScoredCandidate {
    score: number;
    becauseOf: string;
}

/**
 * Score one candidate against all seeds.
 * score = Σ per-seed [ 2*genreOverlap + 1*categoryMatch + 2.5*franchise ] * weight(recency)
 */
export function scoreCandidate(
    candidate: { name: string; category_id?: string; genre?: string },
    seeds: RecSeed[]
): ScoredCandidate | null {
    const candidateGenres = splitGenres(candidate.genre);
    let total = 0;
    let best = 0;
    let becauseOf = '';

    for (const seed of seeds) {
        const w = seedWeight(seed.recencyRank);
        let contribution = 0;

        contribution += 2 * genreOverlapCount(candidateGenres, seed.genres) * w;
        if (seed.categoryId && candidate.category_id && seed.categoryId === candidate.category_id) {
            contribution += 1 * w;
        }
        if (sharesFranchisePrefix(candidate.name, seed.name)) {
            contribution += 2.5 * w;
        }

        total += contribution;
        if (contribution > best) {
            best = contribution;
            becauseOf = seed.name;
        }
    }

    if (total <= 0 || !becauseOf) return null;
    return { score: total, becauseOf };
}

/**
 * Light shuffle inside score bands so the row varies between visits without
 * letting weak matches jump ahead of strong ones. Bands are score rounded to
 * the nearest 0.5. `rng` is injectable for deterministic tests.
 */
export function bandedShuffle<T extends { score: number }>(items: T[], rng: () => number = Math.random): T[] {
    const bands = new Map<number, T[]>();
    const order: number[] = [];
    const sorted = [...items].sort((a, b) => b.score - a.score);

    for (const item of sorted) {
        const band = Math.round(item.score * 2) / 2;
        if (!bands.has(band)) {
            bands.set(band, []);
            order.push(band);
        }
        bands.get(band)!.push(item);
    }

    const result: T[] = [];
    for (const band of order) {
        const group = bands.get(band)!;
        // Fisher-Yates within the band
        for (let i = group.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [group[i], group[j]] = [group[j], group[i]];
        }
        result.push(...group);
    }
    return result;
}

export interface HabitContext {
    profile: HabitProfile;
    weekday: number;
    hourBucket: HourBucket;
}

export interface BuildInput {
    seeds: RecSeed[];
    movies: RecMovie[];
    series: RecSeries[];
    /** normalized titles already watched / in history (excluded) */
    excludeTitles: Set<string>;
    /** raw ids already watched (movie stream_ids / series_ids as strings) */
    excludeMovieIds: Set<string>;
    excludeSeriesIds: Set<string>;
    maxItems?: number;
    rng?: () => number;
    /** Optional viewing-habit context: boosts genres the user favors now. */
    habit?: HabitContext;
}

/** Score all candidates, exclude watched, return top N lightly shuffled. */
export function buildRecommendations(input: BuildInput): Recommendation[] {
    const {
        seeds, movies, series, excludeTitles,
        excludeMovieIds, excludeSeriesIds,
        maxItems = 20, rng = Math.random, habit
    } = input;

    if (seeds.length === 0) return [];

    const seedTitles = new Set(seeds.map(s => normalizeTitle(s.name)));
    const scored: Recommendation[] = [];

    const consider = (kind: 'vod' | 'series', item: RecMovie | RecSeries, id: string, excludedIds: Set<string>) => {
        if (excludedIds.has(id)) return;
        const normalized = normalizeTitle(item.name);
        if (normalized.length === 0 || excludeTitles.has(normalized) || seedTitles.has(normalized)) return;
        const result = scoreCandidate(item, seeds);
        if (result) {
            // Gentle habit multiplier: up to +60% for genres the user actually
            // watches on this weekday / time of day. Never demotes below base.
            let score = result.score;
            if (habit) {
                const boost = habitBoost(splitGenres(item.genre), habit.profile, habit.weekday, habit.hourBucket);
                score *= 1 + 0.6 * boost;
            }
            scored.push({ kind, item, becauseOf: result.becauseOf, score });
        }
    };

    for (const movie of movies) consider('vod', movie, String(movie.stream_id), excludeMovieIds);
    for (const s of series) consider('series', s, String(s.series_id), excludeSeriesIds);

    // Keep a generous pool, shuffle within bands, then cut to maxItems.
    const pool = scored.sort((a, b) => b.score - a.score).slice(0, maxItems * 3);
    return bandedShuffle(pool, rng).slice(0, maxItems);
}

/**
 * Group recommendations by their dominant seed for row titles.
 * Returns up to `maxGroups` groups (largest first), each preserving the
 * incoming (band-shuffled) item order. Groups with fewer than `minGroupSize`
 * items are dropped.
 */
export function groupBySeed(
    recommendations: Recommendation[],
    maxGroups: number = 2,
    minGroupSize: number = 3
): RecommendationGroup[] {
    const bySeed = new Map<string, Recommendation[]>();
    for (const rec of recommendations) {
        if (!bySeed.has(rec.becauseOf)) bySeed.set(rec.becauseOf, []);
        bySeed.get(rec.becauseOf)!.push(rec);
    }

    return [...bySeed.entries()]
        .filter(([, items]) => items.length >= minGroupSize)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, maxGroups)
        .map(([seedName, items]) => ({ seedName, items }));
}

// ==================== History → seeds (local reads) ====================

interface RawSeed {
    kind: 'vod' | 'series';
    name: string;
    watchedAt: number;
    categoryId?: string;
}

const MAX_SEEDS = 10;
const MAX_TMDB_LOOKUPS = 3;

function collectRawSeeds(movies: RecMovie[], series: RecSeries[]): {
    seeds: RawSeed[];
    watchedTitles: Set<string>;
    watchedMovieIds: Set<string>;
    watchedSeriesIds: Set<string>;
} {
    const watchedTitles = new Set<string>();
    const watchedMovieIds = new Set<string>();
    const watchedSeriesIds = new Set<string>();
    const raw: RawSeed[] = [];

    const movieById = new Map(movies.map(m => [String(m.stream_id), m]));
    const seriesById = new Map(series.map(s => [String(s.series_id), s]));

    for (const entry of movieProgressService.getHistory()) {
        watchedMovieIds.add(entry.movieId);
        const item = movieById.get(entry.movieId);
        const name = item?.name || entry.movieName;
        if (!name) continue;
        watchedTitles.add(normalizeTitle(name));
        raw.push({ kind: 'vod', name, watchedAt: entry.watchedAt, categoryId: item?.category_id });
    }

    // Episode history: keep the most recent timestamp per series.
    const latestBySeries = new Map<string, number>();
    for (const ep of watchProgressService.getEpisodeHistory()) {
        const prev = latestBySeries.get(ep.seriesId) || 0;
        if (ep.watchedAt > prev) latestBySeries.set(ep.seriesId, ep.watchedAt);
    }
    latestBySeries.forEach((watchedAt, seriesId) => {
        watchedSeriesIds.add(seriesId);
        const item = seriesById.get(seriesId);
        if (!item) return;
        watchedTitles.add(normalizeTitle(item.name));
        raw.push({ kind: 'series', name: item.name, watchedAt, categoryId: item.category_id });
    });

    // Most recent first, dedupe by normalized title, cap.
    raw.sort((a, b) => b.watchedAt - a.watchedAt);
    const seen = new Set<string>();
    const seeds: RawSeed[] = [];
    for (const seed of raw) {
        const key = normalizeTitle(seed.name);
        if (key.length === 0 || seen.has(key)) continue;
        seen.add(key);
        seeds.push(seed);
        if (seeds.length >= MAX_SEEDS) break;
    }

    return { seeds, watchedTitles, watchedMovieIds, watchedSeriesIds };
}

async function resolveSeedGenres(rawSeeds: RawSeed[]): Promise<RecSeed[]> {
    // 1) Local IndexedDB cache (populated by the parental/kids TMDB checks).
    const seeds: RecSeed[] = await Promise.all(rawSeeds.map(async (raw, index) => {
        const cached = raw.kind === 'vod'
            ? await indexedDBCache.getCachedMovie(raw.name)
            : await indexedDBCache.getCachedSeries(raw.name);
        return {
            kind: raw.kind,
            name: raw.name,
            recencyRank: index,
            genres: cached?.genres?.filter(g => !!g) || [],
            categoryId: raw.categoryId
        };
    }));

    // 2) Up to 3 TMDB lookups for the most recent seeds with no cached genres.
    let lookups = 0;
    for (const seed of seeds) {
        if (seed.genres.length > 0) continue;
        if (lookups >= MAX_TMDB_LOOKUPS) break;
        lookups++;
        try {
            const result = seed.kind === 'vod'
                ? await searchMovieByName(seed.name)
                : await searchSeriesByName(seed.name);
            if (result?.genres?.length) {
                seed.genres = result.genres.map(g => g.name);
                // Fire-and-forget cache so next visit is free.
                const cacheCall = seed.kind === 'vod'
                    ? indexedDBCache.setCacheMovie(seed.name, result.certification ?? null, seed.genres)
                    : indexedDBCache.setCacheSeries(seed.name, result.certification ?? null, seed.genres);
                void cacheCall.catch(() => { /* best effort */ });
            }
        } catch {
            // Network failure is fine — category/franchise signals still work.
        }
    }

    return seeds;
}

// ==================== Public entry point ====================

/**
 * Compute up to 2 "Porque você assistiu {seed}" groups for the Home page.
 * Returns [] when there is no history or nothing matches.
 */
export async function getHomeRecommendations(
    movies: RecMovie[],
    series: RecSeries[]
): Promise<RecommendationGroup[]> {
    const { seeds: rawSeeds, watchedTitles, watchedMovieIds, watchedSeriesIds } =
        collectRawSeeds(movies, series);

    if (rawSeeds.length === 0) return [];

    const seeds = await resolveSeedGenres(rawSeeds);

    // Habit context: what this profile actually watches on this weekday /
    // time of day (per-profile sessions from usageStatsService).
    const now = new Date();
    const habitProfile = buildHabitProfile(usageStatsService.getStats().sessionsThisMonth, splitGenres);

    const recommendations = buildRecommendations({
        seeds,
        movies,
        series,
        excludeTitles: watchedTitles,
        // 🚫 Item 35: títulos banidos pelo usuário nunca voltam a ser sugeridos.
        excludeMovieIds: new Set([...watchedMovieIds, ...blockedRecommendationsService.getBlockedIds('movie')]),
        excludeSeriesIds: new Set([...watchedSeriesIds, ...blockedRecommendationsService.getBlockedIds('series')]),
        maxItems: 40, // generous pool so each group can still show up to 20
        habit: {
            profile: habitProfile,
            weekday: now.getDay(),
            hourBucket: hourBucketOf(now.getHours())
        }
    });

    return groupBySeed(recommendations, 2, 3).map(group => ({
        seedName: group.seedName,
        items: group.items.slice(0, 20)
    }));
}
