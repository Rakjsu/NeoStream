/**
 * Habit profile: aggregates the per-profile watch sessions (usageStatsService)
 * into "what genres does this user favor on this weekday / time of day".
 * The recommendation scorer uses it as a gentle multiplier so rows lean
 * toward the user's actual viewing habits.
 *
 * Pure functions — the genre splitter is injected to avoid a circular import
 * with recommendationService.
 */

import type { WatchSession } from './usageStatsService';

export type HourBucket = 'morning' | 'afternoon' | 'evening' | 'night';

export type GenreSplitter = (genre: string | undefined | null) => string[];

export function hourBucketOf(hour: number): HourBucket {
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18) return 'evening';
    return 'night';
}

export interface HabitProfile {
    /** 0=Sunday..6=Saturday → genre → seconds */
    weekdayGenres: Array<Map<string, number>>;
    weekdayTotals: number[];
    /** hour bucket → genre → seconds (only sessions that recorded a bucket) */
    bucketGenres: Record<HourBucket, Map<string, number>>;
    bucketTotals: Record<HourBucket, number>;
}

function emptyProfile(): HabitProfile {
    const buckets = () => ({
        morning: new Map<string, number>(),
        afternoon: new Map<string, number>(),
        evening: new Map<string, number>(),
        night: new Map<string, number>()
    });
    return {
        weekdayGenres: Array.from({ length: 7 }, () => new Map()),
        weekdayTotals: [0, 0, 0, 0, 0, 0, 0],
        bucketGenres: buckets(),
        bucketTotals: { morning: 0, afternoon: 0, evening: 0, night: 0 }
    };
}

const bump = (map: Map<string, number>, key: string, seconds: number) =>
    map.set(key, (map.get(key) || 0) + seconds);

/** Aggregate sessions (skipping the ones without genre) into a habit profile. */
export function buildHabitProfile(sessions: WatchSession[], splitGenres: GenreSplitter): HabitProfile {
    const profile = emptyProfile();

    for (const session of sessions) {
        const genres = splitGenres(session.genre);
        if (genres.length === 0 || session.watchedSeconds <= 0) continue;

        const weekday = new Date(session.date + 'T12:00:00').getDay();
        profile.weekdayTotals[weekday] += session.watchedSeconds;
        for (const genre of genres) {
            bump(profile.weekdayGenres[weekday], genre, session.watchedSeconds);
        }

        if (session.hourBucket) {
            profile.bucketTotals[session.hourBucket] += session.watchedSeconds;
            for (const genre of genres) {
                bump(profile.bucketGenres[session.hourBucket], genre, session.watchedSeconds);
            }
        }
    }

    return profile;
}

/**
 * How strongly the candidate's genres match what the user watches on this
 * weekday (60%) and at this time of day (40%). Returns 0..1; terms without
 * data contribute 0, so a fresh profile never distorts the base score.
 */
export function habitBoost(
    candidateGenres: string[],
    profile: HabitProfile,
    weekday: number,
    bucket: HourBucket
): number {
    if (candidateGenres.length === 0) return 0;

    const shareOf = (genreMap: Map<string, number>, total: number): number => {
        if (total <= 0) return 0;
        let best = 0;
        for (const genre of candidateGenres) {
            best = Math.max(best, genreMap.get(genre) || 0);
        }
        return best / total;
    };

    const weekdayShare = shareOf(profile.weekdayGenres[weekday] || new Map(), profile.weekdayTotals[weekday] || 0);
    const bucketShare = shareOf(profile.bucketGenres[bucket], profile.bucketTotals[bucket]);

    return 0.6 * weekdayShare + 0.4 * bucketShare;
}
