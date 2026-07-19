// 🎬 Backfill do Trakt no desktop: envia o HISTÓRICO local (o que foi visto
// ANTES de conectar — o scrobble só cobre dali em diante) pro Trakt:
// filmes com progresso ≥85% ainda não sincronizados e episódios completos.
// Deduplica contra o que o Trakt já tem (sem plays duplicados) e roda em
// lotes de 30 (rate limit do Trakt) — execuções seguintes completam o resto.
import { movieProgressService } from './movieProgressService';
import { watchProgressService } from './watchProgressService';
import {
    fetchTraktWatchedMovies, fetchTraktWatchedShows, isTraktConnected,
    syncTraktEpisodeWatched, syncTraktMovieWatched,
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

    const report: TraktBackfillReport = { pushedMovies: 0, pushedEpisodes: 0, complete: false };
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

    // Só marca "concluído" quando o lote NÃO estourou — senão a próxima
    // execução automática continua de onde parou.
    if (budget > 0) {
        localStorage.setItem(DONE_KEY, '1');
        report.complete = true;
    }
    return report;
}
