import { describe, it, expect } from 'vitest';
import { buildMediaSessionMetadata } from './useMediaSession';

describe('buildMediaSessionMetadata', () => {
    it('usa o título simples para filmes', () => {
        const meta = buildMediaSessionMetadata({ title: 'Matrix', contentType: 'movie' });
        expect(meta.title).toBe('Matrix');
        expect(meta.artist).toBe('NeoStream');
    });

    it('anexa temporada/episódio para séries', () => {
        const meta = buildMediaSessionMetadata({
            title: 'Dark', contentType: 'series', seasonNumber: 2, episodeNumber: 5
        });
        expect(meta.title).toBe('Dark — T2E5');
    });

    it('não anexa T/E quando faltam números', () => {
        const meta = buildMediaSessionMetadata({ title: 'Dark', contentType: 'series' });
        expect(meta.title).toBe('Dark');
    });

    it('marca TV ao vivo no campo artist', () => {
        const meta = buildMediaSessionMetadata({ title: 'Globo SP', contentType: 'live' });
        expect(meta.artist).toBe('TV ao vivo · NeoStream');
    });

    it('inclui artwork apenas para URLs http(s)', () => {
        const withPoster = buildMediaSessionMetadata({ title: 'X', poster: 'https://img/x.jpg' });
        expect(withPoster.artwork).toEqual([{ src: 'https://img/x.jpg', sizes: '512x512', type: 'image/jpeg' }]);

        const noPoster = buildMediaSessionMetadata({ title: 'X' });
        expect(noPoster.artwork).toEqual([]);

        const relativePoster = buildMediaSessionMetadata({ title: 'X', poster: '/local.jpg' });
        expect(relativePoster.artwork).toEqual([]);
    });

    it('cai no fallback NeoStream sem título', () => {
        const meta = buildMediaSessionMetadata({});
        expect(meta.title).toBe('NeoStream');
    });
});
