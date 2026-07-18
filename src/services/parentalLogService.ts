/**
 * 📜 Log parental: registro das verificações de PIN (parental e de perfil)
 * pra os pais auditarem tentativas. Fila em localStorage com teto — os
 * eventos mais novos ficam no topo.
 */

export type ParentalEventKind = 'pin_fail' | 'pin_ok';

export interface ParentalLogEntry {
    ts: number;
    kind: ParentalEventKind;
    detail: string;
}

const STORAGE_KEY = 'neostream_parental_log';
const MAX_ENTRIES = 200;

export function listParentalLog(): ParentalLogEntry[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed as ParentalLogEntry[] : [];
    } catch {
        return [];
    }
}

export function logParentalEvent(kind: ParentalEventKind, detail: string): void {
    try {
        const entries = listParentalLog();
        entries.unshift({ ts: Date.now(), kind, detail: detail.slice(0, 80) });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    } catch { /* storage indisponível */ }
}

export function clearParentalLog(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
}
