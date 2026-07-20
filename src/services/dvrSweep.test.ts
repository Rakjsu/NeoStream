import { describe, expect, it } from 'vitest';
import { pickExpiredRecordings, recElapsedLabel } from './dvrSweep';

describe('pickExpiredRecordings (auto-faxina do DVR)', () => {
    const nowMs = 1_800_000_000_000;
    const day = 86_400_000;
    const files = [
        { path: 'velha.ts', mtimeMs: nowMs - 40 * day },
        { path: 'recente.ts', mtimeMs: nowMs - 2 * day },
        { path: 'gravando.ts', mtimeMs: nowMs - 40 * day, recording: true },
        { path: 'sem-mtime.ts', mtimeMs: 0 },
    ];

    it('só o arquivo velho e inativo vence', () => {
        expect(pickExpiredRecordings(files, 30, nowMs).map(f => f.path)).toEqual(['velha.ts']);
    });

    it('limite 0 = faxina desligada', () => {
        expect(pickExpiredRecordings(files, 0, nowMs)).toEqual([]);
    });

    it('gravação protegida nunca entra na varredura', () => {
        expect(pickExpiredRecordings(files, 30, nowMs, new Set(['velha.ts']))).toEqual([]);
    });
});

describe('recElapsedLabel (item 16 — painel de gravações ativas)', () => {
    it('formata mm:ss e h:mm:ss', () => {
        expect(recElapsedLabel(0, 65_000)).toBe('01:05');
        expect(recElapsedLabel(0, 3_725_000)).toBe('1:02:05');
    });

    it('relógio atrasado não fica negativo', () => {
        expect(recElapsedLabel(10_000, 5_000)).toBe('00:00');
    });
});
