import { describe, it, expect, beforeEach } from 'vitest';
import { profileService } from './profileService';
import { watchLaterService } from './watchLater';
import { hashPinLegado } from './pinCrypto';
import type { Profile } from '../types/profile';

/**
 * O PIN do perfil era SHA-256 do PIN puro — com o comentário "for demo" ainda
 * no código. Um PIN de 4 dígitos tem 10 mil possibilidades: sem sal, o hash é
 * o MESMO em toda instalação do app, então uma tabela de 10 mil entradas serve
 * para qualquer usuário. E dois perfis com o mesmo PIN ficavam com hashes
 * idênticos, entregando a informação de graça.
 *
 * A migração acontece na LEITURA, no acerto do PIN: é o único instante em que
 * o app conhece o PIN em texto.
 */
const STORAGE_KEY = 'neostream_profiles';

function lerPerfis(): Profile[] {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"profiles":[]}').profiles;
}

function gravarPerfis(profiles: Profile[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles, activeProfileId: profiles[0]?.id }));
}

describe('PIN do perfil: sal por perfil', () => {
    beforeEach(() => localStorage.clear());

    it('perfil novo nasce salgado', async () => {
        const criado = await profileService.createProfile({ name: 'Ana', avatar: '🦊', pin: '1234' });
        expect(criado).not.toBeNull();

        const [perfil] = lerPerfis();
        expect(perfil.pin).toMatch(/^[0-9a-f]{64}$/);
        expect(perfil.pinSalt).toMatch(/^[0-9a-f]{32}$/);
        // O que importa: não é mais o hash sem sal, que é igual em todo lugar.
        expect(perfil.pin).not.toBe(await hashPinLegado('1234'));
    });

    it('dois perfis com o MESMO PIN têm hashes diferentes', async () => {
        await profileService.createProfile({ name: 'Ana', avatar: '🦊', pin: '1234' });
        await profileService.createProfile({ name: 'Bia', avatar: '🐼', pin: '1234' });

        const [a, b] = lerPerfis();
        expect(a.pinSalt).not.toBe(b.pinSalt);
        expect(a.pin).not.toBe(b.pin);
    });

    it('trocar o PIN sorteia um sal novo', async () => {
        const criado = await profileService.createProfile({ name: 'Ana', avatar: '🦊', pin: '1234' });
        const salAntes = lerPerfis()[0].pinSalt;

        await profileService.updateProfile(criado!.id, { pin: '5678' });
        expect(lerPerfis()[0].pinSalt).not.toBe(salAntes);
    });

    it('remover o PIN leva o sal junto — sal órfão não fica pra trás', async () => {
        const criado = await profileService.createProfile({ name: 'Ana', avatar: '🦊', pin: '1234' });
        await profileService.updateProfile(criado!.id, { pin: null });

        const [perfil] = lerPerfis();
        expect(perfil.pin).toBeUndefined();
        expect(perfil.pinSalt).toBeUndefined();
    });
});

describe('PIN do perfil: migração do formato antigo', () => {
    beforeEach(() => localStorage.clear());

    async function perfilLegado(pin: string): Promise<Profile> {
        const perfil = {
            id: 'p1', name: 'Antigo', avatar: '🦊',
            pin: await hashPinLegado(pin),
            watchLater: [], continueWatching: [],
            createdAt: '2026-01-01T00:00:00.000Z', lastUsed: '2026-01-01T00:00:00.000Z',
        } as Profile;
        gravarPerfis([perfil]);
        return perfil;
    }

    it('o PIN antigo continua valendo', async () => {
        await perfilLegado('4321');
        expect(await profileService.verifyPin('p1', '4321')).toBe(true);
        expect(await profileService.verifyPin('p1', '0000')).toBe(false);
    });

    it('acertar o PIN antigo regrava o registro no formato salgado', async () => {
        await perfilLegado('4321');
        expect(lerPerfis()[0].pinSalt).toBeUndefined();

        await profileService.verifyPin('p1', '4321');

        const [perfil] = lerPerfis();
        expect(perfil.pinSalt).toMatch(/^[0-9a-f]{32}$/);
        expect(perfil.pin).not.toBe(await hashPinLegado('4321'));
        // E o PIN segue funcionando depois da migração.
        expect(await profileService.verifyPin('p1', '4321')).toBe(true);
    });

    it('errar o PIN não migra nada', async () => {
        await perfilLegado('4321');
        await profileService.verifyPin('p1', '9999');
        expect(lerPerfis()[0].pinSalt).toBeUndefined();
    });

    /**
     * O caso que decide o desenho: sal PRESENTE com hash no formato ANTIGO.
     * Acontece de verdade — o perfil nasce migrado numa máquina, viaja inteiro
     * pelo sync, e uma build antiga na outra ponta regrava só o `pin`.
     *
     * Decidir o formato por "existe pinSalt?" trancaria esse perfil para
     * sempre, e apagar o perfil também pede o PIN. Por isso o critério é "o
     * hash salgado bateu?", com o legado como segunda tentativa.
     */
    it('sal presente com hash antigo (versão mista) não tranca o perfil', async () => {
        gravarPerfis([{
            id: 'p1', name: 'Misto', avatar: '🦊',
            pin: await hashPinLegado('4321'),
            pinSalt: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', // sal de outro hash
            watchLater: [], continueWatching: [],
            createdAt: '2026-01-01T00:00:00.000Z', lastUsed: '2026-01-01T00:00:00.000Z',
        } as Profile]);

        expect(await profileService.verifyPin('p1', '4321')).toBe(true);
        // E o registro é consertado: o sal passa a ser o do hash que está lá.
        expect(lerPerfis()[0].pinSalt).not.toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        expect(await profileService.verifyPin('p1', '4321')).toBe(true);
    });

    it('perfil sem PIN nenhum continua liberado', async () => {
        gravarPerfis([{
            id: 'p1', name: 'Livre', avatar: '🦊',
            watchLater: [], continueWatching: [],
            createdAt: '2026-01-01T00:00:00.000Z', lastUsed: '2026-01-01T00:00:00.000Z',
        } as Profile]);
        expect(await profileService.verifyPin('p1', 'qualquer')).toBe(true);
    });
});

describe('o sal sobrevive a quem reescreve o blob de perfis', () => {
    beforeEach(() => localStorage.clear());

    /**
     * `watchLater.saveProfile` regrava `neostream_profiles` inteiro por fora do
     * profileService. Se alguém trocar aquele `.map()` por um pick de campos, o
     * sal some em silêncio e todo perfil migrado fica trancado.
     */
    it('salvar pelo watchLater preserva o pinSalt', async () => {
        const criado = await profileService.createProfile({ name: 'Ana', avatar: '🦊', pin: '1234' });
        const salAntes = lerPerfis()[0].pinSalt;
        expect(salAntes).toBeTruthy();

        watchLaterService.saveProfile(lerPerfis()[0]);

        expect(lerPerfis()[0].pinSalt).toBe(salAntes);
        expect(await profileService.verifyPin(criado!.id, '1234')).toBe(true);
    });
});
