import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Perfil ativo controlável: o espelho decide por ele (nome + isKids).
let active: { id: string; name: string; isKids?: boolean; isGuest?: boolean } | null =
    { id: 'p1', name: 'Rafael' };
vi.mock('./profileService', () => ({
    profileService: {
        getActiveProfile: () => active
    }
}));

vi.mock('./activePlaylistService', () => ({
    getActivePlaylistId: () => 'plA',
    hasKnownPlaylistId: () => true,
    playlistScopedKey: (base: string, profileId: string) => `${base}_${profileId}__pl_plA`
}));

// O sync de "visto" com o Trakt não interessa aqui (e não pode sair na rede).
vi.mock('./traktService', () => ({
    syncTraktMovieWatched: vi.fn(async () => false)
}));

import {
    acceptsRemoteProfile, applyRemoteEpisodeProgress, applyRemoteMovieProgress,
    profileSyncTag, remoteSampleWins, SYNC_SKEW_TOLERANCE_MS
} from './progressSyncService';
import { movieProgressService } from './movieProgressService';
import { watchProgressService } from './watchProgressService';

// Relógio do PC ADIANTADO em relação ao do celular (acima da tolerância de
// skew) — era isso que congelava o "continuar assistindo" do PC na primeira
// amostra do celular.
const PHONE_NOW = 1_700_000_000_000;
const PC_NOW = PHONE_NOW + 10 * 60_000;

describe('remoteSampleWins — regra única de conflito', () => {
    it('sem progresso local a amostra remota entra', () => {
        expect(remoteSampleWins(null, { position: 600, updatedAt: 1000 })).toBe(true);
    });

    it('fora da tolerância vale o carimbo de ORIGEM mais novo', () => {
        const local = { position: 2400, updatedAt: 1_000_000 };
        // Rever do início semanas depois: posição menor, amostra muito mais nova.
        expect(remoteSampleWins(local, { position: 600, updatedAt: 1_000_000 + SYNC_SKEW_TOLERANCE_MS + 1 })).toBe(true);
        expect(remoteSampleWins(local, { position: 3000, updatedAt: 1_000_000 - SYNC_SKEW_TOLERANCE_MS - 1 })).toBe(false);
    });

    it('dentro da tolerância (skew) vence a maior posição', () => {
        const local = { position: 900, updatedAt: 5000 };
        expect(remoteSampleWins(local, { position: 600, updatedAt: 5001 })).toBe(false);
        expect(remoteSampleWins(local, { position: 1200, updatedAt: 4999 })).toBe(true);
    });
});

describe('identidade de perfil no espelho de progresso', () => {
    it('profileSyncTag: nome, convidado e kids sem nome', () => {
        expect(profileSyncTag({ id: 'p1', name: 'Rafael' })).toBe('rafael');
        expect(profileSyncTag({ id: 'guest', name: 'Convidado' })).toBe('guest');
        expect(profileSyncTag({ id: 'p2', name: '', isKids: true })).toBe('kids');
        expect(profileSyncTag(null)).toBe('');
    });

    it('acceptsRemoteProfile: mesmo perfil passa, nomeados diferentes não', () => {
        expect(acceptsRemoteProfile('rafael', { tag: 'rafael', kids: false })).toBe(true);
        expect(acceptsRemoteProfile('maria', { tag: 'rafael', kids: false })).toBe(false);
    });

    it('acceptsRemoteProfile: perfil infantil só aceita o próprio (nem peer antigo)', () => {
        expect(acceptsRemoteProfile('rafael', { tag: 'kids', kids: true })).toBe(false);
        expect(acceptsRemoteProfile(undefined, { tag: 'kids', kids: true })).toBe(false);
        expect(acceptsRemoteProfile('kids', { tag: 'kids', kids: true })).toBe(true);
    });

    it('acceptsRemoteProfile: um perfil só de cada lado continua sincronizando', () => {
        expect(acceptsRemoteProfile(undefined, { tag: '', kids: false })).toBe(true);
        expect(acceptsRemoteProfile('rafael', { tag: '', kids: false })).toBe(true);
        expect(acceptsRemoteProfile('', { tag: 'rafael', kids: false })).toBe(true);
    });
});

