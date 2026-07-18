/**
 * 🧹 Auto-faxina do DVR (port do mobile): gravações mais velhas que N dias
 * saem sozinhas ao abrir a página de Gravações (0 = desligada). Gravação em
 * ANDAMENTO nunca entra na varredura. Seleção PURA; só o storage é efeito.
 */

export interface RecordingFileInfo {
    path: string;
    mtimeMs: number;
    recording?: boolean;
}

const STORAGE_KEY = 'neostream_dvr_max_age_days';

export function getDvrMaxAgeDays(): number {
    try {
        const days = Number(localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(days) && days > 0 ? days : 0;
    } catch {
        return 0;
    }
}

export function setDvrMaxAgeDays(days: number): void {
    try {
        if (days > 0) localStorage.setItem(STORAGE_KEY, String(days));
        else localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage indisponível */ }
}

const PROTECTED_KEY = 'neostream_dvr_protected';

/** Gravações marcadas como 🔐 protegidas — a auto-faxina nunca as apaga. */
export function getProtectedRecordings(): Set<string> {
    try {
        const parsed = JSON.parse(localStorage.getItem(PROTECTED_KEY) || '[]');
        return new Set(Array.isArray(parsed) ? parsed.filter(p => typeof p === 'string') : []);
    } catch {
        return new Set();
    }
}

export function toggleProtectedRecording(filePath: string): Set<string> {
    const current = getProtectedRecordings();
    if (current.has(filePath)) current.delete(filePath);
    else current.add(filePath);
    try {
        localStorage.setItem(PROTECTED_KEY, JSON.stringify([...current]));
    } catch { /* storage indisponível */ }
    return current;
}

/** Gravações vencidas (mais velhas que o limite), fora ativas e protegidas (PURO). */
export function pickExpiredRecordings<T extends RecordingFileInfo>(files: T[], maxAgeDays: number, nowMs: number, protectedPaths?: Set<string>): T[] {
    if (maxAgeDays <= 0) return [];
    const cutoff = nowMs - maxAgeDays * 86_400_000;
    return files.filter(file => !file.recording && !protectedPaths?.has(file.path) && file.mtimeMs > 0 && file.mtimeMs < cutoff);
}
