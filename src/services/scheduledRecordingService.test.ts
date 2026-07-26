import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleId, isScheduleExpired, END_PADDING_MS, scheduledRecordingService } from './scheduledRecordingService';

describe('scheduleId', () => {
    it('is deterministic for the same channel + start', () => {
        const a = scheduleId('Globo HD', '2026-07-02T21:00:00Z');
        const b = scheduleId('Globo HD', '2026-07-02T21:00:00Z');
        expect(a).toBe(b);
        expect(a).toMatch(/^sched_/);
    });

    it('differs across channels and start times', () => {
        expect(scheduleId('Globo HD', '2026-07-02T21:00:00Z'))
            .not.toBe(scheduleId('SBT HD', '2026-07-02T21:00:00Z'));
        expect(scheduleId('Globo HD', '2026-07-02T21:00:00Z'))
            .not.toBe(scheduleId('Globo HD', '2026-07-02T22:00:00Z'));
    });
});

describe('isScheduleExpired', () => {
    const now = Date.parse('2026-07-02T21:00:00Z');

    it('is alive while the program has not ended', () => {
        expect(isScheduleExpired('2026-07-02T21:30:00Z', now)).toBe(false);
        expect(isScheduleExpired('2026-07-02T21:00:00Z', now)).toBe(false);
    });

    it('expires once the program end has passed', () => {
        expect(isScheduleExpired('2026-07-02T20:59:00Z', now)).toBe(true);
    });

    it('treats malformed dates as expired', () => {
        expect(isScheduleExpired('not-a-date', now)).toBe(true);
    });
});

