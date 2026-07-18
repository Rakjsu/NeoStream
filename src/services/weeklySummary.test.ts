import { describe, it, expect } from 'vitest';
import { weekKey, shouldNotifyWeekly } from './weeklySummary';

describe('weeklySummary — helpers puros', () => {
    it('weekKey é estável dentro da mesma semana e vira na segunda-feira', () => {
        // 2026-07-13 é segunda; 2026-07-19 é domingo da mesma semana ISO.
        expect(weekKey(new Date(2026, 6, 13))).toBe(weekKey(new Date(2026, 6, 19)));
        // Domingo 12/07 pertence à semana anterior.
        expect(weekKey(new Date(2026, 6, 12))).not.toBe(weekKey(new Date(2026, 6, 13)));
        expect(weekKey(new Date(2026, 6, 13))).toMatch(/^2026-W\d{2}$/);
    });

    it('weekKey trata a virada de ano (semana 1 ISO)', () => {
        // 2026-01-01 é quinta → semana 1 de 2026.
        expect(weekKey(new Date(2026, 0, 1))).toBe('2026-W01');
        // 2027-01-01 é sexta → ainda semana 53 de 2026 no padrão ISO.
        expect(weekKey(new Date(2027, 0, 1))).toBe('2026-W53');
    });

    it('shouldNotifyWeekly: 1x por semana e só com uso', () => {
        const monday = new Date(2026, 6, 13);
        expect(shouldNotifyWeekly(monday, null, 3600)).toBe(true);
        expect(shouldNotifyWeekly(monday, weekKey(monday), 3600)).toBe(false);
        expect(shouldNotifyWeekly(monday, '2026-W01', 3600)).toBe(true);
        expect(shouldNotifyWeekly(monday, null, 0)).toBe(false);
    });
});
