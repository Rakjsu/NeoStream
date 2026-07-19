// 🎬 Backfill do Trakt no desktop: envia o HISTÓRICO local (o que foi visto
// ANTES de conectar — o scrobble só cobre dali em diante) pro Trakt:
// filmes com progresso ≥85% ainda não sincronizados e episódios completos.
// Deduplica contra o que o Trakt já tem (sem plays duplicados) e roda em
// lotes de 30 (rate limit do Trakt) — execuções seguintes completam o resto.
import { movieProgressService } from './movieProgressService';
import { watchProgressService } from './watchProgressService';
import {
    fetchTraktWatchedMovies, fetchTraktWatchedShows, isTraktConnected,
    syncTraktEpisodeWatched, syncTraktMovieWatched, traktScrobble,
} from './traktService';

const PUSH_CAP = 30;
const DONE_KEY = 'neostream_trakt_backfill_done';

/** Nome do provedor → chave de comparação (tira ano e espaços extras). */
export function cleanTitle(name: string): string {
    return name.replace(/\s*\(\d{4}\)\s*/g, ' ').trim().toLowerCase();
}

export function episodeKey(show: string, season: number, episode: number): string {
    return `${cleanTitle(show)}|${season}|${episode}`;
}

export interface TraktBackfillReport {
    pushedMovies: number;
    pushedEpisodes: number;
    /** Fase 2: tempos parciais enviados + vistos puxados do Trakt. */
    pushedTimes: number;
    pulledMovies: number;
    pulledEpisodes: number;
    /** true quando tudo coube no lote — a flag "concluído" foi gravada. */
    complete: boolean;
}

/**
 * `auto` (boot/conexão): roda no máximo até concluir tudo uma vez — depois a
 * flag pula as próximas chamadas. O botão manual passa `force` e re-executa
 * sempre (a dedupe evita duplicar).
 */
export async function runTraktBackfill(force = false): Promise<TraktBackfillReport | null> {
    if (!isTraktConnected()) return null;
    if (!force && localStorage.getItem(DONE_KEY)) return null;

    const [traktMovies, traktEpisodes] = await Promise.all([
        fetchTraktWatchedMovies(),
        fetchTraktWatchedShows(),
    ]);
    const movieSet = new Set(traktMovies.map(cleanTitle));
    const episodeSet = new Set(traktEpisodes.map(e => episodeKey(e.show, e.season, e.episode)));

    const report: TraktBackfillReport = { pushedMovies: 0, pushedEpisodes: 0, pushedTimes: 0, pulledMovies: 0, pulledEpisodes: 0, complete: false };
    let budget = PUSH_CAP;

    // ---- Filmes ≥85% que nunca sincronizaram ----
    for (const entry of movieProgressService.getAllEntries()) {
        if (budget <= 0) break;
        if (entry.traktSynced || entry.progress < 85) continue;
        if (movieSet.has(cleanTitle(entry.movieName))) {
            // O Trakt já tem (veio de outro aparelho) — só marca localmente.
            movieProgressService.markTraktSynced(entry.movieId);
            continue;
        }
        if (await syncTraktMovieWatched(entry.movieName)) {
            movieProgressService.markTraktSynced(entry.movieId);
            report.pushedMovies++;
            budget--;
        }
    }

    // ---- Episódios completos (nome da série vem do agregado) ----
    const seriesNames = new Map<string, string>();
    watchProgressService.getContinueWatching().forEach((progress, seriesId) => {
        seriesNames.set(seriesId, progress.seriesName);
    });
    for (const ep of watchProgressService.getEpisodeHistory()) {
        if (budget <= 0) break;
        if (!ep.completed) continue;
        const show = seriesNames.get(ep.seriesId);
        if (!show) continue;
        const key = episodeKey(show, ep.seasonNumber, ep.episodeNumber);
        if (episodeSet.has(key)) continue;
        if (await syncTraktEpisodeWatched(show, ep.seasonNumber, ep.episodeNumber)) {
            episodeSet.add(key);
            report.pushedEpisodes++;
            budget--;
        }
    }

    // ---- Fase 2: tempos parciais (filme na metade) viram playback no Trakt ----
    let pauseBudget = 10;
    for (const entry of movieProgressService.getAllEntries()) {
        if (pauseBudget <= 0) break;
        if (entry.traktSynced || entry.progress < 5 || entry.progress >= 85) continue;
        if (await traktScrobble({ kind: 'movie', title: entry.movieName }, 'pause', Math.round(entry.progress))) {
            report.pushedTimes++;
            pauseBudget--;
        }
    }

    // ---- Fase 2 PULL: filmes vistos no Trakt viram vistos locais ----
    try {
        const vodResult = await window.ipcRenderer.invoke('streams:get-vod', {}) as {
            success?: boolean; data?: { stream_id: number | string; name: string }[];
        };
        for (const movie of vodResult?.data ?? []) {
            if (!movieSet.has(cleanTitle(movie.name))) continue;
            movieProgressService.markWatchedFromTrakt(String(movie.stream_id), movie.name);
            report.pulledMovies++;
        }
    } catch { /* catálogo indisponível — fica pra próxima rodada */ }

    // ---- Fase 2 PULL: episódios vistos no Trakt viram vistos locais ----
    if (traktEpisodes.length > 0) {
        try {
            const seriesResult = await window.ipcRenderer.invoke('streams:get-series', {}) as {
                success?: boolean; data?: { series_id: number | string; name: string }[];
            };
            const seriesList = seriesResult?.data ?? [];
            const byShow = new Map<string, { season: number; episode: number }[]>();
            for (const ep of traktEpisodes) {
                const key = cleanTitle(ep.show);
                const list = byShow.get(key) ?? [];
                list.push({ season: ep.season, episode: ep.episode });
                byShow.set(key, list);
            }
            let showBudget = 15;
            for (const [showName, eps] of byShow) {
                if (showBudget <= 0) break;
                const show = seriesList.find(candidate =>
                    cleanTitle(candidate.name) === showName || candidate.name.toLowerCase().includes(showName));
                if (!show) continue;
                showBudget--;
                for (const ep of eps) {
                    const id = String(show.series_id);
                    if (watchProgressService.isEpisodeWatched(id, ep.season, ep.episode)) continue;
                    watchProgressService.markEpisodeWatched(id, ep.season, ep.episode);
                    report.pulledEpisodes++;
                }
            }
        } catch { /* catálogo indisponível — fica pra próxima rodada */ }
    }

    // Só marca "concluído" quando o lote NÃO estourou — senão a próxima
    // execução automática continua de onde parou.
    if (budget > 0) {
        localStorage.setItem(DONE_KEY, '1');
        report.complete = true;
    }
    return report;
}
