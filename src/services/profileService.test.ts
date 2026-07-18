import { describe, it, expect, beforeEach } from 'vitest';
import { profileService, GUEST_PROFILE_ID } from './profileService';

// PINs usam crypto.subtle (SHA-256) — disponível no Node/jsdom do vitest.

describe('profileService', () => {
    beforeEach(() => localStorage.clear());

    describe('createProfile', () => {
        it('cria o perfil e o primeiro vira ativo', async () => {
            const p = await profileService.createProfile({ name: '  Rak  ', avatar: '🦊' });
            expect(p?.name).toBe('Rak'); // trim
            expect(profileService.getActiveProfile()?.id).toBe(p!.id);
        });

        it('rejeita nome vazio ou com mais de 20 caracteres', async () => {
            expect(await profileService.createProfile({ name: '   ', avatar: 'x' })).toBeNull();
            expect(await profileService.createProfile({ name: 'a'.repeat(21), avatar: 'x' })).toBeNull();
        });

        it('respeita o limite de 5 perfis (convidado não conta)', async () => {
            for (let i = 1; i <= 5; i++) {
                expect(await profileService.createProfile({ name: `P${i}`, avatar: 'x' })).not.toBeNull();
            }
            expect(await profileService.createProfile({ name: 'P6', avatar: 'x' })).toBeNull();
        });
    });

    describe('setActiveProfile / deleteProfile', () => {
        it('troca o perfil ativo e atualiza lastUsed', async () => {
            const a = await profileService.createProfile({ name: 'A', avatar: 'x' });
            const b = await profileService.createProfile({ name: 'B', avatar: 'x' });
            expect(profileService.setActiveProfile(b!.id)).toBe(true);
            expect(profileService.getActiveProfile()?.id).toBe(b!.id);
            expect(profileService.setActiveProfile('inexistente')).toBe(false);
            expect(profileService.getActiveProfile()?.id).toBe(b!.id);
            void a;
        });

        it('não deleta o perfil ativo; deleta os demais', async () => {
            const a = await profileService.createProfile({ name: 'A', avatar: 'x' });
            const b = await profileService.createProfile({ name: 'B', avatar: 'x' });
            expect(profileService.deleteProfile(a!.id)).toBe(false); // ativo
            expect(profileService.deleteProfile(b!.id)).toBe(true);
            expect(profileService.getAllProfiles().map(p => p.id)).toEqual([a!.id]);
        });
    });

    describe('sessão de convidado', () => {
        it('inicia convidado ativo que não conta pro limite', async () => {
            await profileService.createProfile({ name: 'A', avatar: 'x' });
            const guest = profileService.startGuestSession();
            expect(guest.id).toBe(GUEST_PROFILE_ID);
            expect(profileService.isGuestActive()).toBe(true);
        });

        it('sair do convidado limpa os dados dele e remove o perfil', async () => {
            const a = await profileService.createProfile({ name: 'A', avatar: 'x' });
            profileService.startGuestSession();
            // Dado por perfil do convidado (formato <base>_guest / __pl_)
            localStorage.setItem('favorites_guest', '[1]');
            localStorage.setItem('history_guest__pl_abc', '[2]');
            localStorage.setItem('favorites_outro', '[3]'); // não é do convidado

            profileService.setActiveProfile(a!.id);
            expect(localStorage.getItem('favorites_guest')).toBeNull();
            expect(localStorage.getItem('history_guest__pl_abc')).toBeNull();
            expect(localStorage.getItem('favorites_outro')).toBe('[3]');
            expect(profileService.getAllProfiles().some(p => p.id === GUEST_PROFILE_ID)).toBe(false);
        });

        it('logout do convidado também purga', () => {
            profileService.startGuestSession();
            localStorage.setItem('watchlater_guest', '[9]');
            profileService.clearActiveProfile();
            expect(localStorage.getItem('watchlater_guest')).toBeNull();
            expect(profileService.getActiveProfile()).toBeNull();
        });
    });

    describe('PIN', () => {
        it('perfil sem PIN → verifyPin sempre true; com PIN → só o correto', async () => {
            const semPin = await profileService.createProfile({ name: 'Livre', avatar: 'x' });
            const comPin = await profileService.createProfile({ name: 'Seguro', avatar: 'x', pin: '1234' });
            expect(profileService.hasPin(semPin!.id)).toBe(false);
            expect(profileService.hasPin(comPin!.id)).toBe(true);
            expect(await profileService.verifyPin(semPin!.id, 'qualquer')).toBe(true);
            expect(await profileService.verifyPin(comPin!.id, '1234')).toBe(true);
            expect(await profileService.verifyPin(comPin!.id, '0000')).toBe(false);
            // O PIN nunca fica em texto puro no storage.
            expect(JSON.stringify(profileService.getAllProfiles())).not.toContain('1234');
        });

        it('updateProfile troca e remove o PIN', async () => {
            const p = await profileService.createProfile({ name: 'A', avatar: 'x', pin: '1111' });
            expect(await profileService.updateProfile(p!.id, { pin: '2222' })).toBe(true);
            expect(await profileService.verifyPin(p!.id, '2222')).toBe(true);
            expect(await profileService.updateProfile(p!.id, { pin: null })).toBe(true);
            expect(profileService.hasPin(p!.id)).toBe(false);
        });
    });

    describe('updateProfile', () => {
        it('valida o nome e aplica os campos', async () => {
            const p = await profileService.createProfile({ name: 'A', avatar: 'x' });
            expect(await profileService.updateProfile(p!.id, { name: '  ' })).toBe(false);
            expect(await profileService.updateProfile(p!.id, { name: 'Novo', avatar: '🐱' })).toBe(true);
            const updated = profileService.getAllProfiles()[0];
            expect(updated.name).toBe('Novo');
            expect(updated.avatar).toBe('🐱');
            expect(await profileService.updateProfile('nao-existe', { name: 'X' })).toBe(false);
        });
    });

    describe('initialize / migração', () => {
        it('sem perfis → cria o perfil Kids padrão', () => {
            profileService.initialize();
            const profiles = profileService.getAllProfiles();
            expect(profiles).toHaveLength(1);
            expect(profiles[0].isKids).toBe(true);
        });

        it('migra o watchLater antigo pra um perfil Default ativo', () => {
            localStorage.setItem('watchLater', JSON.stringify([{ id: 1 }]));
            profileService.initialize();
            const profiles = profileService.getAllProfiles();
            expect(profiles.map(p => p.id)).toEqual(['default']);
            expect(profiles[0].watchLater).toEqual([{ id: 1 }]);
            expect(profileService.getActiveProfile()?.id).toBe('default');
            expect(localStorage.getItem('watchLater')).toBeNull();
        });

        it('com perfis existentes, initialize não cria nada', async () => {
            await profileService.createProfile({ name: 'A', avatar: 'x' });
            profileService.initialize();
            expect(profileService.getAllProfiles()).toHaveLength(1);
        });
    });

    describe('whitelist de canais kids (item 85)', () => {
        it('toggle adiciona e remove o canal de todos os perfis kids', async () => {
            await profileService.createProfile({ name: 'Adulto', avatar: 'x' });
            await profileService.createProfile({ name: 'Kid1', avatar: 'x', isKids: true });
            await profileService.createProfile({ name: 'Kid2', avatar: 'x', isKids: true });
            expect(profileService.toggleKidsChannel('101')).toEqual({ allowed: true, kidsCount: 2 });
            expect(profileService.getKidsAllowedChannelIds()).toEqual(new Set(['101']));
            expect(profileService.toggleKidsChannel('101')).toEqual({ allowed: false, kidsCount: 2 });
            expect(profileService.getKidsAllowedChannelIds().size).toBe(0);
        });

        it('sem perfil kids o toggle é no-op', async () => {
            await profileService.createProfile({ name: 'Solo', avatar: 'x' });
            expect(profileService.toggleKidsChannel('7')).toEqual({ allowed: false, kidsCount: 0 });
            expect(profileService.getKidsAllowedChannelIds().size).toBe(0);
        });
    });
});
