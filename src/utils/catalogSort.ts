/**
 * Catalog sorting shared by VOD/Series/LiveTV (pure, unit-tested).
 */

export type CatalogSort = 'recent' | 'name' | 'rating' | 'mywatch';

/**
 * Um único Collator para o app inteiro. `localeCompare(name, undefined, {...})`
 * refaz a negociação de locale e monta um Collator novo a CADA comparação — um
 * sort de 45 mil filmes são ~700 mil comparações e medimos 2.200 ms de renderer
 * travado nesse caminho, contra 82 ms com o Collator reusado (27×).
 * As opções têm que continuar idênticas às de antes (ordenação não muda).
 */
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Comparator used by the catalog pages (exported for tests). */
export function compareCatalogItems<T extends { name: string; added?: string | number; rating?: string | number; num?: number }>(
    sort: CatalogSort,
    a: T,
    b: T
): number {
    if (sort === 'name') {
        return nameCollator.compare(a.name, b.name);
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
