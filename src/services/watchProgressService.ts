import { profileService } from './profileService';
import { playlistScopedKey, hasKnownPlaylistId } from './activePlaylistService';
import { readJson } from './storageJsonCache';
import { syncTombstones, episodeProgressTombstoneKey } from './syncTombstones';

export interface EpisodeProgress {
    seriesId: string;
    seasonNumber: number;
    episodeNumber: number;
    profileId: string; // Track progress per profile
    watchedAt: number; // timestamp
    completed: boolean;
    currentTime?: number; // Video position in seconds
    duration?: number; // Total video duration
}

export interface SeriesProgress {
    seriesId: string;
    seriesName: string;
    lastWatchedSeason: number;
    lastWatchedEpisode: number;
    lastWatchedAt: number;
    episodeCount: number; // Total episodes watched
    completedCount: number; // Quantos desses chegaram ao fim
}

class WatchProgressService {
    private STORAGE_KEY_PREFIX = 'series_watch_progress';
    /** Escrita pelo episodeNotificationService — total de episódios do provedor. */
    private TOTAIS_KEY_PREFIX = 'series_episode_data';

    // Get storage key for current profile (per-profile per-playlist)
    private getStorageKey(): string {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return this.STORAGE_KEY_PREFIX; // Fallback for no profile
        this.migratePerProfileToPlaylist(activeProfile.id);
        return playlistScopedKey(this.STORAGE_KEY_PREFIX, activeProfile.id);
    }

    /**
     * One-time, idempotent migration: copy the per-profile-only key
     * `series_watch_progress_${profileId}` into the per-(profile,playlist) key
     * for the CURRENT active playlist, then remove the old key. Skipped while
     * the active playlist id is unknown ('default' race) — re-runs next access.
     */
    private migratePerProfileToPlaylist(profileId: string): void {
        if (!hasKnownPlaylistId()) return;

        const oldKey = `${this.STORAGE_KEY_PREFIX}_${profileId}`;
        const old = localStorage.getItem(oldKey);
        if (old === null) return;

        const newKey = playlistScopedKey(this.STORAGE_KEY_PREFIX, profileId);
        if (localStorage.getItem(newKey) === null) {
            localStorage.setItem(newKey, old);
        }
        localStorage.removeItem(oldKey);
    }

    // Get all watch progress for current profile
    private getProgress(): EpisodeProgress[] {
        return readJson<EpisodeProgress[]>(this.getStorageKey(), []);
    }

    /**
     * Índice seriesId → resumo, memoizado pela IDENTIDADE do array parseado
     * (que só muda quando o texto no localStorage muda). Cada card de Séries
     * chamava `getSeriesProgress`, que varria o histórico de episódios inteiro.
     */
    private seriesIndexCache = new WeakMap<EpisodeProgress[], Map<string, Omit<SeriesProgress, 'seriesName'>>>();
    getSeriesProgressIndex(): Map<string, Omit<SeriesProgress, 'seriesName'>> {
        const activeProfile = profileService.getActiveProfile();
        const progress = this.getProgress();
        const cached = this.seriesIndexCache.get(progress);
        if (cached) return cached;

        const index = new Map<string, Omit<SeriesProgress, 'seriesName'>>();
        if (activeProfile) {
            for (const ep of progress) {
                if (ep.profileId !== activeProfile.id) continue;
                const current = index.get(ep.seriesId);
                if (!current) {
                    index.set(ep.seriesId, {
                        seriesId: ep.seriesId,
                        lastWatchedSeason: ep.seasonNumber,
                        lastWatchedEpisode: ep.episodeNumber,
                        lastWatchedAt: ep.watchedAt,
                        episodeCount: 1,
                        completedCount: ep.completed ? 1 : 0
                    });
                    continue;
                }
                current.episodeCount++;
                if (ep.completed) current.completedCount++;
                if (ep.watchedAt > current.lastWatchedAt) {
                    current.lastWatchedSeason = ep.seasonNumber;
                    current.lastWatchedEpisode = ep.episodeNumber;
                    current.lastWatchedAt = ep.watchedAt;
                }
            }
        }
        this.seriesIndexCache.set(progress, index);
        return index;
    }

    // Save progress for current profile
    private saveProgress(progress: EpisodeProgress[]): void {
        localStorage.setItem(this.getStorageKey(), JSON.stringify(progress));
    }

    // Mark episode as watched
    markEpisodeWatched(
        seriesId: string,
        seasonNumber: number,
        episodeNumber: number
    ): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        const progress = this.getProgress();
        const existing = progress.findIndex(
            (p) =>
                p.seriesId === seriesId &&
                p.seasonNumber === seasonNumber &&
                p.episodeNumber === episodeNumber &&
                p.profileId === activeProfile.id
        );

        const newEntry: EpisodeProgress = {
            seriesId,
            seasonNumber,
            episodeNumber,
            profileId: activeProfile.id,
            watchedAt: Date.now(),
            completed: true,
        };

        if (existing >= 0) {
            progress[existing] = { ...progress[existing], ...newEntry };
        } else {
            progress.push(newEntry);
        }

