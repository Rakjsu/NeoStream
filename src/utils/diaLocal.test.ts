import { describe, expect, it } from 'vitest';
import { diaLocal, mesLocal } from './diaLocal';

// O vitest.config.ts fixa TZ=America/Sao_Paulo (UTC−3). Sem fuso fixo este
// arquivo seria vazio numa máquina em UTC — e é justamente o desencontro entre
// a máquina de quem escreve e a de quem roda que escondia o defeito.

describe('diaLocal', () => {
    it('sábado 22h em SP é sábado, mesmo já sendo domingo em Greenwich', () => {
        // 2026-07-05T01:00Z = sáb 04/07 22h em São Paulo. O `toISOString()`
        // dizia "2026-07-05" e jogava a noite de sábado no domingo.
        expect(diaLocal(new Date('2026-07-05T01:00:00Z'))).toBe('2026-07-04');
    });

    it('domingo 20h em SP continua sendo domingo', () => {
        expect(diaLocal(new Date('2026-07-05T23:00:00Z'))).toBe('2026-07-05');
    });

    it('zero à esquerda no mês e no dia', () => {
        expect(diaLocal(new Date('2026-03-09T15:00:00Z'))).toBe('2026-03-09');
    });

    it('mesLocal vira no dia certo: 31/07 às 22h ainda é julho', () => {
        // 2026-08-01T01:00Z = 31/07 22h em SP — o mês fechava um dia cedo.
        expect(mesLocal(new Date('2026-08-01T01:00:00Z'))).toBe('2026-07');
    });
});
