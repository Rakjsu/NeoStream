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

/**
 * Sobra que o provedor pendura DEPOIS do título e que não muda a obra:
 * idioma/áudio, legenda, qualidade, formato. Só etiquetas técnicas — nunca
 * nome de canal, provedor ou fonte.
 */
const ETIQUETAS_DE_PROVEDOR = new Set([
    'dublado', 'dublada', 'dub', 'dubbed', 'doblado', 'doblada', 'nacional', 'dual', 'audio', 'multi',
    'legendado', 'legendada', 'leg', 'sub', 'subs', 'subbed', 'subtitulado', 'subtitulada', 'latino', 'castellano',
    'pt', 'br', 'ptbr', 'en', 'es', 'original',
    '4k', 'uhd', 'fhd', 'hd', 'sd', 'hdr', 'hdr10', 'dv', '3d', 'imax',
    '2160p', '1080p', '720p', '480p', 'bluray', 'remux', 'web', 'webdl', 'webrip', 'dl', 'hdtv', 'hdcam', 'cam',
]);
const ANO_NA_SOBRA = /^(19|20)\d{2}$/;

/**
 * A sobra (já normalizada) é só ruído de provedor? Ano conta como ruído quando
 * é um ano de lançamento plausível e, se a ficha SABE o ano da obra, é ele
 * (±1: estreia em outro país). Qualquer outra palavra — "2", "covenant",
 * "parte" — é outra obra: "Toy Story" não pode abrir "Toy Story 2".
 */
export function sobraEhRuidoDoProvedor(sobra: string, ano?: number): boolean {
    const tokens = sobra.split(' ').filter(Boolean);
    if (tokens.length === 0) return false;
    const limite = new Date().getFullYear() + 1;
    return tokens.every(token => {
        if (ANO_NA_SOBRA.test(token)) {
            const n = Number(token);
            if (n > limite) return false;
            return ano === undefined || Math.abs(n - ano) <= 1;
        }
        return ETIQUETAS_DE_PROVEDOR.has(token);
    });
}

/** Um título TMDB a achar no catálogo; `release_date` (AAAA-MM-DD) quando o TMDB traz. */
export interface TituloProcurado { title: string; release_date?: string; }

/** Ano de lançamento de uma data do TMDB ("2023-07-19" → 2023); vazio/lixo → undefined. */
function anoDoLancamento(data: string | undefined): number | undefined {
    const ano = Number(data?.slice(0, 4));
    return Number.isInteger(ano) && ano > 0 ? ano : undefined;
}

/**
 * Casa títulos TMDB com o índice título-normalizado→id do catálogo e devolve
 * o id de CADA título (mesma ordem da entrada; `undefined` = não está no app).
 *
 * A ficha precisa do PAR título→id (o card é do TMDB e o clique abre o id),
 * por isso não dá pra reusar `matchCatalogByTitles`, que devolve os itens.
 * A regra é a mesma — igualdade, ou o nome do provedor começa com o título —,
 * mas mais estrita no prefixo, porque aqui um card é um clique que abre UMA
 * ficha: a sobra tem de ser ruído de provedor (`sobraEhRuidoDoProvedor`).
 *
 * O ano de lançamento entra sempre que o TMDB o traz: sem ele, o "Duna" de
 * 2021 abriria a listagem "Duna 1984 Dublado" (remake não é a mesma obra).
 *
 * Precedência: igualdade exata vence; entre prefixos, vence o nome mais curto
 * (o mais perto do título), e no empate o primeiro do catálogo.
 *
 * Custo: a ficha chama isto três vezes ao abrir (Parecidos, filmografia,
 * franquia). Varrer o índice inteiro a cada chamada custava ~30 ms com 40 mil
 * títulos; com as chaves ORDENADAS uma vez por índice (`indiceOrdenado`), cada
 * título procurado vira uma busca binária pelo começo da faixa `"<título> "`.
 */
export function resolveCatalogIds(
    index: Map<string, string>,
    procurados: TituloProcurado[]
): (string | undefined)[] {
    const ids: (string | undefined)[] = procurados.map(() => undefined);
    const pendentes = new Map<string, number[]>();
    procurados.forEach((p, i) => {
        const norm = normalizeTitle(p.title);
        if (!norm) return;
        const exato = index.get(norm);
        if (exato !== undefined) { ids[i] = exato; return; }
        // Mesmo piso do matchCatalogByTitles: título curto demais no prefixo
        // é falso positivo em massa.
        if (norm.length < 3) return;
        const lista = pendentes.get(norm);
        if (lista) lista.push(i); else pendentes.set(norm, [i]);
    });
    if (pendentes.size === 0) return ids;

    const ordenado = indiceOrdenado(index);
    for (const [norm, lista] of pendentes) {
        const prefixo = `${norm} `;
        for (const i of lista) {
            const ano = anoDoLancamento(procurados[i].release_date);
            let melhor = -1;
            // Chaves que começam com "<título> " ficam contíguas na ordem.
            for (let k = primeiraChaveAPartirDe(ordenado.chaves, prefixo); k < ordenado.chaves.length; k++) {
                const chave = ordenado.chaves[k];
                if (!chave.startsWith(prefixo)) break;
                if (!sobraEhRuidoDoProvedor(chave.slice(prefixo.length), ano)) continue;
                if (melhor === -1
                    || chave.length < ordenado.chaves[melhor].length
                    || (chave.length === ordenado.chaves[melhor].length && ordenado.ordem[k] < ordenado.ordem[melhor])) {
                    melhor = k;
                }
            }
            if (melhor !== -1) ids[i] = ordenado.ids[melhor];
        }
    }
    return ids;
}

interface IndiceOrdenado {
    /** Tamanho do índice quando foi ordenado — índice que cresceu é reordenado. */
    tamanho: number;
    chaves: string[];
    ids: string[];
    /** Posição de cada chave no índice original: o empate vai pro primeiro do catálogo. */
    ordem: number[];
}

const ordenados = new WeakMap<Map<string, string>, IndiceOrdenado>();

/** Chaves do índice em ordem, uma vez por índice (o do catálogo é da sessão inteira). */
function indiceOrdenado(index: Map<string, string>): IndiceOrdenado {
    const guardado = ordenados.get(index);
    if (guardado && guardado.tamanho === index.size) return guardado;
    const entradas = [...index].map(([chave, id], ordem) => ({ chave, id, ordem }));
    entradas.sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
    const novo: IndiceOrdenado = {
        tamanho: index.size,
        chaves: entradas.map(e => e.chave),
        ids: entradas.map(e => e.id),
        ordem: entradas.map(e => e.ordem),
    };
    ordenados.set(index, novo);
    return novo;
}

/** Primeira posição cuja chave é >= `alvo` (busca binária). */
function primeiraChaveAPartirDe(chaves: string[], alvo: string): number {
    let baixo = 0;
    let alto = chaves.length;
    while (baixo < alto) {
        const meio = (baixo + alto) >>> 1;
        if (chaves[meio] < alvo) baixo = meio + 1;
        else alto = meio;
    }
    return baixo;
}
