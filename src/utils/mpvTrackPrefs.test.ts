import { describe, it, expect } from 'vitest';
import { trackPrefKey, trackLang, choosePreferredTracks, type MpvTrackLike } from './mpvTrackPrefs';

const tracks: MpvTrackLike[] = [
    { id: 1, type: 'audio', lang: 'pt', title: 'Português' },
    { id: 2, type: 'audio', lang: 'en', title: 'English' },
    { id: 1, type: 'sub', lang: 'pt', title: null },
    { id: 2, type: 'sub', lang: null, title: 'Español' },
];

describe('trackPrefKey', () => {
    it('prefers the series key and falls back to movie', () => {
        expect(trackPrefKey(undefined, '301')).toBe('s:301');
        expect(trackPrefKey('204', undefined)).toBe('m:204');
        expect(trackPrefKey('204', '301')).toBe('s:301');
        expect(trackPrefKey()).toBeNull();
    });
});

describe('trackLang', () => {
    it('uses lang, falls back to title, lowercased', () => {
        expect(trackLang({ id: 1, type: 'audio', lang: 'PT', title: null })).toBe('pt');
        expect(trackLang({ id: 2, type: 'sub', lang: null, title: 'Español' })).toBe('español');
        expect(trackLang({ id: 3, type: 'sub', lang: null, title: null })).toBeNull();
    });
});

describe('choosePreferredTracks', () => {
    it('matches audio and subtitle by language', () => {
        expect(choosePreferredTracks(tracks, { audioLang: 'en', subLang: 'pt' }))
            .toEqual({ audioId: 2, subtitleId: 1 });
    });

    it('"off" disables subtitles explicitly', () => {
        expect(choosePreferredTracks(tracks, { audioLang: null, subLang: 'off' }))
            .toEqual({ subtitleId: null });
    });

    it('leaves selections alone when nothing matches or no pref', () => {
        expect(choosePreferredTracks(tracks, { audioLang: 'ja', subLang: null })).toEqual({});
        expect(choosePreferredTracks(tracks, null)).toEqual({});
        expect(choosePreferredTracks(tracks, undefined)).toEqual({});
    });

    it('matches subtitle by title when lang is missing', () => {
        expect(choosePreferredTracks(tracks, { audioLang: null, subLang: 'español' }))
            .toEqual({ subtitleId: 2 });
    });
});
