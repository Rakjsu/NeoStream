/**
 * Custo de leitura do estado do usuário POR CARD da grade.
 *
 * Uma janela típica de Filmes/Séries monta ~60 cards, e cada card consultava
 * favoritos, ver-depois e progresso — cada consulta reparseando o blob inteiro
 * do localStorage. Este arquivo trava o custo: uma leva de consultas não pode
 * custar mais de um parse por lista.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./traktService', () => ({
    traktWatchlistAdd: () => Promise.resolve(false),
    traktWatchlistRemove: () => Promise.resolve(false),
    syncTraktMovieWatched: () => Promise.resolve(false)
}));

let playlistId = 'plA';
vi.mock('./activePlaylistService', () => ({
    getActivePlaylistId: () => playlistId,
    hasKnownPlaylistId: () => playlistId !== 'default',
    playlistScopedKey: (base: string, profileId: string) => `${base}_${profileId}__pl_${playlistId}`
}));

import { favoritesService } from './favoritesService';
import { watchLaterService } from './watchLater';
import { movieProgressService } from './movieProgressService';
import { watchProgressService } from './watchProgressService';
import { resetStorageJsonCache } from './storageJsonCache';

const PROFILE = 'p1';
const CARDS = 60;

function seed() {
    localStorage.setItem('neostream_profiles', JSON.stringify({
        profiles: [{ id: PROFILE, name: 'User', avatar: '🙂' }],
        activeProfileId: PROFILE
    }));
    localStorage.setItem(
        `neostream_profile_${PROFILE}__pl_${playlistId}`,
        JSON.stringify({
            favorites: Array.from({ length: 300 }, (_, i) => ({
                id: String(1000 + i), type: 'movie', title: `Filme ${i}`, poster: '', addedAt: '2026-01-01'
            }))
        })
    );
    localStorage.setItem(
        `neostream_watchlater_${PROFILE}__pl_${playlistId}`,
        JSON.stringify(Array.from({ length: 200 }, (_, i) => ({
            id: String(1000 + i), type: 'movie', name: `Filme ${i}`, addedAt: '2026-01-01'
        })))
    );
    localStorage.setItem(
        `movie_watch_progress_${PROFILE}__pl_${playlistId}`,
        JSON.stringify(Array.from({ length: 500 }, (_, i) => ({
            movieId: String(1000 + i), movieName: `Filme ${i}`, profileId: PROFILE,
            currentTime: 100, duration: 6000, progress: 1.6, watchedAt: 1, completed: false
        })))
    );
    localStorage.setItem(
        `series_watch_progress_${PROFILE}__pl_${playlistId}`,
        JSON.stringify(Array.from({ length: 400 }, (_, i) => ({
            seriesId: String(3000 + (i % 100)), seasonNumber: 1 + (i % 4), episodeNumber: 1 + (i % 10),
            profileId: PROFILE, watchedAt: i, completed: false
        })))
    );
}

describe('custo de leitura por card da grade', () => {
    beforeEach(() => {
        localStorage.clear();
        resetStorageJsonCache();
        playlistId = 'plA';
        seed();
    });
    afterEach(() => vi.restoreAllMocks());

    it('60 cards de Filmes custam no máximo um parse por lista', () => {
        // Aquece (a primeira leitura de cada blob paga o parse).
        favoritesService.has('1000', 'movie');
        watchLaterService.has('1000', 'movie');
        movieProgressService.getMoviePositionById('1000');

        const spy = vi.spyOn(JSON, 'parse');
        for (let card = 0; card < CARDS; card++) {
            const id = String(1000 + card);
            movieProgressService.getMoviePositionById(id);
            movieProgressService.getMoviePositionById(id);
            watchLaterService.has(id, 'movie');
            favoritesService.has(id, 'movie');
        }
        // Antes: ~13 parses POR CARD (perfil + cada blob, várias vezes).
        expect(spy.mock.calls.length).toBe(0);
    });

    it('60 cards de Séries custam no máximo um parse por lista', () => {
        favoritesService.has('3000', 'series');
        watchLaterService.has('3000', 'series');
        watchProgressService.getSeriesProgress('3000', 'x');

        const spy = vi.spyOn(JSON, 'parse');
        for (let card = 0; card < CARDS; card++) {
            const id = String(3000 + (card % 100));
            watchLaterService.has(id, 'series');
            favoritesService.has(id, 'series');
            watchProgressService.getSeriesProgress(id, `Série ${card % 100}`);
        }
        expect(spy.mock.calls.length).toBe(0);
    });

    it('o índice de progresso de filmes é O(1) e reflete uma gravação nova', () => {
        const index = movieProgressService.getProgressIndex();
        expect(index.get('1200')?.movieName).toBe('Filme 200');
        // Mesma identidade enquanto o localStorage não muda.
        expect(movieProgressService.getProgressIndex()).toBe(index);

        movieProgressService.saveMovieTime('1200', 'Filme 200', 3000, 6000);
        const refreshed = movieProgressService.getProgressIndex();
        expect(refreshed).not.toBe(index);
        expect(refreshed.get('1200')?.currentTime).toBe(3000);
    });

    it('o índice de séries resume episódios como o getSeriesProgress antigo', () => {
        const index = watchProgressService.getSeriesProgressIndex();
        const direct = watchProgressService.getSeriesProgress('3000', 'Série 0');
        const fromIndex = index.get('3000');
        expect(direct).toEqual({ ...fromIndex, seriesName: 'Série 0' });
        // 400 episódios distribuídos em 100 séries = 4 por série.
        expect(fromIndex?.episodeCount).toBe(4);
        // O último assistido é o de maior watchedAt (i = 300 para a série 3000).
        expect(fromIndex?.lastWatchedAt).toBe(300);
    });
});
