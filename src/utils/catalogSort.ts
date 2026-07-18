/**
 * Catalog sorting shared by VOD/Series/LiveTV (pure, unit-tested).
 */

export type CatalogSort = 'recent' | 'name' | 'rating' | 'mywatch';

/** Comparator used by the catalog pages (exported for tests). */
export function compareCatalogItems<T extends { name: string; added?: string | number; rating?: string | number; num?: number }>(
    sort: CatalogSort,
    a: T,
    b: T
): number {
    if (sort === 'name') {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    }
    if (sort === 'rating') {
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
    }
    // 'mywatch' precisa dos dados de uso — a página resolve por fora e o
    // comparador puro trata como empate (mantém a ordem de entrada).
    if (sort === 'mywatch') return 0;
    // recent: added-date desc when available, provider order (num) otherwise
    const aAdded = Number(a.added) || 0;
    const bAdded = Number(b.added) || 0;
    if (aAdded !== bAdded) return bAdded - aAdded;
    return (a.num ?? 0) - (b.num ?? 0);
}
