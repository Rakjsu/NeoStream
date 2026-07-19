// ⏱️ Histórico de zapping: os últimos canais reproduzidos na TV ao vivo, em
// ordem MRU (mais recente primeiro), pra volta rápida no overlay de canais.
// Persistido por perfil por playlist, o mesmo escopo dos favoritos.
import { profileService } from './profileService';
import { playlistScopedKey } from './activePlaylistService';

const KEY_BASE = 'neostream_zap_history';
const MAX_ENTRIES = 10;

function storageKey(): string | null {
    const activeProfile = profileService.getActiveProfile();
    if (!activeProfile) return null;
    return playlistScopedKey(KEY_BASE, activeProfile.id);
}

export const zapHistoryService = {
    /** Ids dos últimos canais, mais recente primeiro. */
    getRecent(): string[] {
        const key = storageKey();
        if (!key) return [];
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
            return [];
        }
    },

    /** Registra um canal reproduzido e devolve a lista NOVA (pro setState). */
    push(channelId: string): string[] {
        const id = String(channelId);
        const next = [id, ...this.getRecent().filter(existing => existing !== id)].slice(0, MAX_ENTRIES);
        const key = storageKey();
        if (key) localStorage.setItem(key, JSON.stringify(next));
        return next;
    }
};
