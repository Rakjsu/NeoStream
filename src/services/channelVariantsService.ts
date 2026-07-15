/**
 * Agrupador de variantes FHD/HD/SD (port do mobile): "ESPN FHD", "ESPN HD" e
 * "ESPN SD" viram UM card na TV ao vivo — a melhor qualidade representa o
 * grupo e as demais aparecem como botões de qualidade na ficha do canal.
 * Tudo PURO: nada de rede/estado, só o nome dos canais.
 */

export interface VariantChannel {
    stream_id: number | string;
    name: string;
}

const QUALITY_ORDER = ['4k', 'uhd', 'fhd', 'hd', 'sd'];

/** Nota de qualidade pelo nome (menor = melhor); sem tag fica entre HD e SD. */
export function qualityRank(name: string): number {
    const lower = name.toLowerCase();
    for (let i = 0; i < QUALITY_ORDER.length; i++) {
        if (new RegExp(`(^|[^a-z0-9])${QUALITY_ORDER[i]}([^a-z0-9]|$)`).test(lower)) return i;
    }
    return 3.5;
}

/** Nome sem as tags de qualidade/codec — é a chave que junta as variantes. */
export function variantBaseName(name: string): string {
    const base = name
        .replace(/\s*[[(](fhd|hd|sd|4k|uhd|h\.?26[456]|hevc|avc)[\])]/gi, '')
        .replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    // Nome que É só a tag ("FHD") não vira grupo de tudo — fica sozinho.
    return base || name.trim().toLowerCase();
}

/** Rótulo curto da qualidade pro botão da ficha ("4K", "FHD", "HD", "SD"). */
export function qualityLabel(name: string): string {
    const match = /(^|[^a-z0-9])(4k|uhd|fhd|hd|sd)([^a-z0-9]|$)/i.exec(name);
    return match ? match[2].toUpperCase() : name.slice(0, 12);
}

/**
 * Agrupa preservando a ordem da lista (o grupo aparece onde a PRIMEIRA
 * variante apareceria); o representante é a melhor qualidade do grupo.
 * `variantsOf` só tem entradas pra grupos com 2+ variantes, chaveadas pelo
 * stream_id do representante.
 */
export function groupChannelVariants<T extends VariantChannel>(channels: T[]): { groups: T[]; variantsOf: Map<string, T[]> } {
    const byBase = new Map<string, T[]>();
    for (const channel of channels) {
        const base = variantBaseName(channel.name);
        const list = byBase.get(base) ?? [];
        list.push(channel);
        byBase.set(base, list);
    }

    const groups: T[] = [];
    const variantsOf = new Map<string, T[]>();
    const seen = new Set<string>();
    for (const channel of channels) {
        const base = variantBaseName(channel.name);
        if (seen.has(base)) continue;
        seen.add(base);
        const list = byBase.get(base) ?? [channel];
        if (list.length === 1) {
            groups.push(channel);
            continue;
        }
        const sorted = [...list].sort((a, b) => qualityRank(a.name) - qualityRank(b.name));
        groups.push(sorted[0]);
        variantsOf.set(String(sorted[0].stream_id), sorted);
    }
    return { groups, variantsOf };
}
