/**
 * 🔌 O limite de conexões simultâneas que o provedor declara.
 *
 * Todo `player_api.php` devolve `user_info.max_connections`, e o app só o
 * escrevia no log (`xtreamClient.ts:96`). Enquanto isso a fila de downloads
 * abria de 1 a 4 conexões conforme a escolha do usuário, sem nunca perguntar
 * quantas o provedor aceita — e a maioria dos planos vende UMA. O sintoma para
 * quem usa é o download que morre na metade sem explicação, ou o filme que
 * trava porque o download roubou a única conexão.
 */

/**
 * Lê o `max_connections` do `user_info`, ou `null` quando o provedor não
 * declara nada utilizável.
 *
 * O Xtream manda esse campo como STRING (`"1"`) na maioria dos painéis e como
 * número em alguns — daí aceitar os dois. `"0"` e `"unlimited"` aparecem em
 * painéis que não impõem limite: viram `null`, que significa "não sei" e deixa
 * a escolha do usuário valer inteira, em vez de virar um teto de zero.
 */
export function lerMaxConexoes(userInfo: unknown): number | null {
    if (!userInfo || typeof userInfo !== 'object') return null;
    const bruto = (userInfo as Record<string, unknown>).max_connections;
    if (typeof bruto !== 'number' && typeof bruto !== 'string') return null;
    const n = Number(bruto);
    if (!Number.isFinite(n)) return null;
    const inteiro = Math.floor(n);
    return inteiro >= 1 ? inteiro : null;
}

/**
 * Quantos downloads podem correr juntos: o menor entre o que o usuário pediu e
 * o que o provedor aceita.
 *
 * Uma ressalva honesta que a conta NÃO resolve: assistir também gasta uma
 * conexão. Num plano de 1, baixar enquanto assiste vai falhar de qualquer
 * jeito. Descontar a reprodução aqui exigiria adivinhar o que está tocando —
 * heurística frágil que erraria nos dois sentidos. O teto continua sendo o
 * declarado; o que este cálculo evita é o app sozinho abrir mais conexões do
 * que o provedor jamais aceitaria.
 */
export function limiteEfetivoDeDownloads(escolhido: number, doProvedor: number | null): number {
    const base = Number.isFinite(escolhido) && escolhido >= 1 ? Math.floor(escolhido) : 1;
    if (doProvedor === null) return base;
    return Math.max(1, Math.min(base, doProvedor));
}
