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

/** Gravações vencidas (mais velhas que o limite), fora as ativas (PURO). */
export function pickExpiredRecordings<T extends RecordingFileInfo>(files: T[], maxAgeDays: number, nowMs: number): T[] {
    if (maxAgeDays <= 0) return [];
    const cutoff = nowMs - maxAgeDays * 86_400_000;
    return files.filter(file => !file.recording && file.mtimeMs > 0 && file.mtimeMs < cutoff);
}
