// 🪦 O ledger de remoções (syncTombstones) tem que cobrir o PROGRESSO, não só
// favoritos/ver-depois/perfis.
//
// Duas máquinas trocam arquivos `neostream-sync-<id>.json` numa pasta
// sincronizada. No primeiro ciclo, quem ainda NÃO tem uma chave adota a do
// outro inteira (syncMerge, ramo `localValue === undefined`) e passa a
// reexportá-la — daí em diante as duas carregam a MESMA chave de progresso.
// Se aqui o usuário tira o filme de "Continuar assistindo", dá "Recomeçar" num
// episódio ou desmarca o ✓, e o merge é só "mais novo vence por watchedAt", a
// cópia da outra máquina devolve o item no ciclo seguinte.
//
// Estes testes rodam o caminho de VERDADE: o `clear*` do serviço grava o
// carimbo e o `mergeSyncData` real o consome. Nada de casar string de fonte.
//
// O relógio é FALSO de propósito: o desempate do ledger é ao milissegundo
// ("empate perde", igual aos favoritos), então com Date.now() real a remoção e
// a remarcação podem cair no mesmo ms e o teste viraria moeda.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

vi.mock('./traktService', () => ({
    syncTraktMovieWatched: () => Promise.resolve(false)
}));

import { movieProgressService } from './movieProgressService';
import { watchProgressService } from './watchProgressService';
import { mergeSyncData } from './syncMerge';
import { TOMBSTONES_KEY } from './syncTombstones';

const CHAVE_FILMES = 'movie_watch_progress_p1__pl_plA';
const CHAVE_SERIES = 'series_watch_progress_p1__pl_plA';

/** Base do relógio falso; cada passo anda explicitamente a partir daqui. */
const T0 = Date.UTC(2026, 8, 17, 12, 0, 0);
const emT = (ms: number) => vi.setSystemTime(T0 + ms);

/** Tudo que está no localStorage — é o retrato que o App.tsx entrega ao merge. */
function retrato(): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const chave = localStorage.key(i);
        const valor = chave === null ? null : localStorage.getItem(chave);
        if (chave !== null && valor !== null) out[chave] = valor;
    }
    return out;
}

/** Um ciclo de sync: mescla o arquivo do outro PC e grava o que voltou (App.tsx). */
function cicloDeSync(remoto: Record<string, string>): void {
    const resultado = mergeSyncData(retrato(), remoto, Date.now());
    for (const [chave, valor] of Object.entries(resultado.changed)) {
        localStorage.setItem(chave, valor);
    }
}

const idsDeFilme = () =>
    (JSON.parse(localStorage.getItem(CHAVE_FILMES) ?? '[]') as { movieId: string }[])
        .map(p => p.movieId);
const idsDeEpisodio = () =>
    (JSON.parse(localStorage.getItem(CHAVE_SERIES) ?? '[]') as
        { seriesId: string; seasonNumber: number; episodeNumber: number }[])
        .map(p => `${p.seriesId}:${p.seasonNumber}:${p.episodeNumber}`);

