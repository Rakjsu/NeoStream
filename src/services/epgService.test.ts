import { describe, it, expect } from 'vitest';
import { epgService } from './epgService';

interface EPGProgram {
    id: string;
    start: string;
    end: string;
    title: string;
    description?: string;
    channel_id: string;
}

/** Program running from `fromMs` to `toMs` relative to now. */
function prog(id: string, fromMs: number, toMs: number): EPGProgram {
    const now = Date.now();
    return {
        id,
        start: new Date(now + fromMs).toISOString(),
        end: new Date(now + toMs).toISOString(),
        title: id,
        channel_id: 'ch',
    };
}

describe('getMiTVSlug', () => {
    it('remove sufixos de qualidade/codec e vira slug sem acento', () => {
        expect(epgService.getMiTVSlug('Meu Canal Ação [FHD]')).toBe('meu-canal-acao');
        expect(epgService.getMiTVSlug('Canal Teste (H265) HD')).toBe('canal-teste');
        expect(epgService.getMiTVSlug('Séries & Cia (PPV)')).toBe('series-cia');
    });
});

describe('getMeuGuiaSlug', () => {
    it('canal fora do mapeamento manual → null (meuguia não tem auto-slug)', () => {
        expect(epgService.getMeuGuiaSlug('Canal Que Não Existe XYZ [4K]')).toBeNull();
    });
});

describe('programa atual / próximo / a seguir', () => {
    const schedule = [
        prog('anterior', -7_200_000, -3_600_000),
        prog('agora', -1_800_000, 1_800_000),
        prog('proximo', 1_800_000, 5_400_000),
        prog('depois', 5_400_000, 9_000_000),
    ];

    it('getCurrentProgram acha o programa no ar', () => {
        expect(epgService.getCurrentProgram(schedule)?.id).toBe('agora');
    });

    it('getCurrentProgram cai no primeiro quando nada cobre o agora', () => {
        const gap = [prog('futuro', 3_600_000, 7_200_000)];
        expect(epgService.getCurrentProgram(gap)?.id).toBe('futuro');
        expect(epgService.getCurrentProgram([])).toBeNull();
    });

    it('getNextProgram devolve o seguinte na grade (e null no último)', () => {
        expect(epgService.getNextProgram(schedule)?.id).toBe('proximo');
        expect(epgService.getNextProgram([prog('so-um', -1000, 60_000)])).toBeNull();
    });

    it('getUpcomingPrograms fatia depois do atual, limitado por count', () => {
        const current = epgService.getCurrentProgram(schedule);
        const upcoming = epgService.getUpcomingPrograms(schedule, current, 2);
        expect(upcoming.map(p => p.id)).toEqual(['proximo', 'depois']);
        expect(epgService.getUpcomingPrograms(schedule, null, 2)).toEqual([]);
    });

    it('getProgress: 0 antes, ~50 no meio, 100 depois', () => {
        expect(epgService.getProgress(prog('antes', 60_000, 120_000))).toBe(0);
        expect(epgService.getProgress(prog('depois', -120_000, -60_000))).toBe(100);
        const half = epgService.getProgress(prog('meio', -1_800_000, 1_800_000));
        expect(half).toBeGreaterThanOrEqual(49);
        expect(half).toBeLessThanOrEqual(51);
    });
});
