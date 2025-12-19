/**
 * Usage Stats Service
 * Tracks watch time, viewing habits, and provides statistics per profile
 */

import { profileService } from './profileService';

export interface WatchSession {
    contentId: string;
    contentType: 'movie' | 'series' | 'live';
    contentName: string;
    watchedSeconds: number;
    date: string; // YYYY-MM-DD
    genre?: string;
}

export interface DailyStats {
    date: string;
    totalSeconds: number;
    movies: number;
    series: number;
    live: number;
}

export interface UsageStats {
    totalWatchTimeSeconds: number;
    totalWatchTimeThisMonth: number;
    sessionsThisMonth: WatchSession[];
    contentBreakdown: { movies: number; series: number; live: number };
    watchStreak: number;
    longestStreak: number;
    dailyStats: DailyStats[];
    lastWatchDate: string | null;
}

class UsageStatsService {
    private readonly STORAGE_KEY_PREFIX = 'usage_stats';
    private currentSession: {
        contentId: string;
        contentType: 'movie' | 'series' | 'live';
        contentName: string;
        genre?: string;
        startTime: number;
        accumulatedSeconds: number;
    } | null = null;

    private updateInterval: ReturnType<typeof setInterval> | null = null;

    // Get storage key for current profile
    private getStorageKey(): string {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return `${this.STORAGE_KEY_PREFIX}_default`;
        return `${this.STORAGE_KEY_PREFIX}_${activeProfile.id}`;
    }

    // Get today's date as YYYY-MM-DD
    private getToday(): string {
        return new Date().toISOString().split('T')[0];
    }

    // Get current month as YYYY-MM
    private getCurrentMonth(): string {
        return new Date().toISOString().slice(0, 7);
    }

    // Load stats from storage
    private loadStats(): UsageStats {
        try {
            const key = this.getStorageKey();
            const data = localStorage.getItem(key);
            if (!data) return this.getEmptyStats();
            return JSON.parse(data);
        } catch {
            return this.getEmptyStats();
        }
    }

    // Save stats to storage
    private saveStats(stats: UsageStats): void {
        const key = this.getStorageKey();
        localStorage.setItem(key, JSON.stringify(stats));
    }

    // Get empty stats object
    private getEmptyStats(): UsageStats {
        return {
            totalWatchTimeSeconds: 0,
            totalWatchTimeThisMonth: 0,
            sessionsThisMonth: [],
            contentBreakdown: { movies: 0, series: 0, live: 0 },
            watchStreak: 0,
            longestStreak: 0,
            dailyStats: [],
            lastWatchDate: null
        };
    }

    // Start a watch session
    startSession(
        contentId: string,
        contentType: 'movie' | 'series' | 'live',
        contentName: string,
        genre?: string
    ): void {
        // End any existing session first
        if (this.currentSession) {
            this.endSession();
        }

        this.currentSession = {
            contentId,
            contentType,
            contentName,
            genre,
            startTime: Date.now(),
            accumulatedSeconds: 0
        };

        // Update every 30 seconds to track time even if app closes unexpectedly
        this.updateInterval = setInterval(() => {
            this.saveCurrentProgress();
        }, 30000);

            }

    // Save current progress without ending session
    private saveCurrentProgress(): void {
        if (!this.currentSession) return;

        const now = Date.now();
        const sessionSeconds = Math.floor((now - this.currentSession.startTime) / 1000);
        const newSeconds = sessionSeconds - this.currentSession.accumulatedSeconds;

        if (newSeconds > 0) {
            this.addWatchTime(
                this.currentSession.contentId,
                this.currentSession.contentType,
                this.currentSession.contentName,
                newSeconds,
                this.currentSession.genre
            );
            this.currentSession.accumulatedSeconds = sessionSeconds;
        }
    }

    // End current session
    endSession(): void {
        if (!this.currentSession) return;

        // Clear the update interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Save any remaining time
        const now = Date.now();
        const sessionSeconds = Math.floor((now - this.currentSession.startTime) / 1000);
        const remainingSeconds = sessionSeconds - this.currentSession.accumulatedSeconds;

        if (remainingSeconds > 0) {
            this.addWatchTime(
                this.currentSession.contentId,
                this.currentSession.contentType,
                this.currentSession.contentName,
                remainingSeconds,
                this.currentSession.genre
            );
        }

                this.currentSession = null;
    }