describe('remoção de progresso não volta no sync', () => {
    beforeEach(() => {
        localStorage.clear();
        activeId = 'p1';
        playlistId = 'plA';
        vi.useFakeTimers();
        emT(0);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('filme tirado de "Continuar assistindo" não é reinserido pelo outro PC', () => {
        movieProgressService.saveMovieTime('m1', 'Filme 1', 30, 100);
        movieProgressService.saveMovieTime('m2', 'Filme 2', 40, 100);

        // O outro PC ficou com a cópia de antes da remoção.
        const remoto = retrato();
        expect(JSON.parse(remoto[CHAVE_FILMES])).toHaveLength(2);

        emT(60_000);
        movieProgressService.clearMovieProgress('m1');
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();

        emT(120_000);
        cicloDeSync(remoto);

        expect(idsDeFilme()).toEqual(['m2']);
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();
        // O carimbo é por ITEM: o que não foi apagado continua lá, intacto.
        expect(movieProgressService.getMoviePositionById('m2')?.currentTime).toBe(40);
    });

    it('reassistir o filme depois de apagar sobrevive ao ledger', () => {
        movieProgressService.saveMovieTime('m1', 'Filme 1', 30, 100);
        const remoto = retrato();

        emT(60_000);
        movieProgressService.clearMovieProgress('m1');
        emT(90_000); // reassistiu DEPOIS da remoção: carimbo novo vence
        movieProgressService.saveMovieTime('m1', 'Filme 1', 70, 100);

        emT(120_000);
        cicloDeSync(remoto);

        expect(idsDeFilme()).toEqual(['m1']);
        expect(movieProgressService.getMoviePositionById('m1')?.currentTime).toBe(70);
    });

    it('"Recomeçar" um episódio não volta atrás no ciclo seguinte', () => {
        watchProgressService.saveVideoTime('s1', 1, 2, 300, 1000);
        watchProgressService.saveVideoTime('s1', 1, 3, 100, 1000);

        const remoto = retrato();
        expect(JSON.parse(remoto[CHAVE_SERIES])).toHaveLength(2);

        emT(60_000);
        watchProgressService.clearEpisodeProgress('s1', 1, 2);
        expect(watchProgressService.getEpisodeProgress('s1', 1, 2)).toBeNull();

        emT(120_000);
        cicloDeSync(remoto);

        expect(idsDeEpisodio()).toEqual(['s1:1:3']);
        expect(watchProgressService.getEpisodeProgress('s1', 1, 2)).toBeNull();
        expect(watchProgressService.getEpisodeProgress('s1', 1, 3)?.currentTime).toBe(100);
    });

    it('desmarcar e marcar o ✓ de novo (o toggle da ficha) sobrevive ao ledger', () => {
        watchProgressService.markEpisodeWatched('s1', 1, 2);
        const remoto = retrato();

        emT(1_000);
        watchProgressService.clearEpisodeProgress('s1', 1, 2);
        expect(watchProgressService.isEpisodeWatched('s1', 1, 2)).toBe(false);
        emT(2_000); // segundo clique do toggle: marca de novo
        watchProgressService.markEpisodeWatched('s1', 1, 2);

        emT(60_000);
        cicloDeSync(remoto);

        expect(idsDeEpisodio()).toEqual(['s1:1:2']);
        expect(watchProgressService.isEpisodeWatched('s1', 1, 2)).toBe(true);
    });

    it('empate de milissegundo: a remoção vence (mesma regra dos favoritos)', () => {
        watchProgressService.saveVideoTime('s1', 1, 2, 300, 1000);
        const remoto = retrato();

        emT(60_000);
        watchProgressService.clearEpisodeProgress('s1', 1, 2);
        // Amostra carimbada no MESMO ms da remoção (só o celular, com o relógio
        // atrasado, chega nisso): o desempate é o mesmo do `isTombstoned`.
        watchProgressService.saveVideoTime('s1', 1, 2, 310, 1000, T0 + 60_000);

        emT(120_000);
        cicloDeSync(remoto);

        expect(idsDeEpisodio()).toEqual([]);
    });

    it('limpar o histórico de uma série não ressuscita nenhum episódio dela', () => {
        watchProgressService.saveVideoTime('s1', 1, 1, 200, 1000);
        watchProgressService.saveVideoTime('s1', 1, 2, 300, 1000);
        watchProgressService.saveVideoTime('s2', 1, 1, 400, 1000);

        const remoto = retrato();

        emT(60_000);
        watchProgressService.clearSeriesProgress('s1');

        emT(120_000);
        cicloDeSync(remoto);

        expect(idsDeEpisodio()).toEqual(['s2:1:1']);
        expect(watchProgressService.getEpisodeProgress('s1', 1, 1)).toBeNull();
        expect(watchProgressService.getEpisodeProgress('s1', 1, 2)).toBeNull();
        // A outra série não foi tocada.
        expect(watchProgressService.getEpisodeProgress('s2', 1, 1)?.currentTime).toBe(400);
    });

    it('chave que esta máquina não tem: a adoção não traz de volta o que o ledger condenou', () => {
        // Máquina nova (ou perfil/playlist ainda sem histórico): o ramo de
        // adoção copia a chave alheia INTEIRA, e só o ledger a filtra.
        const remoto: Record<string, string> = {
            [CHAVE_FILMES]: JSON.stringify([
                { movieId: 'm1', movieName: 'Filme 1', profileId: 'p1', currentTime: 30, duration: 100, progress: 30, watchedAt: T0, completed: false },
                { movieId: 'm2', movieName: 'Filme 2', profileId: 'p1', currentTime: 40, duration: 100, progress: 40, watchedAt: T0, completed: false },
            ]),
            [TOMBSTONES_KEY]: JSON.stringify({ [CHAVE_FILMES]: { 'm1::': T0 + 1_000 } }),
        };

        emT(60_000);
        expect(localStorage.getItem(CHAVE_FILMES)).toBeNull();
        cicloDeSync(remoto);

        expect(idsDeFilme()).toEqual(['m2']);
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();
    });

    it('remoção feita no OUTRO PC chega aqui (o ledger viaja nos dois sentidos)', () => {
        movieProgressService.saveMovieTime('m1', 'Filme 1', 30, 100);
        watchProgressService.saveVideoTime('s1', 1, 2, 300, 1000);

        // O outro PC tinha o mesmo e apagou os dois por lá. O formato da chave
        // do carimbo é contrato de FIO entre as máquinas: fixá-lo aqui é o que
        // impede produtor e consumidor de divergirem em silêncio.
        const remoto = retrato();
        remoto[TOMBSTONES_KEY] = JSON.stringify({
            [CHAVE_FILMES]: { 'm1::': T0 + 30_000 },
            [CHAVE_SERIES]: { 's1:1:2::': T0 + 30_000 },
        });

        emT(60_000);
        cicloDeSync(remoto);

        expect(idsDeFilme()).toEqual([]);
        expect(idsDeEpisodio()).toEqual([]);
        expect(movieProgressService.getMoviePositionById('m1')).toBeNull();
        expect(watchProgressService.getEpisodeProgress('s1', 1, 2)).toBeNull();
    });

    it('clearAllProgress carimba tudo (sem tela hoje; é o mecanismo que o D111 vai usar)', () => {
        watchProgressService.saveVideoTime('s1', 1, 1, 200, 1000);
        movieProgressService.saveMovieTime('m1', 'Filme 1', 30, 100);

        const remoto = retrato();

        emT(60_000);
        watchProgressService.clearAllProgress();
        movieProgressService.clearAllProgress();
        expect(localStorage.getItem(CHAVE_SERIES)).toBeNull();
        expect(localStorage.getItem(CHAVE_FILMES)).toBeNull();

        emT(120_000);
        cicloDeSync(remoto);

        expect(idsDeFilme()).toEqual([]);
        expect(idsDeEpisodio()).toEqual([]);
    });
});
