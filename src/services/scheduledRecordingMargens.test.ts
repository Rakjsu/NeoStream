import { describe, it, expect, beforeEach } from 'vitest';
import {
    margemInicialMs, folgaFinalMs, janelaGravacao,
    START_MARGIN_MS, END_PADDING_MS, MARGEM_MAXIMA_MIN,
} from './scheduledRecordingService';

/**
 * As margens da gravação eram constantes: só mudavam recompilando. E o limite
 * de gravações simultâneas era uma chave de localStorage que NENHUM código de
 * produção escrevia — enquanto o aviso de conflito da Agenda dizia, em
 * produção, "ajuste o limite ou cancele uma". O app pedia para ajustar algo que
 * não existia na interface.
 */
describe('margens configuráveis da gravação', () => {
    beforeEach(() => localStorage.clear());

    // O par que expõe a armadilha: `Number(null)` é 0 e passa em qualquer
    // checagem de finitude. Convertendo antes de olhar a string crua, "nunca
    // configurei" viraria "configurei zero" — e todo mundo perderia as margens
    // em silêncio, na primeira gravação depois de atualizar.
    it('chave AUSENTE devolve o padrão', () => {
        expect(margemInicialMs()).toBe(START_MARGIN_MS);
        expect(folgaFinalMs()).toBe(END_PADDING_MS);
    });

    it('chave gravada com ZERO é respeitada — zero é escolha', () => {
        localStorage.setItem('neostream_dvr_start_margin_min', '0');
        localStorage.setItem('neostream_dvr_end_padding_min', '0');
        expect(margemInicialMs()).toBe(0);
        expect(folgaFinalMs()).toBe(0);
    });

    it('string vazia conta como ausente', () => {
        localStorage.setItem('neostream_dvr_start_margin_min', '   ');
        expect(margemInicialMs()).toBe(START_MARGIN_MS);
    });

    it('minutos viram milissegundos', () => {
        localStorage.setItem('neostream_dvr_start_margin_min', '5');
        expect(margemInicialMs()).toBe(5 * 60 * 1000);
    });

    it('valor absurdo é preso no teto, não descartado', () => {
        localStorage.setItem('neostream_dvr_end_padding_min', '9999');
        expect(folgaFinalMs()).toBe(MARGEM_MAXIMA_MIN * 60 * 1000);
    });

    it('lixo e negativo caem no padrão', () => {
        localStorage.setItem('neostream_dvr_start_margin_min', 'dez minutos');
        expect(margemInicialMs()).toBe(START_MARGIN_MS);
        localStorage.setItem('neostream_dvr_start_margin_min', '-3');
        expect(margemInicialMs()).toBe(START_MARGIN_MS);
    });
});

describe('a janela de gravação segue as margens configuradas', () => {
    beforeEach(() => localStorage.clear());
    const rec = { startIso: '2026-09-06T20:00:00Z', endIso: '2026-09-06T21:00:00Z' };

    it('sem configuração, a janela usa os padrões', () => {
        expect(janelaGravacao(rec)).toEqual({
            ini: Date.parse(rec.startIso) - START_MARGIN_MS,
            fim: Date.parse(rec.endIso) + END_PADDING_MS,
        });
    });

    // É o mesmo cálculo que decide o aviso de CONFLITO da agenda: aumentar as
    // margens faz gravações antes coladas passarem a se sobrepor.
    it('margem maior alarga a janela — e é isso que o aviso de conflito enxerga', () => {
        localStorage.setItem('neostream_dvr_start_margin_min', '10');
        localStorage.setItem('neostream_dvr_end_padding_min', '10');
        expect(janelaGravacao(rec)).toEqual({
            ini: Date.parse(rec.startIso) - 10 * 60 * 1000,
            fim: Date.parse(rec.endIso) + 10 * 60 * 1000,
        });
    });

    it('margens passadas por parâmetro vencem o storage (caminho quente)', () => {
        localStorage.setItem('neostream_dvr_start_margin_min', '10');
        expect(janelaGravacao(rec, { inicioMs: 0, fimMs: 0 })).toEqual({
            ini: Date.parse(rec.startIso),
            fim: Date.parse(rec.endIso),
        });
    });
});
