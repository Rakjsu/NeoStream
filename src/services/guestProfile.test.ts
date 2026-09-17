import { describe, it, expect, beforeEach } from 'vitest';
import { profileService, GUEST_PROFILE_ID } from './profileService';

describe('perfil convidado', () => {
    beforeEach(() => {
        localStorage.clear();
        // A sessão de convidado é marcada em sessionStorage, e a guarda de
        // janela secundária olha o hash — os dois precisam nascer limpos.
        sessionStorage.clear();
        window.location.hash = '';
    });

    it('reabrir o app encerra a sessão de convidado e purga o histórico', async () => {
        await profileService.createProfile({ name: 'Dono', avatar: 'D' });
        profileService.startGuestSession();
        localStorage.setItem('movie_watch_progress_guest', '{"42":100}');

        sessionStorage.clear();      // app fechado: o localStorage fica, o sessionStorage não
        profileService.initialize(); // boot seguinte

        expect(profileService.getActiveProfile()).toBeNull();
        expect(profileService.getAllProfiles().some(p => p.id === GUEST_PROFILE_ID)).toBe(false);
        expect(localStorage.getItem('movie_watch_progress_guest')).toBeNull();
    });

    it('convidado sozinho: o boot recria o kids-default em vez de tela vazia', () => {
        profileService.startGuestSession();

        sessionStorage.clear();
        profileService.initialize();

        expect(profileService.getActiveProfile()).toBeNull();
        expect(profileService.getAllProfiles().map(p => p.id)).toEqual(['kids-default']);
    });

    it('reload interno (troca de playlist) mantém a sessão de convidado', () => {
        profileService.startGuestSession();
        localStorage.setItem('movie_watch_progress_guest', '{"42":100}');

        profileService.initialize(); // mesmo carregamento: a marca continua lá

        expect(profileService.isGuestActive()).toBe(true);
        expect(localStorage.getItem('movie_watch_progress_guest')).toBe('{"42":100}');
    });

    it('abrir o PiP no meio da sessão não encerra o convidado', async () => {
        await profileService.createProfile({ name: 'Dono', avatar: 'D' });
        profileService.startGuestSession();
        localStorage.setItem('movie_watch_progress_guest', '{"42":100}');

        // A janela do PiP carrega o MESMO index.html: browsing context novo,
        // localStorage compartilhado, sessionStorage zerado — e o boot do App
        // roda nela também.
        sessionStorage.clear();
        window.location.hash = '#/pip?data=%7B%7D';
        profileService.initialize();

        expect(profileService.isGuestActive()).toBe(true);
        expect(localStorage.getItem('movie_watch_progress_guest')).toBe('{"42":100}');
    });

    it('abrir o multi-view no meio da sessão não encerra o convidado', () => {
        profileService.startGuestSession();

        sessionStorage.clear();
        window.location.hash = '#/multiview?initial=7';
        profileService.initialize();

        expect(profileService.isGuestActive()).toBe(true);
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
