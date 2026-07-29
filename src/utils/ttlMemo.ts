/**
 * Memo assíncrono com TTL, deduplicação de chamadas em voo e teto de entradas.
 *
 * Nasceu do mini-guia da TV ao vivo: a mesma cadeia de EPG era refeita a cada
 * zap e a cada 60 s, e em zapping rápido várias cadeias do mesmo canal ficavam
 * vivas ao mesmo tempo (cada uma segurando seu array de programas). Aqui:
 * - chave repetida dentro do TTL → devolve o valor guardado, sem trabalho;
 * - chave já em voo → devolve a MESMA promise (uma busca, não N);
 * - falha não vira cache (o próximo pedido tenta de novo).
 *
 * Puro o bastante pra teste: o relógio é injetável.
 */

export interface TtlMemoOptions {
    ttlMs: number;
    /** Teto de chaves guardadas (descarta a mais antiga). */
    maxEntries?: number;
    now?: () => number;
}

export interface TtlMemo<T> {
    /** Valor fresco já guardado, sem disparar carga nenhuma. */
    peek(key: string): T | undefined;
    /** Valor do cache, da carga em voo, ou uma carga nova. */
    run(key: string, load: () => Promise<T>): Promise<T>;
    clear(): void;
    /** Quantas chaves guardadas (diagnóstico/teste). */
    size(): number;
}

export function createTtlMemo<T>({ ttlMs, maxEntries = 64, now = Date.now }: TtlMemoOptions): TtlMemo<T> {
    const entries = new Map<string, { value: T; at: number }>();
    const inFlight = new Map<string, Promise<T>>();

    const peek = (key: string): T | undefined => {
        const hit = entries.get(key);
        if (!hit) return undefined;
        if (now() - hit.at >= ttlMs) {
            entries.delete(key);
            return undefined;
        }
        return hit.value;
    };

    const store = (key: string, value: T) => {
        // Map preserva ordem de inserção: a primeira chave é a mais antiga.
        entries.delete(key);
        entries.set(key, { value, at: now() });
        while (entries.size > maxEntries) {
            const oldest = entries.keys().next();
            if (oldest.done) break;
            entries.delete(oldest.value);
        }
    };

    return {
        peek,
        run(key, load) {
            const cached = peek(key);
            if (cached !== undefined) return Promise.resolve(cached);

            const running = inFlight.get(key);
            if (running) return running;

            const promise = load().then(
                value => {
                    inFlight.delete(key);
                    store(key, value);
                    return value;
                },
                error => {
                    inFlight.delete(key);
                    throw error;
                }
            );
            inFlight.set(key, promise);
            return promise;
        },
        clear() {
            entries.clear();
            inFlight.clear();
        },
        size() {
            return entries.size;
        }
    };
}