describe('END_PADDING_MS', () => {
    it('records a couple of minutes past the announced end', () => {
        expect(END_PADDING_MS).toBe(2 * 60 * 1000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 Regressão (auditoria R1 — H3/M3): o renderer recarrega em fluxos normais
// (trocar playlist, login, Ctrl+R) e perde os timers; o main NÃO reinicia e o
// ffmpeg segue gravando. Sem reconciliar, o boot subia um SEGUNDO ffmpeg no
// mesmo canal. E uma falha transitória no início apagava o agendamento de vez.
// ─────────────────────────────────────────────────────────────────────────────
describe('fire(): reconciliação com o main e retry', () => {
    const invoke = vi.fn();
    const emCurso = () => ({
        channelName: 'Globo HD',
        streamId: 42,
        title: 'Jornal',
        // já começou (startDelayMs = 0 → dispara na hora) e ainda não acabou
        startIso: new Date(Date.now() - 60_000).toISOString(),
        endIso: new Date(Date.now() + 60 * 60_000).toISOString(),
    });

    beforeEach(() => {
        localStorage.clear();
        invoke.mockReset();
        (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { invoke, send: vi.fn() };
    });

    afterEach(() => {
        scheduledRecordingService.list().forEach(s => scheduledRecordingService.remove(s.id));
    });

    /** Deixa o setTimeout do arm() disparar e os awaits do fire() resolverem. */
    const flush = async () => {
        await new Promise(r => setTimeout(r, 5));
        for (let i = 0; i < 15; i++) await Promise.resolve();
    };
    const canaisChamados = () => invoke.mock.calls.map(c => c[0] as string);

    it('gravação já em curso no main é ADOTADA — não sobe um segundo ffmpeg', async () => {
        invoke.mockImplementation((channel: string) => {
            if (channel === 'dvr:active') {
                return Promise.resolve({
                    success: true,
                    recordings: [{ id: 'rec_1', channelName: 'Jornal (Globo HD)' }],
                });
            }
            return Promise.resolve({ success: true });
        });

        scheduledRecordingService.add(emCurso());
        await flush();

        expect(canaisChamados()).toContain('dvr:active');
        expect(canaisChamados()).not.toContain('dvr:start');
        expect(canaisChamados()).not.toContain('streams:get-live-url');
    });

    it('sem gravação correspondente no main, inicia normalmente', async () => {
        invoke.mockImplementation((channel: string) => {
            if (channel === 'dvr:active') return Promise.resolve({ success: true, recordings: [] });
            if (channel === 'streams:get-live-url') return Promise.resolve({ success: true, url: 'http://x/live.ts' });
            if (channel === 'dvr:start') return Promise.resolve({ success: true, id: 'rec_novo' });
            return Promise.resolve({ success: true });
        });

        scheduledRecordingService.add(emCurso());
        await flush();

        expect(canaisChamados()).toContain('dvr:start');
    });

    it('gravação de OUTRO programa no main não é confundida', async () => {
        invoke.mockImplementation((channel: string) => {
            if (channel === 'dvr:active') {
                return Promise.resolve({
                    success: true,
                    recordings: [{ id: 'rec_outro', channelName: 'Novela (SBT HD)' }],
                });
            }
            if (channel === 'streams:get-live-url') return Promise.resolve({ success: true, url: 'http://x/live.ts' });
            if (channel === 'dvr:start') return Promise.resolve({ success: true, id: 'rec_novo' });
            return Promise.resolve({ success: true });
        });

        scheduledRecordingService.add(emCurso());
        await flush();

        expect(canaisChamados()).toContain('dvr:start');
    });

    it('falha transitória no início NÃO apaga o agendamento (fica pra retry)', async () => {
        invoke.mockImplementation((channel: string) => {
            if (channel === 'dvr:active') return Promise.resolve({ success: true, recordings: [] });
            if (channel === 'streams:get-live-url') return Promise.resolve({ success: false, error: 'rede caiu' });
            return Promise.resolve({ success: true });
        });

        const rec = scheduledRecordingService.add(emCurso());
        await flush();

        // Antes do fix, o catch removia o agendamento do storage na 1a falha.
        expect(scheduledRecordingService.list().map(s => s.id)).toContain(rec.id);
    });

    // Revisão adversarial do PR: sair por "expirado" sem adotar deixava o ffmpeg
    // do main gravando pra sempre (reload dentro da janela do END_PADDING).
    it('gravação órfã de programa já encerrado é PARADA no boot (init)', async () => {
        const rec = {
            channelName: 'Band HD',
            streamId: 7,
            title: 'Show',
            startIso: new Date(Date.now() - 7200_000).toISOString(),
            endIso: new Date(Date.now() - 60_000).toISOString(),
        };
        // Simula o storage sobrevivendo ao reload com o programa já encerrado.
        localStorage.setItem('scheduled_recordings_default', JSON.stringify([
            { ...rec, id: 'sched_orfao' },
        ]));
        invoke.mockImplementation((channel: string) => {
            if (channel === 'dvr:active') {
                return Promise.resolve({
                    success: true,
                    recordings: [{ id: 'rec_orfao', channelName: 'Show (Band HD)' }],
                });
            }
            return Promise.resolve({ success: true });
        });

        scheduledRecordingService.init();
        await flush();

        const stop = invoke.mock.calls.find(c => c[0] === 'dvr:stop');
        expect(stop).toBeTruthy();
        expect(stop?.[1]).toEqual({ id: 'rec_orfao' });
        // e o agendamento morto sai do storage
        expect(scheduledRecordingService.list().map(s => s.id)).not.toContain('sched_orfao');
    });

    it('fila cheia não impede adotar uma gravação que já existe no main', async () => {
        invoke.mockImplementation((channel: string) => {
            if (channel === 'dvr:active') {
                return Promise.resolve({
                    success: true,
                    recordings: [{ id: 'rec_1', channelName: 'Jornal (Globo HD)' }],
                });
            }
            return Promise.resolve({ success: true });
        });
        localStorage.setItem('neostream_dvr_max_concurrent', '1');

        scheduledRecordingService.add(emCurso());
        await flush();

        // Adotou (não tentou subir outro ffmpeg nem entrou em fila silenciosa).
        expect(canaisChamados()).toContain('dvr:active');
        expect(canaisChamados()).not.toContain('dvr:start');
        localStorage.removeItem('neostream_dvr_max_concurrent');
    });

    it('programa que já acabou é descartado sem tentar gravar', async () => {
        invoke.mockImplementation(() => Promise.resolve({ success: true, recordings: [] }));

        const rec = scheduledRecordingService.add({
            ...emCurso(),
            channelName: 'Record HD',
            startIso: new Date(Date.now() - 7200_000).toISOString(),
            endIso: new Date(Date.now() - 3600_000).toISOString(),
        });
        await flush();

        expect(canaisChamados()).not.toContain('dvr:start');
        expect(scheduledRecordingService.list().map(s => s.id)).not.toContain(rec.id);
    });
});
