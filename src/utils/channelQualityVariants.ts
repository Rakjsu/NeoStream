/**
 * Variantes de qualidade de um canal ao vivo ("Globo SP" ↔ "Globo [4K]") —
 * agora indexadas.
 *
 * A versão antiga vivia dentro da LiveTV e era chamada na FASE DE RENDER: a
 * cada render ela varria a lista inteira de canais rodando ~15 regex por
 * nome. Com 6 mil canais isso é ~90 mil regex por render, e a página
 * re-renderiza no tick de 10 s do progresso, a cada zap e a cada scroll.
 *
 * Aqui o custo das regex é pago UMA vez por lista (buildChannelVariantIndex)
 * e a consulta vira lookup de mapa. A regra de casamento é a mesma da versão
 * antiga, incluindo a ordem do resultado (ordem da lista, depois prioridade).
 */

export interface QualityChannelName {
    name: string;
}

export interface ChannelNameInfo {
    baseName: string;
    quality: string;
    codec: string;
    label: string;
    priority: number;
    hasOnlyQuality: boolean;
    regionSuffix: string;
}

/** UFs usadas como sufixo regional ("Globo SP"). Constante de módulo — a
 *  versão antiga recriava esse Set a cada chamada. */
const STATE_ABBREVIATIONS = new Set([
    'sp', 'rj', 'mg', 'rs', 'pr', 'sc', 'ba', 'pe', 'ce', 'pa',
    'go', 'ma', 'pb', 'am', 'rn', 'pi', 'al', 'mt', 'ms', 'se',
    'ro', 'to', 'ac', 'ap', 'rr', 'es', 'df'
]);

/** Nome do canal → qualidade, codec, nome-base e sufixo de UF. */
export function extractChannelInfo(name: string): ChannelNameInfo {
    const workingName = name.trim();
    let quality = '';
    let codec = '';
    let priority = 2; // HD é o padrão

    if (/\[4K\]|\(4K\)|2160p/i.test(workingName)) {
        quality = '4K';
        priority = 0;
    } else if (/\[UHD\]|\(UHD\)/i.test(workingName)) {
        quality = 'UHD';
        priority = 0;
    } else if (/\[FHD\]|\(FHD\)|1080p/i.test(workingName)) {
        quality = 'FHD';
        priority = 1;
    } else if (/\[HD\]|\(HD\)|720p/i.test(workingName)) {
        quality = 'HD';
        priority = 2;
    } else if (/\[SD\]|\(SD\)|480p/i.test(workingName)) {
        quality = 'SD';
        priority = 3;
    }

    if (/\[H\.?265\]|\(H\.?265\)|HEVC/i.test(workingName)) {
        codec = 'H.265';
        priority = Math.max(0, priority - 0.5);
    }

    let label = quality || 'HD';
    if (codec) {
        label = quality ? `${quality} ${codec}` : codec;
    }

    const baseName = workingName
        .replace(/\s*\[(?:FHD|HD|SD|4K|UHD|H\.?265|HEVC)\]\s*/gi, ' ')
        .replace(/\s*\((?:FHD|HD|SD|4K|UHD|H\.?265|HEVC)\)\s*/gi, ' ')
        .replace(/\s*(?:2160|1080|720|480)p?\s*/gi, ' ')
        .replace(/\s+FHD\s+/gi, ' ')
        .replace(/\s+HD\s+/gi, ' ')
        .replace(/\s+SD\s+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const hasOnlyQuality = !!(quality || codec) && baseName.length < workingName.length * 0.7;

    const words = baseName.split(' ');
    const lastWord = words[words.length - 1]?.toLowerCase() || '';
    const regionSuffix = STATE_ABBREVIATIONS.has(lastWord) ? lastWord : '';

    return { baseName, quality, codec, label, priority, hasOnlyQuality, regionSuffix };
}

interface IndexedChannel<T> {
    channel: T;
    info: ChannelNameInfo;
    /** Posição na lista original — preserva a ordem do resultado. */
    order: number;
}

export interface ChannelVariantIndex<T> {
    /** nome-base → canais com esse nome-base. */
    byBase: Map<string, IndexedChannel<T>[]>;
    /** nome-base SEM a UF final → canais regionais ("Globo SP" entra em "globo"). */
    byRegionalCore: Map<string, IndexedChannel<T>[]>;
    /** nome-base → canais que são só tag de qualidade ("Globo [4K]"). */
    byQualityOnlyBase: Map<string, IndexedChannel<T>[]>;
}

function push<T>(map: Map<string, IndexedChannel<T>[]>, key: string, entry: IndexedChannel<T>) {
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
}

/** Índice de variantes da lista inteira — uma passada de regex por canal. */
export function buildChannelVariantIndex<T extends QualityChannelName>(channels: T[]): ChannelVariantIndex<T> {
    const index: ChannelVariantIndex<T> = {
        byBase: new Map(),
        byRegionalCore: new Map(),
        byQualityOnlyBase: new Map()
    };

    for (let order = 0; order < channels.length; order++) {
        const channel = channels[order];
        const info = extractChannelInfo(channel.name);
        const entry: IndexedChannel<T> = { channel, info, order };
        const baseLower = info.baseName.toLowerCase();

        push(index.byBase, baseLower, entry);
        if (info.regionSuffix) {
            const words = baseLower.split(' ');
            words.pop();
            push(index.byRegionalCore, words.join(' '), entry);
        }
        if (info.hasOnlyQuality) {
            push(index.byQualityOnlyBase, baseLower, entry);
        }
    }

    return index;
}

export interface ChannelQualityVariant<T> {
    channel: T;
    quality: string;
    priority: number;
    label: string;
}

/**
 * Variantes do canal, da melhor pra pior qualidade. Devolve lista vazia
 * quando só existe uma opção (não há o que escolher).
 */
export function findQualityVariants<T extends QualityChannelName>(
    channel: QualityChannelName,
    index: ChannelVariantIndex<T>
): ChannelQualityVariant<T>[] {
    const currentInfo = extractChannelInfo(channel.name);
    const currentBaseLower = currentInfo.baseName.toLowerCase();

    const picked = new Map<number, IndexedChannel<T>>();
    const take = (list: IndexedChannel<T>[] | undefined) => {
        if (!list) return;
        for (const entry of list) picked.set(entry.order, entry);
    };

    // 1. Mesmo nome-base ("Globo SP" === "Globo SP").
    take(index.byBase.get(currentBaseLower));

    // 2. Canal que é só tag ("Globo [4K]") casa com os regionais ("Globo SP").
    if (currentInfo.hasOnlyQuality && currentBaseLower.length >= 3) {
        take(index.byRegionalCore.get(currentBaseLower));
    }

    // 3. Canal regional ("Globo SP") casa com os que são só tag ("Globo [4K]").
    if (currentInfo.regionSuffix && !currentInfo.hasOnlyQuality) {
        const currentCoreWords = currentBaseLower.split(' ');
        currentCoreWords.pop();
        take(index.byQualityOnlyBase.get(currentCoreWords.join(' ')));
    }

    const variants = [...picked.values()]
        .sort((a, b) => a.order - b.order)
        .map(({ channel: found, info }) => {
            const tagged = !!(info.quality || info.codec);
            return {
                channel: found,
                quality: info.quality || 'SD',
                priority: tagged ? info.priority : 4,
                label: tagged ? info.label : 'SD'
            };
        });

    // Ordenação estável: empate de prioridade mantém a ordem da lista.
    variants.sort((a, b) => a.priority - b.priority);

    return variants.length > 1 ? variants : [];
}
