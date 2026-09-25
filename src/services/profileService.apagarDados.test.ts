import { describe, it, expect, beforeEach } from 'vitest';
import { profileService } from './profileService';
import { playlistScopedKeyFor } from './activePlaylistService';
import { getProfileDailyLimitMinutes, setProfileDailyLimitMinutes } from './watchLimitsService';

// D077: a confirmação de "Excluir perfil" promete que o progresso e os
// favoritos daquele perfil serão perdidos, mas o deleteProfile só tirava a
// entrada do registro — todas as chaves por perfil ficavam no disco.

/** As chaves por perfil nos dois formatos do app, como os serviços as gravam. */
function semearDadosDoPerfil(id: string): string[] {
    const chaves = [
        playlistScopedKeyFor('neostream_profile', id, 'pl1'),        // favoritos
        playlistScopedKeyFor('neostream_watchlater', id, 'pl1'),     // Minha Lista
        playlistScopedKeyFor('movie_watch_progress', id, 'pl2'),     // progresso de filmes
        playlistScopedKeyFor('series_watch_progress', id, 'pl1'),    // progresso de séries
        `usage_stats_${id}`,
        `playbackConfig_${id}`,
        `scheduled_recordings_${id}`,
        `app_notifications_${id}`,
    ];
    chaves.forEach(chave => localStorage.setItem(chave, '{"x":1}'));
    return chaves;
}

function presentes(chaves: string[]): string[] {
    return chaves.filter(chave => localStorage.getItem(chave) !== null);
}

describe('deleteProfile apaga os dados do perfil (D077)', () => {
    beforeEach(() => localStorage.clear());

    it('some com favoritos, progresso, estatísticas e limite diário do perfil apagado', async () => {
        const dono = await profileService.createProfile({ name: 'Dono', avatar: 'x' });
        const filho = await profileService.createProfile({ name: 'Filho', avatar: 'y' });
        const doFilho = semearDadosDoPerfil(filho!.id);
        setProfileDailyLimitMinutes(filho!.id, 45);
        expect(getProfileDailyLimitMinutes(filho!.id)).toBe(45);

        expect(profileService.deleteProfile(filho!.id)).toBe(true);

        expect(presentes(doFilho)).toEqual([]);
        expect(getProfileDailyLimitMinutes(filho!.id)).toBe(0);
        // O dono continua ativo e intacto no registro.
        expect(profileService.getAllProfiles().map(p => p.id)).toEqual([dono!.id]);
    });

    it('não toca nos dados dos outros perfis nem nas chaves globais', async () => {
        const dono = await profileService.createProfile({ name: 'Dono', avatar: 'x' });
        const filho = await profileService.createProfile({ name: 'Filho', avatar: 'y' });
        const doDono = semearDadosDoPerfil(dono!.id);
        semearDadosDoPerfil(filho!.id);
        setProfileDailyLimitMinutes(dono!.id, 90);
        localStorage.setItem('neostream_theme', '{"accent":"azul"}');
        localStorage.setItem('neostream_kids_daily_limit_min', '60');

        profileService.deleteProfile(filho!.id);

        expect(presentes(doDono)).toEqual(doDono);
        expect(getProfileDailyLimitMinutes(dono!.id)).toBe(90);
        expect(localStorage.getItem('neostream_theme')).toBe('{"accent":"azul"}');
        expect(localStorage.getItem('neostream_kids_daily_limit_min')).toBe('60');
    });

    it('apagar o perfil "default" não leva a playlist "default" de outro perfil', async () => {
        // O perfil legado migrado tem id 'default' — o MESMO texto do fallback
        // de id de playlist. Um casamento solto por `_default(__pl_|$)` pegaria
        // o SUFIXO `__pl_default` das chaves do outro perfil.
        localStorage.setItem('watchLater', '[]');
        profileService.migrateExistingData();
        expect(profileService.getActiveProfile()?.id).toBe('default');
        const outro = await profileService.createProfile({ name: 'Outro', avatar: 'x' });
        profileService.setActiveProfile(outro!.id);

        const favoritosDoOutro = playlistScopedKeyFor('neostream_profile', outro!.id, 'default');
        localStorage.setItem(favoritosDoOutro, '{"favorites":[1]}');
        const doDefault = semearDadosDoPerfil('default');

        expect(profileService.deleteProfile('default')).toBe(true);

        expect(presentes(doDefault)).toEqual([]);
        expect(localStorage.getItem(favoritosDoOutro)).toBe('{"favorites":[1]}');
    });

    it('id que só termina igual (ou tem caractere de regex) não arrasta chave alheia', () => {
        // Ids vêm do storage e do sync: nada de montar RegExp com eles.
        localStorage.setItem('neostream_profiles', JSON.stringify({
            activeProfileId: 'ativo',
            profiles: [
                { id: 'ativo', name: 'Ativo' },
                { id: 'a.b', name: 'Ponto' },
                { id: 'b', name: 'B' },
                { id: 'bc', name: 'BC' },
            ],
        }));
        localStorage.setItem('usage_stats_axb', 'alheia');     // `.` de regex casaria
        localStorage.setItem('usage_stats_a.b', 'do-ponto');
        localStorage.setItem('usage_stats_ab', 'alheia');      // termina em "b", mas sem "_"
        localStorage.setItem('usage_stats_b', 'do-b');
        localStorage.setItem('usage_stats_bc', 'do-bc');      // outro id que COMEÇA com "b"

        profileService.deleteProfile('a.b');
        expect(localStorage.getItem('usage_stats_a.b')).toBeNull();
        expect(localStorage.getItem('usage_stats_axb')).toBe('alheia');

        profileService.deleteProfile('b');
        expect(localStorage.getItem('usage_stats_b')).toBeNull();
        expect(localStorage.getItem('usage_stats_ab')).toBe('alheia');
        expect(localStorage.getItem('usage_stats_bc')).toBe('do-bc');
    });

    it('id fora do registro devolve false e não apaga nada', () => {
        // Clique vindo de uma lista velha (o sync já tirou o perfil) ou id
        // vazio: sem entrada no registro não há o que prometer apagar — e um
        // id vazio casaria toda chave terminada em "_".
        localStorage.setItem('neostream_profiles', JSON.stringify({
            activeProfileId: 'ativo',
            profiles: [{ id: 'ativo', name: 'Ativo' }],
        }));
        localStorage.setItem('usage_stats_fantasma', 'fica');
        localStorage.setItem('rascunho_', 'fica');

        expect(profileService.deleteProfile('fantasma')).toBe(false);
        expect(profileService.deleteProfile('')).toBe(false);

        expect(localStorage.getItem('usage_stats_fantasma')).toBe('fica');
        expect(localStorage.getItem('rascunho_')).toBe('fica');
    });

    it('o perfil ativo continua protegido: recusa e não apaga nada', async () => {
        const dono = await profileService.createProfile({ name: 'Dono', avatar: 'x' });
        const doDono = semearDadosDoPerfil(dono!.id);

        expect(profileService.deleteProfile(dono!.id)).toBe(false);
        expect(presentes(doDono)).toEqual(doDono);
    });
});
