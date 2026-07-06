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

describe('parseXMLTVTime', () => {
    it('converte YYYYMMDDHHMMSS +0000 pra UTC exata', () => {
        const d = epgService.parseXMLTVTime('20260705213000', '+0000');
        expect(d?.toISOString()).toBe('2026-07-05T21:30:00.000Z');
    });

    it('aplica offset negativo (Brasil -0300 → UTC +3h)', () => {
        const d = epgService.parseXMLTVTime('20260705210000', '-0300');
        expect(d?.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    });

    it('aplica offset positivo com minutos (+0530)', () => {
        const d = epgService.parseXMLTVTime('20260705120000', '+0530');
        expect(d?.toISOString()).toBe('2026-07-05T06:30:00.000Z');
    });
});

describe('decodeXMLEntities', () => {
    it('decodifica as entidades nomeadas e numéricas', () => {
        expect(epgService.decodeXMLEntities('A &amp; B &lt;3 &gt; &quot;x&quot; &apos;y&apos; caf&#233;'))
            .toBe(`A & B <3 > "x" 'y' café`);
    });
});

describe('parseXMLTV', () => {
    const xml = `<?xml version="1.0"?>
<tv>
  <programme start="20260705200000 +0000" stop="20260705210000 +0000" channel="globo.br">
    <title lang="pt">Jornal &amp; Not&#237;cias</title>
    <desc>Edi&#231;&#227;o da noite</desc>
  </programme>
  <programme start="20260705210000 +0000" stop="20260705220000 +0000" channel="globo.br">
    <title>Novela</title>
  </programme>
  <programme start="20260705200000 +0000" stop="20260705230000 +0000" channel="sbt.br">
    <title>Outro canal</title>
  </programme>
  <programme start="INVALID" stop="20260705220000 +0000" channel="globo.br">
    <title>Sem start válido</title>
  </programme>
</tv>`;

    it('filtra pelo channel e decodifica título/descrição', () => {
        const programs = epgService.parseXMLTV(xml, 'globo.br', 'Globo');
        expect(programs).toHaveLength(2);
        expect(programs[0].title).toBe('Jornal & Notícias');
        expect(programs[0].description).toBe('Edição da noite');
        expect(programs[0].start).toBe('2026-07-05T20:00:00.000Z');
        expect(programs[0].end).toBe('2026-07-05T21:00:00.000Z');
        expect(programs[0].channel_id).toBe('Globo');
        expect(programs[1].title).toBe('Novela');
    });

    it('canal sem programação → lista vazia', () => {
        expect(epgService.parseXMLTV(xml, 'inexistente', 'X')).toEqual([]);
    });
});

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
