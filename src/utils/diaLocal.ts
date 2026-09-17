/**
 * O dia do calendário de quem está na frente da TV.
 *
 * As estatísticas carimbavam o dia com `new Date().toISOString().split('T')[0]`
 * — a data em **UTC**. No Brasil (UTC−3), tudo o que a pessoa assiste depois
 * das 21h já é "amanhã" para o app:
 *
 * - sábado 22h e domingo 20h viram o MESMO dia, então os dois somam num balde
 *   só e a sequência ("🔥 3 dias") não anda;
 * - sexta 19h e sábado 22h viram dias NÃO consecutivos, e a sequência zera
 *   depois de duas noites seguidas assistindo.
 *
 * O resto do app já lê essas strings como dia local — `wrappedHelpers` monta
 * `new Date(\`${dia}T12:00:00\`)` com o comentário "noon avoids TZ day-shift",
 * e o heatmap de hábito faz `new Date(ano, mes - 1, dia)`. Quem estava fora da
 * convenção era justamente quem escreve.
 *
 * Mora em `utils/` porque o escritor (`usageStatsService`) e os leitores
 * (player, controle web, Configurações) precisam do MESMO "hoje": se um
 * carimba local e outro procura em UTC, o `find` não acha nada e a tela mostra
 * zero — no caso do limite diário infantil, "zero" significa cota liberada.
 */

/** `YYYY-MM-DD` no fuso do aparelho. */
export function diaLocal(date: Date): string {
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const dia = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${mes}-${dia}`;
}

/** `YYYY-MM` no fuso do aparelho. */
export function mesLocal(date: Date): string {
    return diaLocal(date).slice(0, 7);
}
