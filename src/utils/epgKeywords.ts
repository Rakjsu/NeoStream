/**
 * Alertas por palavra-chave no EPG: termo simples vira busca
 * case-insensitive com escape; "/padrão/flags" vira RegExp de verdade.
 * PURO — o serviço cuida de storage/notificação.
 */
export interface KeywordAlertMatch {
    keyword: string;
    channelKey: string;
    title: string;
    startIso: string;
}

export function compileKeyword(raw: string): RegExp | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const asRegex = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
    try {
        if (asRegex) {
            const flags = asRegex[2].includes('i') ? asRegex[2] : `${asRegex[2]}i`;
            return new RegExp(asRegex[1], flags);
        }
        return new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch {
        return null; // regex inválida do usuário não derruba o scan
    }
}

/** Programas FUTUROS cujo título casa com alguma keyword (1 alerta/programa). */
export function matchEpgKeywords(
    entries: Iterable<[string, { title: string; start: string }[]]>,
    keywords: string[],
    nowMs: number
): KeywordAlertMatch[] {
    const compiled = keywords
        .map(keyword => ({ keyword, regex: compileKeyword(keyword) }))
        .filter((entry): entry is { keyword: string; regex: RegExp } => !!entry.regex);
    if (!compiled.length) return [];
    const matches: KeywordAlertMatch[] = [];
    for (const [channelKey, programs] of entries) {
        for (const program of programs) {
            const startMs = Date.parse(program.start);
            if (!Number.isFinite(startMs) || startMs <= nowMs) continue;
            for (const { keyword, regex } of compiled) {
                if (regex.test(program.title)) {
                    matches.push({ keyword, channelKey, title: program.title, startIso: program.start });
                    break;
                }
            }
        }
    }
    return matches;
}

/** Chave de dedupe (não re-notificar o mesmo programa). */
export function alertKey(match: KeywordAlertMatch): string {
    return `${match.channelKey}|${match.title}|${match.startIso}`;
}
