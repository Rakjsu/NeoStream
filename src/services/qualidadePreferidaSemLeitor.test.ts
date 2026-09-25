import { describe, it, expect, beforeEach } from 'vitest';
import fonteLiveTV from '../pages/LiveTV.tsx?raw';
import { profileService } from './profileService';

/**
 * #D174 -- "qualidade preferida da TV ao vivo" era um campo que so se escrevia.
 *
 * Toda troca de qualidade no player ao vivo deduzia um rotulo (4k/fhd/hd/sd) e
 * gravava `preferredQuality` no perfil ativo -- uma escrita de perfil inteira,
 * async e sem await, dentro do handler do clique. Do outro lado ninguem lia:
 * `getPreferredQuality` nao tinha chamador e o agrupador de variantes
 * (`groupChannelVariants`) continua escolhendo o representante pela MELHOR
 * qualidade. O rotulo ainda era lixo: canal sem tag vira "SD" no
 * `findQualityVariants`, entao escolher "Globo SP" gravava 'sd'.
 *
 * Honrar a promessa trocaria o representante do grupo (e com ele o stream_id
 * que favoritos, ocultos e o guia do celular usam como chave) por causa de UMA
 * troca de qualidade feita no player. Decisao: o campo sai -- e, como o
 * `filterByTMDB` do parental (#D078), a chave aposentada e podada do blob salvo
 * no boot, pra perfil antigo, backup antigo restaurado ou perfil adotado do
 * sync de uma versao anterior nao carregarem o campo pra sempre.
 *
 * Os testes de servico rodam o profileService de verdade sobre o localStorage
 * do jsdom e leem o perfil de volta do storage cru.
 */
describe('qualidade preferida da TV ao vivo (#D174)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    type PerfilCru = Record<string, unknown>;
    const blobCru = (): { profiles: PerfilCru[]; activeProfileId: string | null } =>
        JSON.parse(localStorage.getItem('neostream_profiles') || '{"profiles":[],"activeProfileId":null}');
    const perfilCru = (id: string): PerfilCru => blobCru().profiles.find(p => p.id === id)!;
    const agora = new Date().toISOString();
    const perfil = (id: string, extra: PerfilCru = {}): PerfilCru => ({
        id, name: id, avatar: 'x', watchLater: [], continueWatching: [],
        createdAt: agora, lastUsed: agora, ...extra,
    });

    it('o servico de perfis nao oferece mais ler/gravar a qualidade preferida', () => {
        expect('setPreferredQuality' in profileService).toBe(false);
        expect('getPreferredQuality' in profileService).toBe(false);
    });

    it('updateProfile nao grava preferredQuality no perfil (ninguem le esse campo)', async () => {
        const p = await profileService.createProfile({ name: 'Sala', avatar: 'x' });
        expect(p).not.toBeNull();
        profileService.setActiveProfile(p!.id);

        // Chamador antigo mandando o campo: o resto da edicao vale, ele nao.
        const updates = { name: 'Sala 2', preferredQuality: 'sd' } as unknown as Parameters<typeof profileService.updateProfile>[1];
        expect(await profileService.updateProfile(p!.id, updates)).toBe(true);

        const salvo = perfilCru(p!.id);
        expect(salvo.name).toBe('Sala 2');
        expect('preferredQuality' in salvo).toBe(false);
    });

    it('o boot poda a chave aposentada de TODOS os perfis salvos e preserva o resto', () => {
        localStorage.setItem('neostream_profiles', JSON.stringify({
            profiles: [
                perfil('sala', { accentColor: 'verde' }),
                perfil('quarto', { preferredQuality: 'sd', isKids: true, allowedChannelIds: ['7'] }),
                perfil('escritorio', { preferredQuality: 'fhd', accentColor: 'roxo' }),
            ],
            activeProfileId: 'sala',
        }));

        profileService.initialize();

        // O perfil sai IGUAL ao que era, so sem a chave: nem perfil some, nem
        // campo vizinho vai junto.
        expect(blobCru()).toEqual({
            profiles: [
                perfil('sala', { accentColor: 'verde' }),
                perfil('quarto', { isKids: true, allowedChannelIds: ['7'] }),
                perfil('escritorio', { accentColor: 'roxo' }),
            ],
            activeProfileId: 'sala',
        });
    });

    it('sem chave aposentada o boot nao regrava o blob', () => {
        const cru = JSON.stringify({ profiles: [perfil('sala')], activeProfileId: 'sala' });
        localStorage.setItem('neostream_profiles', cru);
        let gravacoes = 0;
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
            if (k === 'neostream_profiles') gravacoes++;
            return original.call(this, k, v);
        };
        try {
            profileService.initialize();
        } finally {
            Storage.prototype.setItem = original;
        }
        expect(gravacoes).toBe(0);
        expect(localStorage.getItem('neostream_profiles')).toBe(cru);
    });

    it('trocar a qualidade no player ao vivo so troca o canal -- nao escreve no perfil', () => {
        const fonte = fonteLiveTV.replace(/\r\n/g, '\n');
        expect(fonte.includes('PreferredQuality')).toBe(false);
        expect(fonte.includes('preferredQuality')).toBe(false);
        expect(fonte.split('onSwitchQuality=').length - 1).toBe(1);
        expect(fonte.includes('onSwitchQuality={(channel: LiveStream) => setPlayingChannel(channel)}')).toBe(true);
    });
});
