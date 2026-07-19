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

export function fuzzyIncludes(name: string, query: string): boolean {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return true;
    const normalizedName = normalizeSearchText(name);
    const flatName = normalizedName.replace(/ /g, '');
    return normalizedQuery
        .split(' ')
        .every(token => normalizedName.includes(token) || flatName.includes(token));
}

/** 🏷️ Selo de qualidade extraído do nome que o provedor usa. */
export function qualityBadgeOf(name: string): string | null {
    if (/\b(4k|uhd|2160p?)\b/i.test(name)) return '4K';
    if (/\b(fhd|1080p?|full ?hd)\b/i.test(name)) return 'FHD';
    if (/\b(hd|720p?)\b/i.test(name)) return 'HD';
    return null;
}
