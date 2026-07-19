/**
 * 🟢 Badge NOVO: some no PRIMEIRO hover do card e não volta mais — o usuário
 * já viu que o item é novo, o selo cumpriu o papel. Persistido por item.
 */

const STORAGE_KEY = 'seen_new_badges_v1';
const MAX_ENTRIES = 800;

function readAll(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
        return [];
    }
}

export function hasSeenNewBadge(type: string, id: string | number): boolean {
    return readAll().includes(`${type}:${id}`);
}

export function markNewBadgeSeen(type: string, id: string | number): void {
    const key = `${type}:${id}`;
    const all = readAll();
    if (all.includes(key)) return;
    all.push(key);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-MAX_ENTRIES)));
    } catch { /* storage cheio: o selo só volta na próxima sessão */ }
}
