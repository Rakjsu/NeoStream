import { describe, it, expect } from 'vitest';
import { formatSleepCountdown, SLEEP_TIMER_OPTIONS } from './useSleepTimer';

describe('formatSleepCountdown', () => {
    it('formata m:ss abaixo de uma hora', () => {
        expect(formatSleepCountdown(0)).toBe('0:00');
        expect(formatSleepCountdown(59)).toBe('0:59');
        expect(formatSleepCountdown(60)).toBe('1:00');
        expect(formatSleepCountdown(1799)).toBe('29:59');
    });

    it('formata h:mm:ss a partir de uma hora', () => {
        expect(formatSleepCountdown(3600)).toBe('1:00:00');
        expect(formatSleepCountdown(5400)).toBe('1:30:00');
        expect(formatSleepCountdown(5399)).toBe('1:29:59');
    });

    it('não quebra com valores negativos ou fracionados', () => {
        expect(formatSleepCountdown(-5)).toBe('0:00');
        expect(formatSleepCountdown(90.7)).toBe('1:30');
    });
});

describe('SLEEP_TIMER_OPTIONS', () => {
    it('oferece 30, 60 e 90 minutos', () => {
        expect([...SLEEP_TIMER_OPTIONS]).toEqual([30, 60, 90]);
    });
});
