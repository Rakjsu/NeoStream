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

// ---------------------------------------------------------------------------
// ⏳ Limite por perfil (79) + 🕗 janelas de horário (80/86)
// ---------------------------------------------------------------------------

const PROFILE_LIMIT_PREFIX = 'neostream_profile_daily_limit_min_';
const KIDS_HOURS_KEY = 'neostream_kids_allowed_hours';
const AUTO_KIDS_KEY = 'neostream_auto_kids_hours';

export function getProfileDailyLimitMinutes(profileId: string): number {
    return readMinutes(PROFILE_LIMIT_PREFIX + profileId);
}

export function setProfileDailyLimitMinutes(profileId: string, minutes: number): void {
    writeMinutes(PROFILE_LIMIT_PREFIX + profileId, minutes);
}

/** Limite efetivo: o específico do perfil vence; kids sem específico herda o global de kids. */
export function effectiveDailyLimitMinutes(profileId: string, isKids: boolean): number {
    const specific = getProfileDailyLimitMinutes(profileId);
    if (specific > 0) return specific;
    return isKids ? getKidsDailyLimitMinutes() : 0;
}

export interface HoursWindow {
    /** Hora de início, 0–23 (inclusiva). */
    start: number;
    /** Hora de fim, 0–23 (exclusiva). */
    end: number;
}

function readWindow(key: string): HoursWindow | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const match = raw.match(/^(\d{1,2})-(\d{1,2})$/);
        if (!match) return null;
        const start = Number(match[1]);
        const end = Number(match[2]);
        if (start < 0 || start > 23 || end < 0 || end > 23 || start === end) return null;
        return { start, end };
    } catch {
        return null;
    }
}

function writeWindow(key: string, window: HoursWindow | null): void {
    try {
        if (window) localStorage.setItem(key, `${window.start}-${window.end}`);
        else localStorage.removeItem(key);
    } catch { /* storage indisponível */ }
}

/** Janela em que o perfil kids PODE assistir (null = sem restrição). */
export function getKidsAllowedHours(): HoursWindow | null {
    return readWindow(KIDS_HOURS_KEY);
}

export function setKidsAllowedHours(window: HoursWindow | null): void {
    writeWindow(KIDS_HOURS_KEY, window);
}

/** Janela em que o boot troca sozinho pro primeiro perfil kids (null = desligado). */
export function getAutoKidsHours(): HoursWindow | null {
    return readWindow(AUTO_KIDS_KEY);
}

export function setAutoKidsHours(window: HoursWindow | null): void {
    writeWindow(AUTO_KIDS_KEY, window);
}

/** True se `hour` cai em [start, end) — janelas que viram a meia-noite funcionam (PURO). */
export function isHourWithinWindow(hour: number, window: HoursWindow): boolean {
    if (window.start < window.end) return hour >= window.start && hour < window.end;
    return hour >= window.start || hour < window.end; // ex.: 20-6
}
