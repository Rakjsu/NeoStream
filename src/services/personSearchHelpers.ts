/**
 * 🎭 Busca por elenco/diretor: casa títulos da filmografia TMDB com os nomes
 * (sujos) do catálogo do provedor. Puro e testável.
 */

/** Normaliza pra comparação: minúsculas, sem acentos, sem tags [..]/(..), só alfanumérico. */
export function normalizeTitle(raw: string): string {
    return raw
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Filtra os itens do catálogo cujo nome normalizado é igual a um título da
 * filmografia — ou começa com ele ("titulo 2023 dublado" ainda casa).
 */
export function matchCatalogByTitles<T extends { name: string }>(
    items: T[],
    titles: string[],
    limit = 12
): T[] {
    const wanted = new Set(titles.map(normalizeTitle).filter(t => t.length >= 3));
    if (wanted.size === 0) return [];
    const out: T[] = [];
    for (const item of items) {
        const norm = normalizeTitle(item.name);
        if (!norm) continue;
        if (wanted.has(norm)) {
            out.push(item);
        } else {
            for (const title of wanted) {
                if (norm.startsWith(title + ' ')) {
                    out.push(item);
                    break;
                }
            }
        }
        if (out.length >= limit) break;
    }
    return out;
}
