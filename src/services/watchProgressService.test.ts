import { describe, it, expect, beforeEach, vi } from 'vitest';

let activeId: string | null = 'p1';
vi.mock('./profileService', () => ({
    profileService: {
        getActiveProfile: () => (activeId ? { id: activeId } : null)
    }
}));

let playlistId = 'plA';
vi.mock('./activePlaylistService', () => ({
    getActivePlaylistId: () => playlistId,
    hasKnownPlaylistId: () => playlistId !== 'default',
    playlistScopedKey: (base: string, profileId: string) =>
        `${base}_${profileId}__pl_${playlistId}`
}));

import { watchProgressService, type EpisodeProgress } from './watchProgressService';

describe('watchProgressService — per-playlist scoping', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('progress under playlist A is not visible under B; back under A it returns', () => {
        playlistId = 'plA';
        watchProgressService.markEpisodeWatched('s1', 1, 1);
        expect(watchProgressService.isEpisodeWatched('s1', 1, 1)).toBe(true);

        playlistId = 'plB';
        expect(watchProgressService.isEpisodeWatched('s1', 1, 1)).toBe(false);
        expect(watchProgressService.getEpisodeHistory()).toEqual([]);

        playlistId = 'plA';
        expect(watchProgressService.isEpisodeWatched('s1', 1, 1)).toBe(true);
        expect(localStorage.getItem('series_watch_progress_p1__pl_plA')).toBeTruthy();
        expect(localStorage.getItem('series_watch_progress_p1__pl_plB')).toBeNull();
    });
});

describe('watchProgressService — per-profile → per-playlist migration', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    const ep = (over: Partial<EpisodeProgress> = {}): EpisodeProgress => ({
        seriesId: 's1', seasonNumber: 1, episodeNumber: 1, profileId: 'p1',
        watchedAt: 1000, completed: true, ...over
    });

    it('copies the legacy per-profile key into the active playlist scope, then removes it', () => {
        localStorage.setItem('series_watch_progress_p1', JSON.stringify([ep()]));

        expect(watchProgressService.isEpisodeWatched('s1', 1, 1)).toBe(true);

        expect(localStorage.getItem('series_watch_progress_p1')).toBeNull();
        const scoped = JSON.parse(localStorage.getItem('series_watch_progress_p1__pl_plA')!);
        expect(scoped).toHaveLength(1);
    });

    it('is idempotent and does not clobber existing scoped data', () => {
        localStorage.setItem('series_watch_progress_p1__pl_plA', JSON.stringify([ep({ seriesId: 'keep' })]));
        localStorage.setItem('series_watch_progress_p1', JSON.stringify([ep({ seriesId: 'old' })]));

        watchProgressService.getEpisodeHistory();
        watchProgressService.getEpisodeHistory();

        expect(localStorage.getItem('series_watch_progress_p1')).toBeNull();
        const scoped = JSON.parse(localStorage.getItem('series_watch_progress_p1__pl_plA')!);
        expect(scoped.map((e: EpisodeProgress) => e.seriesId)).toEqual(['keep']);
    });

    it('is skipped while the active playlist id is unknown (default fallback)', () => {
        playlistId = 'default';
        localStorage.setItem('series_watch_progress_p1', JSON.stringify([ep()]));

        watchProgressService.getEpisodeHistory();

        expect(localStorage.getItem('series_watch_progress_p1')).toBeTruthy();
        expect(localStorage.getItem('series_watch_progress_p1__pl_default')).toBeNull();
    });
});

