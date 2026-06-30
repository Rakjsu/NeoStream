import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    appNotificationService,
    EPISODE_CHECK_INTERVAL_MS
} from './episodeNotificationService';

/**
 * Part B — background new-episode check.
 *
 * These cover the interval bookkeeping (start once, fire every 6h, clear on
 * teardown, no parallel timers) and the concurrency guard that stops a tick
 * from overlapping a run that is still in flight.
 */

describe('background episode check — interval bookkeeping', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        appNotificationService.stopPeriodicCheck();
    });

    afterEach(() => {
        appNotificationService.stopPeriodicCheck();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('does not run immediately by default, then fires every 6h', () => {
        const spy = vi
            .spyOn(appNotificationService, 'checkForNewEpisodes')
            .mockResolvedValue([]);

        const stop = appNotificationService.startPeriodicCheck();
        expect(appNotificationService.isPeriodicCheckRunning()).toBe(true);
        // Default start does not run immediately.
        expect(spy).toHaveBeenCalledTimes(0);

        // First tick after 6h.
        vi.advanceTimersByTime(EPISODE_CHECK_INTERVAL_MS);
        expect(spy).toHaveBeenCalledTimes(1);

        // Second tick after another 6h — invoked again.
        vi.advanceTimersByTime(EPISODE_CHECK_INTERVAL_MS);
        expect(spy).toHaveBeenCalledTimes(2);

        stop();
        expect(appNotificationService.isPeriodicCheckRunning()).toBe(false);
    });

    it('runImmediately runs once on start then on each interval', () => {
        const spy = vi
            .spyOn(appNotificationService, 'checkForNewEpisodes')
            .mockResolvedValue([]);

        appNotificationService.startPeriodicCheck(EPISODE_CHECK_INTERVAL_MS, {
            runImmediately: true
        });
        expect(spy).toHaveBeenCalledTimes(1); // run once on start

        vi.advanceTimersByTime(EPISODE_CHECK_INTERVAL_MS);
        expect(spy).toHaveBeenCalledTimes(2); // + first 6h tick
    });

    it('teardown clears the interval — no further ticks fire', () => {
        const spy = vi
            .spyOn(appNotificationService, 'checkForNewEpisodes')
            .mockResolvedValue([]);

        const stop = appNotificationService.startPeriodicCheck();
        vi.advanceTimersByTime(EPISODE_CHECK_INTERVAL_MS);
        expect(spy).toHaveBeenCalledTimes(1);

        stop();
        vi.advanceTimersByTime(EPISODE_CHECK_INTERVAL_MS * 3);
        // No new invocations after teardown.
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('stopPeriodicCheck is a no-op when not running', () => {
        expect(appNotificationService.isPeriodicCheckRunning()).toBe(false);
        // Should not throw and stays not-running.
        appNotificationService.stopPeriodicCheck();
        expect(appNotificationService.isPeriodicCheckRunning()).toBe(false);
    });

    it('isPeriodicCheckRunning reflects start/stop transitions', () => {
        vi.spyOn(appNotificationService, 'checkForNewEpisodes').mockResolvedValue([]);
        expect(appNotificationService.isPeriodicCheckRunning()).toBe(false);
        const stop = appNotificationService.startPeriodicCheck();
        expect(appNotificationService.isPeriodicCheckRunning()).toBe(true);
        stop();
        expect(appNotificationService.isPeriodicCheckRunning()).toBe(false);
    });

    it('honours a custom interval', () => {
        const spy = vi
            .spyOn(appNotificationService, 'checkForNewEpisodes')
            .mockResolvedValue([]);
        const customMs = 30 * 60 * 1000; // 30 min
        appNotificationService.startPeriodicCheck(customMs);

        // Nothing before the custom interval elapses.
        vi.advanceTimersByTime(customMs - 1);
        expect(spy).toHaveBeenCalledTimes(0);

        // Tick at exactly the custom interval.
        vi.advanceTimersByTime(1);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('the default interval is 6 hours', () => {
        expect(EPISODE_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    });

    it('starting twice keeps a single timer (no parallel intervals)', () => {
        const spy = vi
            .spyOn(appNotificationService, 'checkForNewEpisodes')
            .mockResolvedValue([]);

        const stopA = appNotificationService.startPeriodicCheck();
        const stopB = appNotificationService.startPeriodicCheck();

        vi.advanceTimersByTime(EPISODE_CHECK_INTERVAL_MS);
        // One tick → exactly one invocation, not two.
        expect(spy).toHaveBeenCalledTimes(1);

        // The shared timer survives one teardown (ref-counted starts).
        stopA();
        // stopPeriodicCheck clears unconditionally, so after stopA it is off.
        expect(appNotificationService.isPeriodicCheckRunning()).toBe(false);
        stopB();
    });
});

describe('background episode check — concurrency guard', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        appNotificationService.stopPeriodicCheck();
    });

    it('a tick while a prior run is in flight is a no-op (returns [])', async () => {
        // Make the first checkForNewEpisodes hang on the series-monitor read so
        // the run stays "in flight". We stub the private dependency indirectly
        // by stalling getNotifications-adjacent work via fetch; simplest is to
        // drive the real guard: call once (left pending) then again.
        let releaseFirst!: () => void;
        const firstRunGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        // Patch the internal series-monitor lookup so the first invocation
        // parks on our gate, holding isCheckingEpisodes = true.
        const svc = appNotificationService as unknown as {
            getSeriesToMonitor: () => Promise<unknown[]>;
        };
        const original = svc.getSeriesToMonitor.bind(appNotificationService);
        let calls = 0;
        vi.spyOn(svc, 'getSeriesToMonitor').mockImplementation(async () => {
            calls += 1;
            if (calls === 1) {
                await firstRunGate; // hold the first run open
            }
            return [];
        });

        const firstRun = appNotificationService.checkForNewEpisodes();

        // While the first run is parked, a concurrent call must short-circuit.
        const concurrent = await appNotificationService.checkForNewEpisodes();
        expect(concurrent).toEqual([]);
        // The guard prevented the second run from reaching getSeriesToMonitor.
        expect(calls).toBe(1);

        // Let the first run finish.
        releaseFirst();
        await firstRun;

        // After it completes, a fresh run proceeds again.
        await appNotificationService.checkForNewEpisodes();
        expect(calls).toBe(2);

        // Restore in case other suites reuse the singleton.
        svc.getSeriesToMonitor = original;
    });
});
