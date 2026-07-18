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

describe('limite por perfil (D65)', () => {
    it('o específico do perfil vence; kids sem específico herda o global', async () => {
        const { setProfileDailyLimitMinutes, setKidsDailyLimitMinutes, effectiveDailyLimitMinutes } =
            await import('./watchLimitsService')
        localStorage.clear()
        setKidsDailyLimitMinutes(60)
        expect(effectiveDailyLimitMinutes('p1', true)).toBe(60)
        expect(effectiveDailyLimitMinutes('p1', false)).toBe(0)
        setProfileDailyLimitMinutes('p1', 120)
        expect(effectiveDailyLimitMinutes('p1', true)).toBe(120)
        expect(effectiveDailyLimitMinutes('p1', false)).toBe(120)
        setProfileDailyLimitMinutes('p1', 0)
        expect(effectiveDailyLimitMinutes('p1', false)).toBe(0)
    })
})

describe('janelas de horário (D65)', () => {
    it('isHourWithinWindow cobre janela normal e a que vira a meia-noite', async () => {
        const { isHourWithinWindow } = await import('./watchLimitsService')
        expect(isHourWithinWindow(10, { start: 6, end: 20 })).toBe(true)
        expect(isHourWithinWindow(6, { start: 6, end: 20 })).toBe(true)
        expect(isHourWithinWindow(20, { start: 6, end: 20 })).toBe(false)
        expect(isHourWithinWindow(23, { start: 20, end: 6 })).toBe(true)
        expect(isHourWithinWindow(3, { start: 20, end: 6 })).toBe(true)
        expect(isHourWithinWindow(12, { start: 20, end: 6 })).toBe(false)
    })

    it('persistência valida o formato e rejeita lixo', async () => {
        const { setKidsAllowedHours, getKidsAllowedHours } = await import('./watchLimitsService')
        localStorage.clear()
        expect(getKidsAllowedHours()).toBeNull()
        setKidsAllowedHours({ start: 6, end: 20 })
        expect(getKidsAllowedHours()).toEqual({ start: 6, end: 20 })
        localStorage.setItem('neostream_kids_allowed_hours', '99-5')
        expect(getKidsAllowedHours()).toBeNull()
        setKidsAllowedHours(null)
        expect(localStorage.getItem('neostream_kids_allowed_hours')).toBeNull()
    })
})
