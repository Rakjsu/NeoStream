import { describe, it, expect, beforeEach } from 'vitest';
import { listParentalLog, logParentalEvent, clearParentalLog } from './parentalLogService';

describe('parentalLogService', () => {
    beforeEach(() => localStorage.clear());

    it('registra com o mais novo no topo e limpa', () => {
        logParentalEvent('pin_fail', 'PIN parental');
        logParentalEvent('pin_ok', 'PIN do perfil Ana');
        const entries = listParentalLog();
        expect(entries).toHaveLength(2);
        expect(entries[0].kind).toBe('pin_ok');
        expect(entries[1].detail).toBe('PIN parental');
        expect(entries[0].ts).toBeGreaterThan(0);

        clearParentalLog();
        expect(listParentalLog()).toHaveLength(0);
    });

    it('respeita o teto de 200 entradas', () => {
        for (let i = 0; i < 205; i++) logParentalEvent('pin_ok', `evento ${i}`);
        const entries = listParentalLog();
        expect(entries).toHaveLength(200);
        expect(entries[0].detail).toBe('evento 204');
    });

    it('detalhe é truncado e storage corrompido vira lista vazia', () => {
        logParentalEvent('pin_fail', 'x'.repeat(200));
        expect(listParentalLog()[0].detail).toHaveLength(80);

        localStorage.setItem('neostream_parental_log', '{quebrado');
        expect(listParentalLog()).toEqual([]);
    });
});