describe('espelho de progresso vindo do celular', () => {
    beforeEach(() => {
        localStorage.clear();
        active = { id: 'p1', name: 'Rafael' };
        vi.useFakeTimers();
        vi.setSystemTime(PC_NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const amostra = (positionSec: number, updatedAt: number, profile?: string) =>
        ({ positionSec, durationSec: 6000, updatedAt, profile });

    // Cenário do audit: o PC carimbava Date.now() ao aplicar o push, jogando
    // fora o updatedAt do celular. Com o PC 10 s adiantado, TODA amostra
    // seguinte falhava o LWW e o card do PC ficava travado na primeira.
    it('o card do PC acompanha todas as amostras mesmo com o PC adiantado', () => {
        vi.setSystemTime(PC_NOW - 86_400_000); // sessão de ontem no PC
        movieProgressService.saveMovieTime('m1', 'Filme', 100, 6000);
        vi.setSystemTime(PC_NOW);
        for (let i = 0; i < 5; i++) {
            applyRemoteMovieProgress('m1', 'Filme', amostra(600 + i * 5, PHONE_NOW + i * 5000, 'rafael'));
        }
        const local = movieProgressService.getMoviePositionById('m1');
        expect(local?.currentTime).toBe(620);
        // Carimbo de ORIGEM persistido — é o que faz a próxima amostra passar.
        expect(local?.watchedAt).toBe(PHONE_NOW + 20_000);
    });

    it('amostra atrasada não puxa o card do PC pra trás', () => {
        movieProgressService.saveMovieTime('m1', 'Filme', 900, 6000);
        expect(applyRemoteMovieProgress('m1', 'Filme', amostra(600, PC_NOW + 1, 'rafael'))).toBe(false);
        expect(movieProgressService.getMoviePositionById('m1')?.currentTime).toBe(900);
    });

    // O desempate de episódio era "maior posição vence": rever do início no
    // celular era descartado por ser MENOR e os dois espelhos divergiam.
    it('rever o episódio do início no celular atualiza o PC', () => {
        watchProgressService.saveVideoTime('s1', 2, 5, 2400, 3000); // 40 min vistos aqui
        const semanasDepois = PC_NOW + 30 * 86_400_000;
        expect(applyRemoteEpisodeProgress('s1', 2, 5, { positionSec: 600, durationSec: 3000, updatedAt: semanasDepois, profile: 'rafael' })).toBe(true);
        const local = watchProgressService.getEpisodeProgress('s1', 2, 5);
        expect(local?.currentTime).toBe(600);
        expect(local?.watchedAt).toBe(semanasDepois);
    });

    it('episódio: amostra velha do celular não desfaz o progresso daqui', () => {
        watchProgressService.saveVideoTime('s1', 2, 5, 2400, 3000);
        const antes = PC_NOW - 30 * 86_400_000;
        expect(applyRemoteEpisodeProgress('s1', 2, 5, { positionSec: 600, durationSec: 3000, updatedAt: antes, profile: 'rafael' })).toBe(false);
        expect(watchProgressService.getEpisodeProgress('s1', 2, 5)?.currentTime).toBe(2400);
    });

    // 🚸 O que a criança assiste no celular não pode entrar no perfil do adulto
    // (nem o filme de terror do adulto no perfil dela, no sentido inverso).
    it('perfil infantil ativo aqui recusa amostra de outro perfil', () => {
        active = { id: 'kids-default', name: 'Kids', isKids: true };
        expect(applyRemoteMovieProgress('m1', 'Terror', amostra(600, PHONE_NOW, 'rafael'))).toBe(false);
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();
    });

    it('perfil infantil ativo aqui recusa até peer sem identidade', () => {
        active = { id: 'kids-default', name: 'Kids', isKids: true };
        expect(applyRemoteMovieProgress('m1', 'Terror', amostra(600, PHONE_NOW))).toBe(false);
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();
    });

    it('perfis nomeados diferentes não se misturam', () => {
        expect(applyRemoteMovieProgress('m1', 'Filme', amostra(600, PHONE_NOW, 'maria'))).toBe(false);
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();
    });

    it('um perfil só de cada lado (peer sem o campo) segue sincronizando', () => {
        expect(applyRemoteMovieProgress('m1', 'Filme', amostra(600, PHONE_NOW))).toBe(true);
        expect(movieProgressService.getMoviePositionById('m1')?.currentTime).toBe(600);
    });
});
