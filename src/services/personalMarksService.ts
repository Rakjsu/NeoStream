/**
 * Marcas pessoais do catálogo: nota (1–5 ⭐) e tags livres por conteúdo.
 * localStorage — local à máquina, de propósito fora de perfis/parental.
 */
const STORAGE_KEY = 'neostream_personal_marks';

export interface PersonalMark {
    rating?: number;
    tags?: string[];
}

type MarkMap = Record<string, PersonalMark>;

function loadAll(): MarkMap {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as MarkMap) : {};
    } catch {
        return {};
    }
}

function saveAll(map: MarkMap): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch { /* modo privado/disco cheio: a marca só não persiste */ }
}

function keyOf(type: 'movie' | 'series', id: string): string {
    return `${type}:${id}`;
}

export function getMark(type: 'movie' | 'series', id: string): PersonalMark {
    return loadAll()[keyOf(type, id)] ?? {};
}

/** Nota 1–5; qualquer outra coisa limpa a nota. */
export function setRating(type: 'movie' | 'series', id: string, rating: number): void {
    const map = loadAll();
    const key = keyOf(type, id);
    const entry = { ...(map[key] ?? {}) };
    if (rating >= 1 && rating <= 5) entry.rating = Math.round(rating);
    else delete entry.rating;
    if (entry.rating === undefined && !entry.tags?.length) delete map[key];
    else map[key] = entry;
    saveAll(map);
}

/** Liga/desliga a tag (case-insensitive) e devolve a lista atual. */
export function toggleTag(type: 'movie' | 'series', id: string, tag: string): string[] {
    const clean = tag.trim().slice(0, 30);
    if (!clean) return getMark(type, id).tags ?? [];
    const map = loadAll();
    const key = keyOf(type, id);
    const entry = { ...(map[key] ?? {}) };
    const tags = entry.tags ? [...entry.tags] : [];
    const index = tags.findIndex(existing => existing.toLowerCase() === clean.toLowerCase());
    if (index >= 0) tags.splice(index, 1);
    else tags.push(clean);
    if (tags.length) entry.tags = tags;
    else delete entry.tags;
    if (entry.rating === undefined && !entry.tags) delete map[key];
    else map[key] = entry;
    saveAll(map);
    return tags;
}

/** Todas as tags já usadas (únicas, alfabéticas) — alimenta o autocomplete. */
export function allTags(): string[] {
    const seen = new Map<string, string>();
    for (const mark of Object.values(loadAll())) {
        for (const tag of mark.tags ?? []) {
            const lower = tag.toLowerCase();
            if (!seen.has(lower)) seen.set(lower, tag);
        }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
