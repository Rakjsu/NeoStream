import { beforeEach, describe, expect, it } from 'vitest';
import {
    getDailyGoalMinutes,
    getKidsDailyLimitMinutes,
    goalProgressPct,
    isLimitExceeded,
    setDailyGoalMinutes,
    setKidsDailyLimitMinutes
} from './watchLimitsService';

describe('watchLimitsService (limite infantil + meta diária)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('persiste e limpa o limite infantil e a meta diária', () => {
        expect(getKidsDailyLimitMinutes()).toBe(0);
        setKidsDailyLimitMinutes(60);
        expect(getKidsDailyLimitMinutes()).toBe(60);
        setKidsDailyLimitMinutes(0);
        expect(getKidsDailyLimitMinutes()).toBe(0);

        setDailyGoalMinutes(120);
        expect(getDailyGoalMinutes()).toBe(120);
        setDailyGoalMinutes(-5);
        expect(getDailyGoalMinutes()).toBe(0);
    });

    it('isLimitExceeded: só dispara com limite ligado e tempo estourado', () => {
        expect(isLimitExceeded(999999, 0)).toBe(false);
        expect(isLimitExceeded(3599, 60)).toBe(false);
        expect(isLimitExceeded(3600, 60)).toBe(true);
    });

    it('goalProgressPct: arredonda e trava em 100', () => {
        expect(goalProgressPct(1800, 60)).toBe(50);
        expect(goalProgressPct(7200, 60)).toBe(100);
        expect(goalProgressPct(0, 60)).toBe(0);
        expect(goalProgressPct(1000, 0)).toBe(0);
    });
});
