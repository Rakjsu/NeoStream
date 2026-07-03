import { describe, it, expect, beforeEach } from 'vitest';
import { profileService, GUEST_PROFILE_ID } from './profileService';

describe('perfil convidado', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('startGuestSession ativa um perfil convidado transitório', () => {
        const guest = profileService.startGuestSession();
        expect(guest.id).toBe(GUEST_PROFILE_ID);
        expect(guest.isGuest).toBe(true);
        expect(profileService.isGuestActive()).toBe(true);
        expect(profileService.getActiveProfile()?.id).toBe(GUEST_PROFILE_ID);
    });

    it('iniciar nova sessão limpa dados de convidado anteriores', () => {
        profileService.startGuestSession();
        localStorage.setItem('usage_stats_guest', '{"totalWatchTimeSeconds":999}');
        localStorage.setItem('neostream_profile_guest__pl_abc', '{"favorites":[1]}');
        localStorage.setItem('usage_stats_other', '{"keep":true}');

        profileService.startGuestSession();

        expect(localStorage.getItem('usage_stats_guest')).toBeNull();
        expect(localStorage.getItem('neostream_profile_guest__pl_abc')).toBeNull();
        expect(localStorage.getItem('usage_stats_other')).toBe('{"keep":true}');
    });

    it('trocar para outro perfil purga e remove o convidado', async () => {
        const real = await profileService.createProfile({ name: 'Tester', avatar: '👤' });
        expect(real).not.toBeNull();

        profileService.startGuestSession();
        localStorage.setItem('movie_watch_progress_guest', '{"42":100}');

        profileService.setActiveProfile(real!.id);

        expect(localStorage.getItem('movie_watch_progress_guest')).toBeNull();
        expect(profileService.getAllProfiles().some(p => p.id === GUEST_PROFILE_ID)).toBe(false);
        expect(profileService.getActiveProfile()?.id).toBe(real!.id);
    });

    it('logout do convidado também purga', () => {
        profileService.startGuestSession();
        localStorage.setItem('scheduled_recordings_guest', '[]');

        profileService.clearActiveProfile();

        expect(localStorage.getItem('scheduled_recordings_guest')).toBeNull();
        expect(profileService.getActiveProfile()).toBeNull();
        expect(profileService.getAllProfiles().some(p => p.id === GUEST_PROFILE_ID)).toBe(false);
    });

    it('convidado não conta pro limite de 5 perfis', async () => {
        for (let i = 0; i < 4; i++) {
            expect(await profileService.createProfile({ name: `P${i}`, avatar: '👤' })).not.toBeNull();
        }
        profileService.startGuestSession();
        expect(await profileService.createProfile({ name: 'P5', avatar: '👤' })).not.toBeNull();
    });
});
