/**
 * 🔁 Regras de gravação automática: "grave tudo cujo título casar com este
 * regex" (opcionalmente restrito a um canal). O guia aplica as regras sobre a
 * grade carregada e agenda os programas futuros que casarem.
 */

export interface RecordingRule {
    id: string;
    /** Regex (case-insensitive) aplicado ao título do programa. */
    pattern: string;
    /** Se presente, o nome do canal precisa conter este texto. */
    channelName?: string;
    createdAt: string;
}

const STORAGE_KEY = 'recording_rules_v1';

function readAll(): RecordingRule[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed as RecordingRule[] : [];
    } catch {
        return [];
    }
}

/** true se algum regex casa o título (e o canal, quando a regra restringe). */
export function ruleMatches(rules: RecordingRule[], title: string, channelName: string): boolean {
    for (const rule of rules) {
        let regex: RegExp;
        try {
            regex = new RegExp(rule.pattern, 'i');
        } catch {
            continue; // regra corrompida não derruba o matching
        }
        if (!regex.test(title)) continue;
        if (rule.channelName && !channelName.toLowerCase().includes(rule.channelName.toLowerCase())) continue;
        return true;
    }
    return false;
}

export const recordingRuleService = {
    list(): RecordingRule[] {
        return readAll();
    },

    /** Valida o regex e deduplica; false quando inválido ou repetido. */
    add(pattern: string, channelName?: string): boolean {
        const trimmed = pattern.trim();
        if (!trimmed) return false;
        try {
            new RegExp(trimmed, 'i');
        } catch {
            return false;
        }
        const channel = channelName?.trim() || undefined;
        const all = readAll();
        if (all.some(r => r.pattern === trimmed && (r.channelName ?? '') === (channel ?? ''))) return false;
        all.push({
            id: `${Date.now().toString(36)}-${all.length}`,
            pattern: trimmed,
            channelName: channel,
            createdAt: new Date().toISOString()
        });
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        } catch { /* storage cheio: regra só não persiste */ }
        return true;
    },

    remove(id: string): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(readAll().filter(r => r.id !== id)));
        } catch { /* best-effort */ }
    }
};