        this.saveProgress(progress);
    }

    /**
     * Save current video time for resume.
     * `watchedAt` explícito = amostra do CELULAR (ver movieProgressService).
     */
    saveVideoTime(
        seriesId: string,
        seasonNumber: number,
        episodeNumber: number,
        currentTime: number,
        duration: number,
        watchedAt: number = Date.now()
    ): void {
        // Sem duração válida não dá pra calcular "assistido": um recoverMediaError
        // do hls.js zera currentTime e deixa duration NaN, e `0 >= 0 * 0.9` marcaria
        // o episódio como concluído, escondendo-o do "continuar de onde parou".
        if (!Number.isFinite(duration) || duration <= 0) return;

        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        const progress = this.getProgress();
        const existing = progress.findIndex(
            (p) =>
                p.seriesId === seriesId &&
                p.seasonNumber === seasonNumber &&
                p.episodeNumber === episodeNumber &&
                p.profileId === activeProfile.id
        );

        const entry: EpisodeProgress = {
            seriesId,
            seasonNumber,
            episodeNumber,
            profileId: activeProfile.id,
            watchedAt,
            completed: currentTime >= duration * 0.9, // 90% = completed
            currentTime,
            duration,
        };

        if (existing >= 0) {
            progress[existing] = { ...progress[existing], ...entry };
        } else {
            progress.push(entry);
        }

        this.saveProgress(progress);

        // 🔄 Item 11: o WebRemoteBridge resolve o nome da série e espelha no celular.
        try {
            window.dispatchEvent(new CustomEvent('progress:sample', {
                detail: { kind: 'episode', seriesId, season: seasonNumber, episode: episodeNumber, positionSec: currentTime, durationSec: duration, updatedAt: entry.watchedAt },
            }));
        } catch { /* ambiente de teste sem CustomEvent */ }
    }

    // Get saved video time for resume
    getVideoTime(
        seriesId: string,
        seasonNumber: number,
        episodeNumber: number
    ): number | null {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return null;

        const progress = this.getProgress();
        const episode = progress.find(
            (p) =>
                p.seriesId === seriesId &&
                p.seasonNumber === seasonNumber &&
                p.episodeNumber === episodeNumber &&
                p.profileId === activeProfile.id
        );

        if (episode?.currentTime && episode?.duration) {
            // Don't resume if already completed or less than 10 seconds
            if (episode.completed || episode.currentTime < 10) {
                return null;
            }
            // Don't resume if within last 30 seconds (probably finished)
            if (episode.duration - episode.currentTime < 30) {
                return null;
            }
            return episode.currentTime;
        }

        return null;
    }

    // Check if episode is watched
    isEpisodeWatched(
        seriesId: string,
        seasonNumber: number,
        episodeNumber: number
    ): boolean {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return false;

        const progress = this.getProgress();
        return progress.some(
            (p) =>
                p.seriesId === seriesId &&
                p.seasonNumber === seasonNumber &&
                p.episodeNumber === episodeNumber &&
                p.profileId === activeProfile.id &&
                p.completed
        );
    }

    // Get series progress WITHOUT needing total episodes
    getSeriesProgress(seriesId: string, seriesName: string): SeriesProgress | null {
        const summary = this.getSeriesProgressIndex().get(seriesId);
        return summary ? { ...summary, seriesName } : null;
    }

    // Get all series with ANY watch history (for Continue Watching)
    getContinueWatching(): Map<string, SeriesProgress> {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return new Map();

        const progress = this.getProgress();
        const seriesMap = new Map<string, SeriesProgress>();

        // Group by series - only for active profile
        progress.forEach(ep => {
            if (ep.profileId === activeProfile.id && !seriesMap.has(ep.seriesId)) {
                const seriesProgress = this.getSeriesProgress(ep.seriesId, '');
                if (seriesProgress) {
                    seriesMap.set(ep.seriesId, seriesProgress);
                }
            }
        });

        return seriesMap;
    }

    // Read-only watch history for the active profile (every episode with progress)
    getEpisodeHistory(): EpisodeProgress[] {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return [];

        return this.getProgress().filter((p) => p.profileId === activeProfile.id);
    }

    // Get last watched episode for a series (for auto-selection)
    getLastWatchedEpisode(seriesId: string): { season: number; episode: number } | null {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return null;

        const progress = this.getProgress();
        const seriesEpisodes = progress.filter(
            (p) => p.seriesId === seriesId && p.profileId === activeProfile.id
        );

        if (seriesEpisodes.length === 0) return null;

        // Find the most recently watched episode
        const lastWatched = seriesEpisodes.reduce((latest, current) => {
            return current.watchedAt > latest.watchedAt ? current : latest;
        });

        return {
            season: lastWatched.seasonNumber,
            episode: lastWatched.episodeNumber
        };
    }

    // Get episode progress (for checking if partially watched)
    getEpisodeProgress(
        seriesId: string,
        seasonNumber: number,
        episodeNumber: number
    ): { currentTime: number; duration: number; completed: boolean; watchedAt: number } | null {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return null;

        const progress = this.getProgress();
        const episode = progress.find(
            (p) =>
                p.seriesId === seriesId &&
                p.seasonNumber === seasonNumber &&
                p.episodeNumber === episodeNumber &&
                p.profileId === activeProfile.id
        );

        if (!episode || !episode.currentTime || !episode.duration) {
            return null;
        }

        return {
            currentTime: episode.currentTime,
            duration: episode.duration,
            completed: episode.completed,
            // Exposto pro espelho com o celular: sem ele o desempate do
            // episódio era "maior posição vence" e rever do início no celular
            // nunca chegava aqui.
            watchedAt: episode.watchedAt
        };
    }

    // Clear progress for a specific episode (for "Start Over" functionality)
    clearEpisodeProgress(
        seriesId: string,
        seasonNumber: number,
        episodeNumber: number
    ): void {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return;

        const progress = this.getProgress();
        const filtered = progress.filter(
            (p) =>
                !(p.seriesId === seriesId &&
                    p.seasonNumber === seasonNumber &&
                    p.episodeNumber === episodeNumber &&
                    p.profileId === activeProfile.id)
        );
        // 🪦 Ledger de remoções: sem o carimbo, "Recomeçar" (e o desmarcar do
        // ✓) volta atrás no próximo ciclo de sync, porque o merge é newest-wins
        // por episódio. Marcar de novo grava um watchedAt mais novo e vence o
        // carimbo.
        if (filtered.length !== progress.length) {
            syncTombstones.record(
                this.getStorageKey(),
                episodeProgressTombstoneKey(seriesId, seasonNumber, episodeNumber),
            );
        }
        this.saveProgress(filtered);
    }

    /**
     * Série concluída = todo episódio que o PROVEDOR tem foi visto até o fim.
     *
     * Devolvia `false` cravado, e com isso três coisas nunca aconteciam: a
     * categoria "🏆 Séries Finalizadas" do menu abria sempre vazia, o selo ✓ do
     * card nunca desenhava e a barra de progresso continuava aparecendo em
     * série terminada.
     *
     * O total vem de quem já o persiste: o vigia de novos episódios
     * (`episodeNotificationService`), na mesma chave por (perfil, playlist) do
     * progresso. Sem total conhecido, `false` — "todo episódio REGISTRADO está
     * completo" marcaria como concluída uma série com 1 de 10 vistos.
     */
    isSeriesCompleted(seriesId: string): boolean {
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return false;

        const total = this.getTotaisDeEpisodios(activeProfile.id)[seriesId]?.lastKnownEpisodes ?? 0;
        if (!(total > 0)) return false;

        return (this.getSeriesProgressIndex().get(seriesId)?.completedCount ?? 0) >= total;
    }

    /** Totais do provedor, na mesma chave por (perfil, playlist) do progresso. */
    private getTotaisDeEpisodios(profileId: string): Record<string, { lastKnownEpisodes?: number }> {
        return readJson<Record<string, { lastKnownEpisodes?: number }>>(
            playlistScopedKey(this.TOTAIS_KEY_PREFIX, profileId), {}
        );
    }

    /**
     * Ids das séries CONCLUÍDAS entre as que têm algum progresso — o conjunto
     * que o 🙈 "Esconder assistidos" da grade de Séries tira da tela.
     *
     * A grade decidia sozinha, por "todo episódio REGISTRADO está completo".
     * Só que registro só existe pro episódio que foi ABERTO: ver o 1º de dez
     * dava 1 de 1 e sumia com a série inteira. Aqui o denominador é o total do
     * provedor, o mesmo de `isSeriesCompleted` — e os totais são lidos UMA vez
     * pro histórico inteiro, em vez de uma vez por série.
     */
    getCompletedSeriesIds(): Set<string> {
        const ids = new Set<string>();
        const activeProfile = profileService.getActiveProfile();
        if (!activeProfile) return ids;

        const totais = this.getTotaisDeEpisodios(activeProfile.id);
        for (const [seriesId, resumo] of this.getSeriesProgressIndex()) {
            const total = totais[seriesId]?.lastKnownEpisodes ?? 0;
            if (total > 0 && resumo.completedCount >= total) ids.add(seriesId);
        }
        return ids;
    }

    // Clear progress for a series
    clearSeriesProgress(seriesId: string): void {
        const progress = this.getProgress();
        const filtered = progress.filter((p) => p.seriesId !== seriesId);
        syncTombstones.recordMany(
            this.getStorageKey(),
            progress
                .filter((p) => p && p.seriesId === seriesId)
                .map((p) => episodeProgressTombstoneKey(p.seriesId, p.seasonNumber, p.episodeNumber)),
        );
        this.saveProgress(filtered);
    }

    // Clear all progress for current profile
    clearAllProgress(): void {
        const key = this.getStorageKey();
        syncTombstones.recordMany(
            key,
            this.getProgress()
                .filter((p) => p && typeof p.seriesId === 'string')
                .map((p) => episodeProgressTombstoneKey(p.seriesId, p.seasonNumber, p.episodeNumber)),
        );
        localStorage.removeItem(key);
    }
}

export const watchProgressService = new WatchProgressService();
