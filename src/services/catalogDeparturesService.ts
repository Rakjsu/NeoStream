/**
 * 📉 Saídas do catálogo: cruza a lista "Ver depois" com o catálogo carregado
 * e aponta os títulos que sumiram. Dispensas ficam no localStorage pra não
 * reavisar o mesmo título.
 */

const DISMISSED_KEY = 'catalog_departures_dismissed';

export interface TrackedItem {
    /** Chave composta `tipo:id` (ex.: `movie:123`). */
    id: string;
    name: string;
}

function readDismissed(): Set<string> {
    try {
        const raw = localStorage.getItem(DISMISSED_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
    } catch {
        return new Set();
    }
}

/** Itens rastreados que não estão mais no catálogo (e não foram dispensados). */
export function findDepartures(catalogIds: Set<string>, tracked: TrackedItem[]): TrackedItem[] {
    if (catalogIds.size === 0) return []; // catálogo vazio = provável falha de carga, não saída
    const dismissed = readDismissed();
    return tracked.filter(item => !catalogIds.has(item.id) && !dismissed.has(item.id));
}

/** Marca os ids como dispensados (não reavisar). */
export function dismissDepartures(ids: string[]): void {
    try {
        const merged = new Set([...readDismissed(), ...ids]);
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...merged].slice(-200)));
    } catch { /* sem storage o aviso só volta na próxima sessão */ }
}
