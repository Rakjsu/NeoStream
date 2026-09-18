import { describe, it, expect, beforeEach } from 'vitest';
import { profileService } from './profileService';

/**
 * 👶 `UpdateProfileData` declara `isKids` e o `createProfile` ja grava o campo,
 * mas o `updateProfile` aplicava so name/avatar/pin/preferredQuality/accentColor:
 * o `isKids` era descartado em silencio E a chamada ainda devolvia `true`.
 *
 * Consequencia para quem usa: nao existia NENHUM caminho para transformar um
 * perfil existente em infantil (nem para desfazer), nem para ter um segundo
 * perfil infantil ao lado do `kids-default` que o primeiro boot cria.
 *
 * Teste comportamental: roda o servico de verdade sobre o localStorage do jsdom
 * e le o perfil de volta do storage.
 */
describe('updateProfile / isKids', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    const lido = (id: string) => profileService.getAllProfiles().find(p => p.id === id)!;

    it('transforma um perfil existente em infantil', async () => {
        const p = await profileService.createProfile({ name: 'Filho', avatar: '🧒' });
        expect(lido(p!.id).isKids).toBe(false);

        expect(await profileService.updateProfile(p!.id, { isKids: true })).toBe(true);
        expect(lido(p!.id).isKids).toBe(true);
    });

    it('grava no storage, nao so no objeto em memoria', async () => {
        const p = await profileService.createProfile({ name: 'Filho', avatar: '🧒' });
        await profileService.updateProfile(p!.id, { isKids: true });

        const bruto = JSON.parse(localStorage.getItem('neostream_profiles')!) as {
            profiles: { id: string; isKids?: boolean }[];
        };
        expect(bruto.profiles.find(x => x.id === p!.id)?.isKids).toBe(true);
    });

    it('permite um SEGUNDO perfil infantil ao lado do kids-default', async () => {
        profileService.initialize(); // cria o kids-default
        const extra = await profileService.createProfile({ name: 'Irma', avatar: '👧' });
        await profileService.updateProfile(extra!.id, { isKids: true });

        const kids = profileService.getAllProfiles().filter(p => p.isKids);
        expect(kids.map(p => p.name).sort()).toEqual(['Irma', 'Kids']);
    });

    it('desfaz a conversao e larga a whitelist de canais do modo infantil', async () => {
        const p = await profileService.createProfile({ name: 'Filho', avatar: '🧒' });
        await profileService.updateProfile(p!.id, { isKids: true });

        profileService.toggleKidsChannel('canal-1');
        expect(lido(p!.id).allowedChannelIds).toEqual(['canal-1']);

        expect(await profileService.updateProfile(p!.id, { isKids: false })).toBe(true);
        expect(lido(p!.id).isKids).toBe(false);
        expect(lido(p!.id).allowedChannelIds).toBeUndefined();
        expect(profileService.getKidsAllowedChannelIds().size).toBe(0);
    });

    // Sobrevivente da bateria de mutacao: trocar o descarte condicional por um
    // `delete` seco passava por todos os outros testes. So a PROMOCAO estava
    // sem guarda — e ela nao pode apagar nada.
    it('promover nao mexe na whitelist; so a despromocao a larga', async () => {
        const p = await profileService.createProfile({ name: 'Filho', avatar: '🧒' });
        await profileService.updateProfile(p!.id, { isKids: true });
        profileService.toggleKidsChannel('canal-1');

        // De novo infantil: idempotente, e sem destruir o que ja estava gravado.
        expect(await profileService.updateProfile(p!.id, { isKids: true })).toBe(true);
        expect(lido(p!.id).allowedChannelIds).toEqual(['canal-1']);
        expect(profileService.getKidsAllowedChannelIds().has('canal-1')).toBe(true);
    });

    it('update sem `isKids` nao mexe no que ja estava la', async () => {
        const p = await profileService.createProfile({ name: 'Filho', avatar: '🧒', isKids: true });
        await profileService.updateProfile(p!.id, { name: 'Filha' });
        expect(lido(p!.id).name).toBe('Filha');
        expect(lido(p!.id).isKids).toBe(true);
    });
});
