import { describe, it, expect } from 'vitest';
import { buildAgenda, groupAgendaByDay, isRecordingInFlight } from './agenda';
import type { ProgramReminder } from '../services/reminderService';
import type { ScheduledRecording } from '../services/scheduledRecordingService';

const NOW = Date.parse('2026-07-03T12:00:00');
const iso = (offsetH: number) => new Date(NOW + offsetH * 3600_000).toISOString();

const reminder = (title: string, offsetH: number): ProgramReminder => ({
    id: `r-${title}`, channelName: 'Globo', streamId: 1, title, startIso: iso(offsetH)
});
const recording = (title: string, startH: number, endH: number): ScheduledRecording => ({
    id: `g-${title}`, channelName: 'SBT', streamId: 2, title, startIso: iso(startH), endIso: iso(endH)
});

describe('buildAgenda', () => {
    it('mescla e ordena por início, descartando o que já passou', () => {
        const agenda = buildAgenda(
            [reminder('Lembrete tarde', 6), reminder('Lembrete passado', -1)],
            [recording('Gravação cedo', 2, 3), recording('Gravação encerrada', -3, -2)],
            NOW
        );
        expect(agenda.map(e => e.title)).toEqual(['Gravação cedo', 'Lembrete tarde']);
        expect(agenda[0].kind).toBe('recording');
    });

    it('mantém gravação em andamento (começou mas não terminou)', () => {
        const agenda = buildAgenda([], [recording('Em andamento', -0.5, 0.5)], NOW);
        expect(agenda).toHaveLength(1);
        expect(isRecordingInFlight(agenda[0], NOW)).toBe(true);
        expect(isRecordingInFlight(agenda[0], NOW + 3600_000)).toBe(false);
    });
});

describe('groupAgendaByDay', () => {
    it('agrupa em hoje / amanhã / data', () => {
        const agenda = buildAgenda(
            [reminder('Hoje à noite', 8), reminder('Amanhã', 26), reminder('Depois', 50)],
            [], NOW
        );
        const groups = groupAgendaByDay(agenda, NOW);
        expect(groups.map(g => g.day)).toEqual(['today', 'tomorrow', '2026-07-05']);
        expect(groups[0].entries[0].title).toBe('Hoje à noite');
    });
});
