import { describe, expect, it } from 'vitest';
import { pickExpiredRecordings, recElapsedLabel, espacoParaGravacao, DVR_BYTES_POR_HORA, DVR_FOLGA_DISCO_BYTES } from './dvrSweep';

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

/**
 * O agendado é o único caminho que grava sozinho, de madrugada, sem ninguém
 * olhando — e era o único que NÃO perguntava se cabia. Pior: disco cheio no
 * meio não falha em silêncio, falha mentindo (o `dvr:stopped` sai sem campo
 * `error` e o app anuncia "Gravação concluída" pra um arquivo truncado).
 */
describe('espacoParaGravacao', () => {
    const UMA_HORA = 3_600_000;

    it('cabe quando sobra o estimado mais a folga', () => {
        const v = espacoParaGravacao(DVR_BYTES_POR_HORA + DVR_FOLGA_DISCO_BYTES, UMA_HORA);
        expect(v.cabe).toBe(true);
        expect(v.faltamBytes).toBe(0);
        expect(v.estimadoBytes).toBe(DVR_BYTES_POR_HORA);
    });

    // A folga não é enfeite: disco no talo trava o sistema inteiro, não só o app.
    it('não cabe quando o estimado entra mas a folga não', () => {
        const v = espacoParaGravacao(DVR_BYTES_POR_HORA + DVR_FOLGA_DISCO_BYTES - 1, UMA_HORA);
        expect(v.cabe).toBe(false);
        expect(v.faltamBytes).toBe(1);
    });

    it('meia hora custa metade', () => {
        expect(espacoParaGravacao(0, UMA_HORA / 2).estimadoBytes).toBe(DVR_BYTES_POR_HORA / 2);
    });

    it('disco cheio devolve o quanto falta, que é o que o aviso mostra', () => {
        const v = espacoParaGravacao(0, 2 * UMA_HORA);
        expect(v.cabe).toBe(false);
        expect(v.faltamBytes).toBe(2 * DVR_BYTES_POR_HORA + DVR_FOLGA_DISCO_BYTES);
    });

    // Sem saber a duração, recusar seria chutar contra o usuário — e perder a
    // gravação por um palpite é pior que gravar e faltar espaço.
    it('duração desconhecida, zero ou lixo deixa gravar', () => {
        for (const duracao of [0, -1, NaN, Infinity]) {
            expect(espacoParaGravacao(0, duracao).cabe).toBe(true);
        }
        expect(espacoParaGravacao(NaN, UMA_HORA).cabe).toBe(true);
    });

    it('folga customizada é respeitada', () => {
        expect(espacoParaGravacao(DVR_BYTES_POR_HORA, UMA_HORA, 0).cabe).toBe(true);
    });
});
