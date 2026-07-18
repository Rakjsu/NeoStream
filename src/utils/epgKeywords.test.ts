import { describe, expect, it } from 'vitest';
import { alertKey, compileKeyword, matchEpgKeywords } from './epgKeywords';

const NOW = Date.UTC(2026, 6, 18, 12, 0, 0);
const future = new Date(NOW + 3_600_000).toISOString();
const past = new Date(NOW - 3_600_000).toISOString();

describe('compileKeyword', () => {
    it('termo simples é case-insensitive e escapado', () => {
        expect(compileKeyword('Jogo (ao vivo)')?.test('JOGO (AO VIVO) especial')).toBe(true);
        expect(compileKeyword('c++')?.test('Aula de C++')).toBe(true);
    });

    it('"/padrão/flags" vira regex de verdade; inválida vira null', () => {
        expect(compileKeyword('/fla.*flu/')?.test('FLAxFLU hoje')).toBe(true);
        expect(compileKeyword('/((/')).toBeNull();
        expect(compileKeyword('   ')).toBeNull();
    });
});

describe('matchEpgKeywords', () => {
    const entries: [string, { title: string; start: string }[]][] = [
        ['ESPN', [
            { title: 'Flamengo x Fluminense', start: future },
            { title: 'Flamengo: melhores momentos', start: past },
        ]],
        ['Globo', [{ title: 'Novela das Nove', start: future }]],
    ];

    it('só programas futuros casam, um alerta por programa', () => {
        const matches = matchEpgKeywords(entries, ['flamengo', 'novela'], NOW);
        expect(matches).toHaveLength(2);
        expect(matches[0]).toMatchObject({ keyword: 'flamengo', channelKey: 'ESPN' });
        expect(matches[1]).toMatchObject({ keyword: 'novela', channelKey: 'Globo' });
    });

    it('sem keywords válidas, sem varredura', () => {
        expect(matchEpgKeywords(entries, ['/((/'], NOW)).toEqual([]);
        expect(matchEpgKeywords(entries, [], NOW)).toEqual([]);
    });

    it('alertKey identifica o programa de forma estável', () => {
        const [match] = matchEpgKeywords(entries, ['flamengo'], NOW);
        expect(alertKey(match)).toBe(`ESPN|Flamengo x Fluminense|${future}`);
    });
});
