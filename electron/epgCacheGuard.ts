/**
 * Confinamento do `cacheKey` do EPG — puro, sem I/O.
 *
 * O `cacheKey` vem do renderer e é interpolado cru no caminho:
 *
 * ```ts
 * path.join(app.getPath('userData'), 'epg_cache', `${cacheKey}.xml`)
 * ```
 *
 * `path.join` **normaliza, não confina**: com `cacheKey: '../config'` isso
 * resolve para `userData/config.xml`, e o handler grava ali o corpo da URL que
 * o mesmo chamador escolheu. Escrita de arquivo fora da pasta de cache, com
 * conteúdo controlado — é a mesma classe que o `downloadPaths.ts` já fechou
 * para o nome da série.
 *
 * Todo `cacheKey` real é um identificador curto gerado pelo próprio código
 * (`user-external`, `portugal1`…`usa10`), então o formato pode ser estreito.
 */
export function cacheKeyValido(cacheKey: unknown): cacheKey is string {
    return typeof cacheKey === 'string' && /^[a-z0-9_-]{1,40}$/i.test(cacheKey)
}
