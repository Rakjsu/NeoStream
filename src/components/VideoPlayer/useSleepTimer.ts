import { useCallback, useEffect, useRef, useState } from 'react';

export const SLEEP_TIMER_OPTIONS = [30, 60, 90] as const;

/**
 * Formats the sleep-timer countdown as m:ss (or h:mm:ss above one hour).
 * Pure so it can be unit-tested.
 */
export function formatSleepCountdown(totalSeconds: number): string {
    const clamped = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(clamped / 3600);
    const minutes = Math.floor((clamped % 3600) / 60);
    const seconds = clamped % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface SleepTimerState {
    deadline: number;
    minutes: number;
}

/**
 * Sleep timer for the player: start(30|60|90) arms a countdown; when it
 * reaches zero, onExpire fires (the player pauses) and the timer disarms.
 */
export function useSleepTimer(onExpire: () => void) {
    const [timer, setTimer] = useState<SleepTimerState | null>(null);
    const [remainingSeconds, setRemainingSeconds] = useState(0);

    // Keep the latest callback without re-arming the interval.
    const onExpireRef = useRef(onExpire);
    useEffect(() => {
        onExpireRef.current = onExpire;
    }, [onExpire]);

    const start = useCallback((minutes: number) => {
        setTimer({ deadline: Date.now() + minutes * 60_000, minutes });
        setRemainingSeconds(minutes * 60);
    }, []);

    const cancel = useCallback(() => {
        setTimer(null);
        setRemainingSeconds(0);
    }, []);

    useEffect(() => {
        if (!timer) return;
        const interval = window.setInterval(() => {
            const left = Math.max(0, Math.round((timer.deadline - Date.now()) / 1000));
            setRemainingSeconds(left);
            if (left <= 0) {
                setTimer(null);
                onExpireRef.current();
            }
        }, 1000);
        return () => window.clearInterval(interval);
    }, [timer]);

    return {
        active: timer !== null,
        selectedMinutes: timer?.minutes ?? null,
        remainingSeconds,
        start,
        cancel
    };
}
