/**
 * 🔖 Marcadores de posição em VOD/séries: pontos salvos por conteúdo pra
 * voltar depois (cenas favoritas, "parei de prestar atenção aqui" etc.).
 */

export interface VideoBookmark {
    /** Segundos desde o início. */
    time: number;
    createdAt: number;
}

const STORAGE_KEY = 'video_bookmarks_v1';
const MAX_PER_CONTENT = 50;
/** Dois marcadores a menos de 2s um do outro são o mesmo ponto. */
const DEDUPE_WINDOW_S = 2;

type BookmarkMap = Record<string, VideoBookmark[]>;

function readAll(): BookmarkMap {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed as BookmarkMap : {};
    } catch {
        return {};
    }
}

function writeAll(map: BookmarkMap): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch { /* storage cheio: o marcador só não persiste */ }
}

export const bookmarkService = {
    list(contentId: string): VideoBookmark[] {
        const entries = readAll()[contentId] ?? [];
        return [...entries].sort((a, b) => a.time - b.time);
    },

    /** Adiciona (com dedupe por janela de 2s) e devolve a lista atualizada. */
    add(contentId: string, time: number): VideoBookmark[] {
        if (!contentId || !Number.isFinite(time) || time < 0) return this.list(contentId);
        const map = readAll();
        const entries = map[contentId] ?? [];
        if (!entries.some(b => Math.abs(b.time - time) < DEDUPE_WINDOW_S)) {
            entries.push({ time: Math.round(time * 10) / 10, createdAt: Date.now() });
            entries.sort((a, b) => a.time - b.time);
            map[contentId] = entries.slice(0, MAX_PER_CONTENT);
            writeAll(map);
        }
        return this.list(contentId);
    },

    remove(contentId: string, time: number): VideoBookmark[] {
        const map = readAll();
        const entries = (map[contentId] ?? []).filter(b => b.time !== time);
        if (entries.length > 0) map[contentId] = entries;
        else delete map[contentId];
        writeAll(map);
        return this.list(contentId);
    }
};
