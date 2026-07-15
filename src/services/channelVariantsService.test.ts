import { describe, expect, it } from 'vitest';
import { groupChannelVariants, qualityLabel, qualityRank, variantBaseName } from './channelVariantsService';

describe('qualityRank / variantBaseName / qualityLabel', () => {
    it('4K vence FHD que vence HD que vence SD; sem tag fica no meio', () => {
        expect(qualityRank('ESPN 4K')).toBeLessThan(qualityRank('ESPN FHD'));
        expect(qualityRank('ESPN FHD')).toBeLessThan(qualityRank('ESPN HD'));
        expect(qualityRank('ESPN HD')).toBeLessThan(qualityRank('ESPN'));
        expect(qualityRank('ESPN')).toBeLessThan(qualityRank('ESPN SD'));
    });

    it('base ignora tags de qualidade/codec em qualquer formato', () => {
        expect(variantBaseName('ESPN FHD')).toBe('espn');
        expect(variantBaseName('ESPN [HD]')).toBe('espn');
        expect(variantBaseName('ESPN (H265)')).toBe('espn');
        expect(variantBaseName('FHD')).toBe('fhd'); // nome que é SÓ a tag fica sozinho
    });

    it('rótulo curto da qualidade', () => {
        expect(qualityLabel('ESPN FHD')).toBe('FHD');
        expect(qualityLabel('ESPN [4K]')).toBe('4K');
        expect(qualityLabel('Canal Sem Tag')).toBe('Canal Sem Ta');
    });
});

describe('groupChannelVariants', () => {
    const channels = [
        { stream_id: 1, name: 'ESPN HD' },
        { stream_id: 2, name: 'Globo' },
        { stream_id: 3, name: 'ESPN FHD' },
        { stream_id: 4, name: 'ESPN SD' },
    ];

    it('melhor qualidade representa o grupo, na posição da 1ª ocorrência', () => {
        const { groups, variantsOf } = groupChannelVariants(channels);
        expect(groups.map(c => c.stream_id)).toEqual([3, 2]);
        expect(variantsOf.get('3')?.map(c => c.stream_id)).toEqual([3, 1, 4]);
        expect(variantsOf.has('2')).toBe(false); // canal único não vira grupo
    });

    it('lista vazia não explode', () => {
        const { groups, variantsOf } = groupChannelVariants([]);
        expect(groups).toEqual([]);
        expect(variantsOf.size).toBe(0);
    });
});
