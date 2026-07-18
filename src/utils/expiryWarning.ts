/**
 * Aviso de expiração da lista: o exp_date do player_api (epoch em
 * segundos) vira "faltam N dias" e o banner da Home avisa com 7 dias de
 * antecedência. PURO — datas injetadas, testável.
 */
export const EXPIRY_SNOOZE_KEY = 'neostream_expiry_snooze';

/** Dias inteiros até expirar (negativo = já expirou); null = sem/ilimitada. */
export function daysToExpiry(expDate: string | number | null | undefined, nowMs: number): number | null {
    if (expDate === null || expDate === undefined || expDate === '' || expDate === 0 || expDate === '0') {
        return null;
    }
    const seconds = Number(expDate);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.floor((seconds * 1000 - nowMs) / 86_400_000);
}

/** Avisa na última semana (e depois de expirada). */
export function shouldWarnExpiry(days: number | null, warnDays = 7): boolean {
    return days !== null && days <= warnDays;
}

/** true enquanto o "dispensar por 24h" ainda vale. */
export function isExpirySnoozed(raw: string | null, nowMs: number): boolean {
    const until = Number(raw);
    return Number.isFinite(until) && until > nowMs;
}