    // Add watch time to stats
    private addWatchTime(
        contentId: string,
        contentType: 'movie' | 'series' | 'live',
        contentName: string,
        seconds: number,
        genre?: string
    ): void {
        const stats = this.loadStats();
        const today = this.getToday();
        const currentMonth = this.getCurrentMonth();

        // Update total time
        stats.totalWatchTimeSeconds += seconds;

        // Update content breakdown
        if (contentType === 'movie') {
            stats.contentBreakdown.movies += seconds;
        } else if (contentType === 'series') {
            stats.contentBreakdown.series += seconds;
        } else {
            stats.contentBreakdown.live += seconds;
        }

        // Update daily stats
        let todayStats = stats.dailyStats.find(d => d.date === today);
        if (!todayStats) {
            todayStats = { date: today, totalSeconds: 0, movies: 0, series: 0, live: 0 };
            stats.dailyStats.push(todayStats);
        }
        todayStats.totalSeconds += seconds;
        if (contentType === 'movie') todayStats.movies += seconds;
        else if (contentType === 'series') todayStats.series += seconds;
        else todayStats.live += seconds;

        // Update monthly stats
        if (today.startsWith(currentMonth)) {
            stats.totalWatchTimeThisMonth += seconds;

            // Add/update session for this month
            const existingSession = stats.sessionsThisMonth.find(
                s => s.contentId === contentId && s.date === today
            );
            if (existingSession) {
                existingSession.watchedSeconds += seconds;
            } else {
                stats.sessionsThisMonth.push({
                    contentId,
                    contentType,
                    contentName,
                    watchedSeconds: seconds,
                    date: today,
                    genre
                });
            }
        }

        // Update watch streak
        this.updateStreak(stats, today);

        // Keep only last 90 days of daily stats
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const cutoffDate = ninetyDaysAgo.toISOString().split('T')[0];
        stats.dailyStats = stats.dailyStats.filter(d => d.date >= cutoffDate);

        // Keep only current month sessions
        stats.sessionsThisMonth = stats.sessionsThisMonth.filter(
            s => s.date.startsWith(currentMonth)
        );

        this.saveStats(stats);
    }

    // Update watch streak
    private updateStreak(stats: UsageStats, today: string): void {
        if (stats.lastWatchDate === today) {
            // Already watched today, no change to streak
            return;
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (stats.lastWatchDate === yesterdayStr) {
            // Watched yesterday, extend streak
            stats.watchStreak += 1;
        } else if (stats.lastWatchDate !== today) {
            // Streak broken, reset to 1
            stats.watchStreak = 1;
        }

        stats.lastWatchDate = today;

        // Update longest streak
        if (stats.watchStreak > stats.longestStreak) {
            stats.longestStreak = stats.watchStreak;
        }
    }

    // Get all stats
    getStats(): UsageStats {
        return this.loadStats();
    }

    // Get stats for the last 7 days
    getWeeklyStats(): DailyStats[] {
        const stats = this.loadStats();
        const result: DailyStats[] = [];

        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            const dayStats = stats.dailyStats.find(d => d.date === dateStr);
            result.push(dayStats || {
                date: dateStr,
                totalSeconds: 0,
                movies: 0,
                series: 0,
                live: 0
            });
        }

        return result;
    }

    // Format seconds to readable time
    formatTime(seconds: number): { hours: number; minutes: number; formatted: string } {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (hours > 0) {
            return { hours, minutes, formatted: `${hours}h ${minutes}min` };
        }
        return { hours: 0, minutes, formatted: `${minutes}min` };
    }

    // Get most watched content type
    getMostWatchedType(): 'movies' | 'series' | 'live' | null {
        const stats = this.loadStats();
        const breakdown = stats.contentBreakdown;

        if (breakdown.movies === 0 && breakdown.series === 0 && breakdown.live === 0) {
            return null;
        }

        if (breakdown.movies >= breakdown.series && breakdown.movies >= breakdown.live) {
            return 'movies';
        }
        if (breakdown.series >= breakdown.live) {
            return 'series';
        }
        return 'live';
    }

    // Clear all stats (for testing/debug)
    clearStats(): void {
        const key = this.getStorageKey();
        localStorage.removeItem(key);
    }
}

export const usageStatsService = new UsageStatsService();
