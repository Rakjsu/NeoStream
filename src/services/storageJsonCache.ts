/**
 * Cache de `JSON.parse` para os blobs de estado do usuário no localStorage.
 *
 * Perfis, favoritos, ver-depois e progresso são lidos POR CARD da grade de
 * Filmes/Séries — e cada leitura reparseava o blob inteiro (histórico de meses,
 * dezenas de KB). Numa janela de 60 cards isso dava centenas de parses POR
 * FRAME de scroll.
 *
 * A chave de validade é a PRÓPRIA STRING CRUA: se o texto no localStorage
 * mudou — por escrita daqui, por restauração de backup, pelo sync entre
 * máquinas ou por outra janela — a comparação erra e o valor é reparseado. Não
 * existe invalidação manual pra alguém esquecer de chamar, que é justamente o
 * jeito de um cache virar bug silencioso.
 *
 * Efeito colateral aproveitado de propósito: enquanto o texto não muda, a
 * MESMA referência é devolvida. Isso deixa `useMemo(..., [lista])` do lado da
 * página ser correto por construção — identidade nova significa dado novo.
 *
 * Restrição: quem muta o objeto devolvido tem que gravar em seguida (é o que
 * todos os serviços daqui fazem — ler, mutar, salvar). Mutar e NÃO salvar
 * deixaria o cache divergente do disco.
 */

interface CacheEntry {
    raw: string;
    value: unknown;
}

const cache = new Map<string, CacheEntry>();

/**
 * Lê e parseia `key`, reaproveitando o parse anterior enquanto o texto cru for
 * idêntico. Devolve `fallback` quando a chave não existe ou o JSON é inválido.
 */
export function readJson<T>(key: string, fallback: T): T {
    let raw: string | null;
    try {
        raw = localStorage.getItem(key);
    } catch {
        return fallback;
    }
    if (raw === null) {
        cache.delete(key);
        return fallback;
    }

    const hit = cache.get(key);
    if (hit !== undefined && hit.raw === raw) return hit.value as T;

    try {
        const value = JSON.parse(raw) as T;
        cache.set(key, { raw, value });
        return value;
    } catch {
        cache.delete(key);
        return fallback;
    }
}

/** Só para testes: zera o cache entre casos. */
export function resetStorageJsonCache(): void {
    cache.clear();
}