// 🔒 Regressão: um recoverMediaError do hls.js zera currentTime e deixa duration
// NaN; sem guarda, `0 >= 0 * 0.9` marcava o episódio como concluído e ele sumia
// do "continuar de onde parou".
describe('watchProgressService — saveVideoTime ignora duração inválida', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('duration 0 ou NaN não grava nada (não marca como concluído)', () => {
        watchProgressService.saveVideoTime('s9', 1, 3, 0, 0);
        watchProgressService.saveVideoTime('s9', 1, 3, 0, Number.NaN);
        watchProgressService.saveVideoTime('s9', 1, 3, 10, -1);

        expect(watchProgressService.getEpisodeProgress('s9', 1, 3)).toBeFalsy();
        expect(watchProgressService.isEpisodeWatched('s9', 1, 3)).toBe(false);
    });

    it('duração válida continua gravando o progresso normalmente', () => {
        watchProgressService.saveVideoTime('s9', 1, 3, 300, 1200);
        const p = watchProgressService.getEpisodeProgress('s9', 1, 3);
        expect(p?.currentTime).toBe(300);
        expect(p?.duration).toBe(1200);
    });

    it('progresso salvo antes não é destruído por um timeupdate com duration 0', () => {
        watchProgressService.saveVideoTime('s9', 2, 1, 600, 2400);
        watchProgressService.saveVideoTime('s9', 2, 1, 0, 0);
        expect(watchProgressService.getEpisodeProgress('s9', 2, 1)?.currentTime).toBe(600);
    });
});

/**
 * 🏆 "Séries Finalizadas" é item de menu e selo de card — e `isSeriesCompleted`
 * devolvia `false` cravado, então a categoria abria sempre vazia, o ✓ nunca
 * desenhava e a barra de progresso continuava aparecendo em série terminada.
 *
 * O total vem do vigia de novos episódios, na MESMA chave por (perfil,
 * playlist) do progresso — aqui o mock compõe `${base}_${perfil}__pl_${playlist}`.
 */
describe('watchProgressService — série concluída', () => {
    const gravarTotal = (total: number, playlist = 'plA') => {
        localStorage.setItem(
            `series_episode_data_p1__pl_${playlist}`,
            JSON.stringify({ s1: { lastKnownEpisodes: total } })
        );
    };

    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
    });

    it('vista até o fim, a série conta como concluída', () => {
        gravarTotal(3);
        watchProgressService.markEpisodeWatched('s1', 1, 1);
        watchProgressService.markEpisodeWatched('s1', 1, 2);
        watchProgressService.markEpisodeWatched('s1', 1, 3);

        expect(watchProgressService.isSeriesCompleted('s1')).toBe(true);
    });

    it('amostra parcial não vira série concluída', () => {
        // A armadilha de "todo episódio REGISTRADO está completo": com 1 de 10
        // vistos, a série sumiria do "Continuar assistindo" e ganharia o ✓.
        gravarTotal(10);
        watchProgressService.markEpisodeWatched('s1', 1, 1);

        expect(watchProgressService.isSeriesCompleted('s1')).toBe(false);
    });

    it('sem total conhecido, não arrisca', () => {
        // M3U e Stalker nunca ganham total; e mesmo no Xtream a primeira
        // varredura só acontece alguns segundos depois de abrir o app.
        watchProgressService.markEpisodeWatched('s1', 1, 1);
        expect(watchProgressService.isSeriesCompleted('s1')).toBe(false);

        gravarTotal(0);
        expect(watchProgressService.isSeriesCompleted('s1')).toBe(false);
    });

    it('o total de uma playlist não vale para a outra', () => {
        // `series_id` do Xtream é um inteiro por provedor e colide entre
        // playlists. Com a chave só por perfil, o total da A marcaria a série
        // de mesmo id da B como concluída — falso positivo, pior que o bug.
        gravarTotal(3, 'plA');

        playlistId = 'plB';
        watchProgressService.markEpisodeWatched('s1', 1, 1);
        watchProgressService.markEpisodeWatched('s1', 1, 2);
        watchProgressService.markEpisodeWatched('s1', 1, 3);

        expect(watchProgressService.isSeriesCompleted('s1')).toBe(false);
    });

    it('episódio deixado pela metade não conta como concluído', () => {
        gravarTotal(3);
        watchProgressService.markEpisodeWatched('s1', 1, 1);
        watchProgressService.markEpisodeWatched('s1', 1, 2);
        watchProgressService.saveVideoTime('s1', 1, 3, 600, 1200);

        expect(watchProgressService.isSeriesCompleted('s1')).toBe(false);
    });
});
