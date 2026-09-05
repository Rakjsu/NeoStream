import { describe, it, expect } from 'vitest';
import {
    conflitosDoAgendamento,
    janelaGravacao,
    START_MARGIN_MS,
    END_PADDING_MS,
    type ScheduledRecording
} from './scheduledRecordingService';

// A 3ª gravação sobreposta (com limite 2) era aceita na cara do usuário e
// depois falhava SOZINHA: o `fire` via a fila cheia, re-tentava a cada 30 s e
// desistia quando o programa acabava. Sem aviso, sem arquivo, sem log na tela.
// Estes testes fixam a conta que decide o aviso.

const rec = (id: string, inicio: string, fim: string): ScheduledRecording => ({
    id,
    channelName: `canal ${id}`,
    streamId: Number(id.replace(/\D/g, '')) || 1,
    title: `programa ${id}`,
    startIso: inicio,
    endIso: fim
});

describe('janelaGravacao', () => {
    it('a janela real é maior que o programa: margem antes e folga depois', () => {
        const janela = janelaGravacao(rec('a', '2026-09-05T20:00:00Z', '2026-09-05T21:00:00Z'));
        expect(janela).toEqual({
            ini: Date.parse('2026-09-05T20:00:00Z') - START_MARGIN_MS,
            fim: Date.parse('2026-09-05T21:00:00Z') + END_PADDING_MS
        });
    });

    it('datas inválidas ou fim antes do início não viram janela', () => {
        expect(janelaGravacao(rec('a', 'nao-e-data', '2026-09-05T21:00:00Z'))).toBeNull();
        expect(janelaGravacao(rec('a', '2026-09-05T21:00:00Z', '2026-09-05T20:00:00Z'))).toBeNull();
    });
});

describe('conflitosDoAgendamento', () => {
    const candidato = { id: 'novo', startIso: '2026-09-05T20:00:00Z', endIso: '2026-09-05T21:00:00Z' };

    it('sem nada agendado, cabe', () => {
        expect(conflitosDoAgendamento(candidato, [], 2)).toEqual([]);
    });

    it('uma sobreposta com limite 2 ainda cabe', () => {
        const outras = [rec('a', '2026-09-05T20:30:00Z', '2026-09-05T21:30:00Z')];
        expect(conflitosDoAgendamento(candidato, outras, 2)).toEqual([]);
    });

    it('duas sobrepostas com limite 2 é conflito — o candidato é o terceiro', () => {
        const outras = [
            rec('a', '2026-09-05T20:30:00Z', '2026-09-05T21:30:00Z'),
            rec('b', '2026-09-05T19:30:00Z', '2026-09-05T20:30:00Z')
        ];
        const conflitos = conflitosDoAgendamento(candidato, outras, 2);
        expect(conflitos.map(c => c.id).sort()).toEqual(['a', 'b']);
    });

    // Duas gravações que só se cruzam FORA da janela do candidato não o
    // atrapalham: o pico delas acontece quando ele nem está no ar.
    it('duas que se cruzam longe do candidato não contam', () => {
        const outras = [
            rec('a', '2026-09-05T22:00:00Z', '2026-09-05T23:00:00Z'),
            rec('b', '2026-09-05T22:30:00Z', '2026-09-05T23:30:00Z')
        ];
        expect(conflitosDoAgendamento(candidato, outras, 2)).toEqual([]);
    });

    // Cada uma cruza o candidato, mas em metades diferentes da janela dele:
    // em nenhum instante há três no ar ao mesmo tempo.
    it('duas que cruzam o candidato em momentos diferentes não são conflito', () => {
        const outras = [
            rec('a', '2026-09-05T19:00:00Z', '2026-09-05T20:10:00Z'),
            rec('b', '2026-09-05T20:50:00Z', '2026-09-05T22:00:00Z')
        ];
        expect(conflitosDoAgendamento(candidato, outras, 2)).toEqual([]);
    });

    // O detalhe que ninguém vê na grade: dois programas COLADOS no relógio se
    // sobrepõem por 4 minutos — a margem de 2 min antes mais a folga de 2 min
    // depois. Com uma gravadora só, isso já é conflito.
    it('programas colados conflitam com limite 1, pelas margens', () => {
        const colado = [rec('a', '2026-09-05T21:00:00Z', '2026-09-05T22:00:00Z')];
        expect(conflitosDoAgendamento(candidato, colado, 1).map(c => c.id)).toEqual(['a']);
    });

    // Mas colados dos DOIS lados, com limite 2, cabem: eles entram no ar em
    // instantes diferentes e em nenhum momento há três gravando junto.
    it('colados dos dois lados cabem com limite 2', () => {
        const outras = [
            rec('a', '2026-09-05T21:00:00Z', '2026-09-05T22:00:00Z'),
            rec('b', '2026-09-05T19:00:00Z', '2026-09-05T20:00:00Z')
        ];
        expect(conflitosDoAgendamento(candidato, outras, 2)).toEqual([]);
    });

    it('com limite 1, uma sobreposta já é conflito', () => {
        const outras = [rec('a', '2026-09-05T20:30:00Z', '2026-09-05T21:30:00Z')];
        expect(conflitosDoAgendamento(candidato, outras, 1).map(c => c.id)).toEqual(['a']);
    });

    it('o próprio agendamento não conflita consigo mesmo', () => {
        const mesmo = rec('novo', candidato.startIso, candidato.endIso);
        const outras = [mesmo, rec('a', '2026-09-05T20:30:00Z', '2026-09-05T21:30:00Z')];
        expect(conflitosDoAgendamento(candidato, outras, 2)).toEqual([]);
    });

    it('agendamento com data quebrada é ignorado em vez de derrubar a conta', () => {
        const outras = [
            rec('quebrado', 'sei-la', 'tambem-nao'),
            rec('a', '2026-09-05T20:30:00Z', '2026-09-05T21:30:00Z')
        ];
        expect(conflitosDoAgendamento(candidato, outras, 2)).toEqual([]);
    });
});
