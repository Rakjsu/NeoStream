/**
 * Filtro de década + gênero das grades (VOD/Séries). PURO — o ano sai do
 * release_date ou do "(YYYY)" no nome; o gênero vem do campo do provedor.
 */
export interface FilterableItem {
    name: string;
    release_date?: string;
    genre?: string;
}

export function yearOf(item: FilterableItem): number | null {
    const fromDate = item.release_date?.match(/(?:19|20)\d{2}/)?.[0];
    if (fromDate) return Number(fromDate);
    const fromName = item.name.match(/\(((?:19|20)\d{2})\)/)?.[1];
    return fromName ? Number(fromName) : null;
}

export function decadeOf(year: number): number {
    return Math.floor(year / 10) * 10;
}

/** Décadas presentes no catálogo, da mais nova pra mais velha. */
export function listDecades(items: FilterableItem[]): number[] {
    const decades = new Set<number>();
    for (const item of items) {
        const year = yearOf(item);
        if (year !== null) decades.add(decadeOf(year));
    }
    return [...decades].sort((a, b) => b - a);
}

function splitGenres(genre: string | undefined): string[] {
    if (!genre) return [];
    return genre.split(/[,/|]/).map(part => part.trim()).filter(Boolean);
}

/** Gêneros do provedor por frequência (empate: alfabético), no máximo `max`. */
export function listGenres(items: FilterableItem[], max = 30): string[] {
    const counts = new Map<string, number>();
    for (const item of items) {
        for (const genre of splitGenres(item.genre)) {
            counts.set(genre, (counts.get(genre) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, max)
        .map(([genre]) => genre);
}

export function matchesFilters(item: FilterableItem, decade: number | null, genre: string | null): boolean {
    if (decade !== null) {
        const year = yearOf(item);
        if (year === null || decadeOf(year) !== decade) return false;
    }
    if (genre && !splitGenres(item.genre).some(part => part.toLowerCase() === genre.toLowerCase())) {
        return false;
    }
    return true;
}

/**
 * 🔎 Busca fuzzy: minúsculas, sem acentos e sem pontuação; os tokens da
 * query podem vir em qualquer ordem e também casam com o nome "achatado"
 * (query "spiderman" acha "Spider-Man").
 */
/** ⏳ Item 37: faixa de duração do filtro do catálogo. */
export type DurationBucket = 'short' | 'medium' | 'long';

/**
 * Casa a duração (episode_run_time do provedor, em minutos) com a faixa.
 * Sem filtro → passa tudo; com filtro, item SEM duração fica de fora
 * (não dá pra julgar — comportamento previsível).
 */
export function matchesDuration(runtime: string | number | undefined, bucket: DurationBucket | null): boolean {
    if (!bucket) return true;
    const minutes = typeof runtime === 'number' ? runtime : parseInt(runtime ?? '', 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return false;
    if (bucket === 'short') return minutes <= 90;
    if (bucket === 'medium') return minutes > 90 && minutes <= 120;
    return minutes > 120;
}

export function normalizeSearchText(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** 🔎 Memo da última busca + dos nomes já achatados.
 *
 *  `normalize('NFD')` em milhares de nomes é caro, e a versão ingênua paga
 *  DUAS vezes por item: normaliza o nome e, junto, a query — 12 mil vezes a
 *  mesma query. Numa lista de 12 mil canais (a grade da TV ao vivo) isso dá
 *  ~20 ms por passada de busca, contra ~0,9 ms da comparação literal; com o
 *  memo cai para ~1,8 ms. Mesmo molde do `normalizedNamesCache` (WeakMap) do
 *  ChannelZapOverlay, só que preso ao nome e não à identidade da lista —
 *  assim as três grades aproveitam o mesmo cache.
 */
const LIMITE_DE_NOMES = 60000;
const nomesAchatados = new Map<string, string>();
let ultimaQuery: string | null = null;
let ultimosTokens: string[] = [];
let ultimaQueryLiteral: string | null = null;

function achatar(name: string): string {
    let flat = nomesAchatados.get(name);
    if (flat === undefined) {
        flat = normalizeSearchText(name).replace(/ /g, '');
        // Trocar de lista/provedor não pode fazer o mapa crescer sem teto.
        if (nomesAchatados.size >= LIMITE_DE_NOMES) nomesAchatados.clear();
        nomesAchatados.set(name, flat);
    }
    return flat;
}

export function fuzzyIncludes(name: string, query: string): boolean {
    if (query !== ultimaQuery) {
        ultimaQuery = query;
        const normalizedQuery = normalizeSearchText(query);
        ultimosTokens = normalizedQuery ? normalizedQuery.split(' ') : [];
        // 🔤 Busca fora do alfabeto latino (cirílico, grego, árabe, CJK) some
        // inteira no `[^a-z0-9]`. Sem esta saída ela viraria "casa tudo" e o
        // catálogo INTEIRO apareceria no lugar do canal procurado — então
        // volta ao literal, que é o que acha esses nomes.
        ultimaQueryLiteral = !normalizedQuery && query.trim()
            ? query.trim().toLowerCase()
            : null;
    }
    if (ultimaQueryLiteral !== null) return name.toLowerCase().includes(ultimaQueryLiteral);
    if (ultimosTokens.length === 0) return true;
    // Só o nome achatado basta: token nunca tem espaço, então um trecho
    // contíguo do nome normalizado continua contíguo depois de tirar os
    // espaços — `normalizedName.includes(token)` era redundante.
    const flatName = achatar(name);
    return ultimosTokens.every(token => flatName.includes(token));
}

/** 🏷️ Selo de qualidade extraído do nome que o provedor usa. */
export function qualityBadgeOf(name: string): string | null {
    if (/\b(4k|uhd|2160p?)\b/i.test(name)) return '4K';
    if (/\b(fhd|1080p?|full ?hd)\b/i.test(name)) return 'FHD';
    if (/\b(hd|720p?)\b/i.test(name)) return 'HD';
    return null;
}
