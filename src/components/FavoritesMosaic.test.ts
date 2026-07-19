import { describe, expect, it } from 'vitest';
import { pickMosaicChannels } from '../utils/mosaic';

describe('pickMosaicChannels (item 33 — mosaico de favoritos)', () => {
    const streams = [
        { stream_id: 1, name: 'A' },
        { stream_id: 2, name: 'B' },
        { stream_id: 3, name: 'C' },
        { stream_id: 4, name: 'D' },
    ];

    it('filtra só os favoritos preservando a ordem da lista', () => {
        const picked = pickMosaicChannels(streams, new Set(['3', '1']));
        expect(picked.map(s => s.stream_id)).toEqual([1, 3]);
    });

    it('respeita o teto', () => {
        const picked = pickMosaicChannels(streams, new Set(['1', '2', '3', '4']), 2);
        expect(picked).toHaveLength(2);
    });

    it('sem favoritos devolve vazio', () => {
        expect(pickMosaicChannels(streams, new Set())).toEqual([]);
    });
});
