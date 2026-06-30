import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Profile, WatchLaterItem } from '../types/profile';

// Mutable mock state for the active profile + playlist.
let activeProfile: Profile | null = null;
const profiles: Profile[] = [];

const makeProfile = (id: string, watchLater: WatchLaterItem[] = []): Profile => ({
    id,
    name: id,
    avatar: '',
    watchLater,
    continueWatching: [],
    createdAt: 'x',
    lastUsed: 'x'
});

vi.mock('./profileService', () => ({
    profileService: {
        getActiveProfile: () => activeProfile,
        getAllProfiles: () => profiles
    }
}));

let playlistId = 'plA';
vi.mock('./activePlaylistService', () => ({
    getActivePlaylistId: () => playlistId,
    hasKnownPlaylistId: () => playlistId !== 'default',
    playlistScopedKey: (base: string, profileId: string) =>
        `${base}_${profileId}__pl_${playlistId}`
}));

import { watchLaterService } from './watchLater';

const item = (id: string) => ({
    id,
    type: 'movie' as const,
    name: 'T',
    cover: 'c'
});

function setActive(p: Profile) {
    activeProfile = p;
    profiles.length = 0;
    profiles.push(p);
}

describe('watchLaterService — per-playlist scoping', () => {
    beforeEach(() => {
        localStorage.clear();
        playlistId = 'plA';
        setActive(makeProfile('p1'));
    });

    it('an item added under playlist A is not present under B; present again under A', () => {
        playlistId = 'plA';
        expect(watchLaterService.add(item('m1'))).toBe(true);
        expect(watchLaterService.has('m1', 'movie')).toBe(true);

        playlistId = 'plB';
        expect(watchLaterService.has('m1', 'movie')).toBe(false);
        expect(watchLaterService.getAll()).toEqual([]);

        playlistId = 'plA';
        expect(watchLaterService.has('m1', 'movie')).toBe(true);
        expect(localStorage.getItem('neostream_watchlater_p1__pl_plA')).toBeTruthy();
        expect(localStorage.getItem('neostream_watchlater_p1__pl_plB')).toBeNull();
    });

    it('remove and clear operate within the active playlist scope', () => {
        watchLaterService.add(item('m1'));
        watchLaterService.add(item('m2'));
        expect(watchLaterService.getAll().map(i => i.id)).toEqual(['m1', 'm2']);

        watchLaterService.remove('m1', 'movie');
        expect(watchLaterService.getAll().map(i => i.id)).toEqual(['m2']);

        watchLaterService.clear();
        expect(watchLaterService.getAll()).toEqual([]);
    });

    it('isolates watch-later across profiles too', () => {
        setActive(makeProfile('p1'));
        watchLaterService.add(item('m1'));
        setActive(makeProfile('p2'));
        expect(watchLaterService.has('m1', 'movie')).toBe(false);
    });
});

describe('watchLaterService — legacy profile.watchLater → per-playlist migration', () => {
    beforeEach(() => {
        localStorage.clear();
        playlistId = 'plA';
    });

    it('drains the legacy profile.watchLater into the active playlist scope, then clears it', () => {
        const legacy: WatchLaterItem[] = [{ ...item('m1'), addedAt: 'x' }];
        setActive(makeProfile('p1', legacy));

        // Any access migrates.
        expect(watchLaterService.has('m1', 'movie')).toBe(true);

        const scoped = JSON.parse(localStorage.getItem('neostream_watchlater_p1__pl_plA')!) as WatchLaterItem[];
        expect(scoped.map(i => i.id)).toEqual(['m1']);
        // Legacy field cleared + persisted to neostream_profiles.
        expect(activeProfile!.watchLater).toEqual([]);
        const stored = JSON.parse(localStorage.getItem('neostream_profiles')!);
        expect(stored.profiles[0].watchLater).toEqual([]);
    });

    it('is idempotent and does not clobber existing scoped items', () => {
        setActive(makeProfile('p1', [{ ...item('old'), addedAt: 'x' }]));
        localStorage.setItem(
            'neostream_watchlater_p1__pl_plA',
            JSON.stringify([{ ...item('keep'), addedAt: 'x' }])
        );

        watchLaterService.getAll(); // migrate
        watchLaterService.getAll(); // no-op

        const scoped = JSON.parse(localStorage.getItem('neostream_watchlater_p1__pl_plA')!) as WatchLaterItem[];
        expect(scoped.map(i => i.id)).toEqual(['keep']);
        expect(activeProfile!.watchLater).toEqual([]);
    });

    it('is skipped while the active playlist id is unknown (default fallback)', () => {
        playlistId = 'default';
        const legacy: WatchLaterItem[] = [{ ...item('m1'), addedAt: 'x' }];
        setActive(makeProfile('p1', legacy));

        watchLaterService.getAll();

        // Legacy field untouched; no scoped key written under 'default'.
        expect(activeProfile!.watchLater.map(i => i.id)).toEqual(['m1']);
        expect(localStorage.getItem('neostream_watchlater_p1__pl_default')).toBeNull();
    });
});
