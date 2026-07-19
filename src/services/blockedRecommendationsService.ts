// 🚫 "Não me recomende isso": títulos que o usuário baniu das recomendações
// da Home (botão ✕ no card do rail). Persistido por perfil por playlist,
// o mesmo escopo dos favoritos.
import { profileService } from './profileService';
import { playlistScopedKey } from './activePlaylistService';

const KEY_BASE = 'neostream_blocked_recommendations';

function storageKey(): string | null {
    const activeProfile = profileService.getActiveProfile();
    if (!activeProfile) return null;
    return playlistScopedKey(KEY_BASE, activeProfile.id);
}

export const blockedRecommendationsService = {
    /** Chaves `movie:<id>` / `series:<id>` banidas. */
    getAll(): Set<string> {
        const key = storageKey();
        if (!key) return new Set();
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]');
            return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
        } catch {
            return new Set();
        }
    },

    /** Bane um título e devolve o set NOVO (pro setState). */
    block(kind: 'movie' | 'series', id: string | number): Set<string> {
        const all = this.getAll();
        all.add(`${kind}:${id}`);
        const key = storageKey();
        if (key) localStorage.setItem(key, JSON.stringify([...all]));
        return all;
    },

    /** Ids banidos de um tipo — pro filtro do recommendationService. */
    getBlockedIds(kind: 'movie' | 'series'): Set<string> {
        const prefix = `${kind}:`;
        return new Set(
            [...this.getAll()]
                .filter(entry => entry.startsWith(prefix))
                .map(entry => entry.slice(prefix.length))
        );
    }
};
