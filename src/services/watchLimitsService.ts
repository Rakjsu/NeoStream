/**
 * ⏰🎯 Limites de uso (port do mobile): limite diário de tela pro perfil
 * infantil (bloqueia o player quando estoura) e meta diária de consumo do
 * usuário (barra de progresso no Seu uso). Helpers PUROS; só o storage é efeito.
 */

const KIDS_LIMIT_KEY = 'neostream_kids_daily_limit_min';
const DAILY_GOAL_KEY = 'neostream_daily_goal_min';

function readMinutes(key: string): number {
    try {
        const minutes = Number(localStorage.getItem(key));
        return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
    } catch {
        return 0;
    }
}

function writeMinutes(key: string, minutes: number): void {
    try {
        if (minutes > 0) localStorage.setItem(key, String(minutes));
        else localStorage.removeItem(key);
    } catch { /* storage indisponível */ }
}

export function getKidsDailyLimitMinutes(): number {
    return readMinutes(KIDS_LIMIT_KEY);
}

export function setKidsDailyLimitMinutes(minutes: number): void {
    writeMinutes(KIDS_LIMIT_KEY, minutes);
}

export function getDailyGoalMinutes(): number {
    return readMinutes(DAILY_GOAL_KEY);
}

export function setDailyGoalMinutes(minutes: number): void {
    writeMinutes(DAILY_GOAL_KEY, minutes);
}

/** True quando o limite está ligado e o tempo de hoje já o alcançou (PURO). */
export function isLimitExceeded(todaySeconds: number, limitMinutes: number): boolean {
    return limitMinutes > 0 && todaySeconds >= limitMinutes * 60;
}

/** Progresso da meta diária em % inteiro, teto 100; 0 com meta desligada (PURO). */
export function goalProgressPct(todaySeconds: number, goalMinutes: number): number {
    if (goalMinutes <= 0) return 0;
    return Math.min(100, Math.round((todaySeconds / (goalMinutes * 60)) * 100));
}
