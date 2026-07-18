/**
 * 🎰 Roleta por gosto: sorteio ponderado de um filme do catálogo.
 * Categorias "favoritas" (derivadas do histórico) pesam 3x; o resto 1x.
 * Puro — o rand é injetado pra ser testável.
 */

/** Conta as categorias dos filmes já assistidos e devolve as com 2+ ocorrências (1+ se poucas). */
export function favoredCategoryIds(watchedCategoryIds: (string | undefined)[]): Set<string> {
    const counts = new Map<string, number>();
    for (const id of watchedCategoryIds) {
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const repeated = [...counts.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
    if (repeated.length > 0) return new Set(repeated);
    return new Set(counts.keys());
}

/** Sorteia um item do pool com peso 3 pras categorias favoritas. */
export function spinRoulette<T extends { category_id?: string }>(
    pool: T[],
    favored: Set<string>,
    rand: () => number
): T | null {
    if (pool.length === 0) return null;
    const weights = pool.map(item => (item.category_id && favored.has(item.category_id) ? 3 : 1));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = rand() * total;
    for (let i = 0; i < pool.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1];
}
