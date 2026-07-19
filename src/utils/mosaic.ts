// 🧩 Item 33: selecao dos canais do mosaico de favoritos.
/** Favoritos presentes na lista, na ordem dela, com teto. PURO. */
export function pickMosaicChannels<T extends { stream_id: number | string }>(
    streams: T[],
    favoriteIds: Set<string>,
    cap = 12,
): T[] {
    const picked: T[] = [];
    for (const stream of streams) {
        if (!favoriteIds.has(String(stream.stream_id))) continue;
        picked.push(stream);
        if (picked.length >= cap) break;
    }
    return picked;
}
