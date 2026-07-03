/**
 * Native notification when the catalog refresh finds new episodes on
 * followed series. Opt-in (Settings → Reprodução). The first sighting of a
 * session only primes the memory — otherwise every app boot would notify
 * about series the user simply hasn't opened yet.
 */

const CONFIG_KEY = 'neostream_notify_new_episodes';

export interface NotifierState {
    primed: boolean;
    seenIds: Set<string>;
}

export function createNotifierState(): NotifierState {
    return { primed: false, seenIds: new Set() };
}

/**
 * Pure core: which series ids are NEW relative to the session memory.
 * First call primes and returns nothing; later calls return only additions.
 * (exported for tests)
 */
export function pickNewlyFlagged(state: NotifierState, currentIds: string[]): string[] {
    if (!state.primed) {
        state.primed = true;
        currentIds.forEach(id => state.seenIds.add(id));
        return [];
    }
    const fresh = currentIds.filter(id => !state.seenIds.has(id));
    fresh.forEach(id => state.seenIds.add(id));
    return fresh;
}

/** Notification body for 1..N series (exported for tests). */
export function buildNotificationBody(names: string[], template: { one: string; many: string }): string {
    if (names.length === 1) return template.one.replace('{name}', names[0]);
    return template.many.replace('{count}', String(names.length)).replace('{name}', names[0]);
}

const sessionState = createNotifierState();

export const newEpisodeNotifier = {
    isEnabled(): boolean {
        try {
            return localStorage.getItem(CONFIG_KEY) === '1';
        } catch {
            return false;
        }
    },

    setEnabled(enabled: boolean): void {
        try {
            localStorage.setItem(CONFIG_KEY, enabled ? '1' : '0');
        } catch { /* best-effort */ }
    },

    /**
     * Called with the CURRENT updated-series list (id + name) after each
     * catalog (re)load. Notifies only for additions after the first call.
     */
    maybeNotify(series: Array<{ id: string; name: string }>, texts: { title: string; one: string; many: string }): void {
        const fresh = pickNewlyFlagged(sessionState, series.map(s => s.id));
        if (fresh.length === 0 || !this.isEnabled()) return;

        const freshNames = series.filter(s => fresh.includes(s.id)).map(s => s.name);
        try {
            new Notification(texts.title, {
                body: buildNotificationBody(freshNames, { one: texts.one, many: texts.many }),
                silent: false
            });
        } catch { /* notifications unavailable — badge/row still show it */ }
    }
};
