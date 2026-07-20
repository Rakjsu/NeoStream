// 🎞️ Item 30: fila de reprodução MANUAL de filmes — o usuário escolhe a
// ordem do "tocar em seguida" (a fila implícita do Ver depois continua de
// fallback). Persistida por perfil por playlist, como os favoritos.
import { profileService } from './profileService';
import { playlistScopedKey } from './activePlaylistService';

const KEY_BASE = 'neostream_play_queue';

export interface QueuedItem {
    /** stream_id do filme. */
    id: string;
    name: string;
    cover?: string;
    addedAt: number;
}

/** Move o item pra cima (-1) ou pra baixo (+1) na lista. PURO. */
export function moveInList(list: QueuedItem[], id: string, direction: -1 | 1): QueuedItem[] {
    const index = list.findIndex(item => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

function storageKey(): string | null {
    const activeProfile = profileService.getActiveProfile();
    if (!activeProfile) return null;
    return playlistScopedKey(KEY_BASE, activeProfile.id);
}

function load(): QueuedItem[] {
    const key = storageKey();
    if (!key) return [];
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(parsed) ? (parsed as QueuedItem[]).filter(item => item && typeof item.id === 'string') : [];
    } catch {
        return [];
    }
}

function persist(list: QueuedItem[]): QueuedItem[] {
    const key = storageKey();
    if (key) localStorage.setItem(key, JSON.stringify(list));
    return list;
}

export const queueService = {
    getAll(): QueuedItem[] {
        return load();
    },

    has(id: string): boolean {
        return load().some(item => item.id === id);
    },

    add(item: Omit<QueuedItem, 'addedAt'>): QueuedItem[] {
        const list = load();
        if (list.some(existing => existing.id === item.id)) return list;
        return persist([...list, { ...item, addedAt: Date.now() }]);
    },

    remove(id: string): QueuedItem[] {
        return persist(load().filter(item => item.id !== id));
    },

    move(id: string, direction: -1 | 1): QueuedItem[] {
        return persist(moveInList(load(), id, direction));
    },

    /** Primeiro da fila que não é o filme que acabou de terminar. */
    next(excludeId: string): QueuedItem | null {
        return load().find(item => item.id !== excludeId) ?? null;
    },
};
