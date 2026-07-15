/**
 * Badge "NOVO" no catálogo: item que ENTROU no provedor nos últimos dias
 * (campo `added`/`last_modified`, epoch em segundos) ganha um selo no card.
 * PURO — o "agora" chega de fora pra ficar testável e amigo do lint de pureza.
 */

export const NEW_BADGE_DAYS = 7;

export function isRecentlyAdded(addedEpoch: string | undefined, nowMs: number, days = NEW_BADGE_DAYS): boolean {
    const ms = Number(addedEpoch) * 1000;
    return Number.isFinite(ms) && ms > 0 && nowMs - ms <= days * 86_400_000;
}
