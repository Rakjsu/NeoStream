/**
 * Fileiras do Início personalizáveis (port do mobile): o usuário escolhe a
 * ORDEM e quais fileiras aparecem na página inicial (Configurações →
 * Aparência). Helpers PUROS; só load/save tocam o localStorage.
 */

export const HOME_RAIL_KEYS = [
    'continue',
    'newEpisodes',
    'nextEpisodes',
    'recommendations',
    'recentSeries',
    'recentMovies',
] as const;

export type HomeRailKey = typeof HOME_RAIL_KEYS[number];

export interface HomeRailPrefs {
    order: HomeRailKey[];
    hidden: HomeRailKey[];
}

const STORAGE_KEY = 'neostream_home_rails';

export function defaultHomeRailPrefs(): HomeRailPrefs {
    return { order: [...HOME_RAIL_KEYS], hidden: [] };
}

/** Sanitiza prefs vindas do storage: chave estranha sai, faltante entra no fim (PURO). */
export function sanitizeHomeRailPrefs(raw: unknown): HomeRailPrefs {
    const parsed = (raw ?? {}) as Partial<HomeRailPrefs>;
    const known = new Set<string>(HOME_RAIL_KEYS);
    const order = (Array.isArray(parsed.order) ? parsed.order : [])
        .filter((key): key is HomeRailKey => known.has(key as string));
    for (const key of HOME_RAIL_KEYS) {
        if (!order.includes(key)) order.push(key);
    }
    const hidden = (Array.isArray(parsed.hidden) ? parsed.hidden : [])
        .filter((key): key is HomeRailKey => known.has(key as string));
    return { order, hidden };
}

export function loadHomeRailPrefs(): HomeRailPrefs {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return sanitizeHomeRailPrefs(raw ? JSON.parse(raw) : null);
    } catch {
        return defaultHomeRailPrefs();
    }
}

export function saveHomeRailPrefs(prefs: HomeRailPrefs): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch { /* storage indisponível */ }
}

/** Fileiras visíveis, na ordem escolhida (PURO). */
export function orderedHomeRails(prefs: HomeRailPrefs): HomeRailKey[] {
    return prefs.order.filter(key => !prefs.hidden.includes(key));
}

/** Move a fileira ±1 posição, sem mutar (PURO). */
export function moveHomeRail(prefs: HomeRailPrefs, key: HomeRailKey, delta: -1 | 1): HomeRailPrefs {
    const index = prefs.order.indexOf(key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= prefs.order.length) return prefs;
    const order = [...prefs.order];
    [order[index], order[target]] = [order[target], order[index]];
    return { ...prefs, order };
}

/** Liga/desliga a fileira, sem mutar (PURO). */
export function toggleHomeRail(prefs: HomeRailPrefs, key: HomeRailKey): HomeRailPrefs {
    const hidden = prefs.hidden.includes(key)
        ? prefs.hidden.filter(item => item !== key)
        : [...prefs.hidden, key];
    return { ...prefs, hidden };
}
