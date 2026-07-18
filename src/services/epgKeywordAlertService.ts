/**
 * 🔎 Alertas por keyword/regex no EPG: o usuário cadastra termos nas
 * Configurações → EPG e, quando o guia carrega programação futura que
 * casa, cai uma notificação no sino (dedupe persistido, teto de 200).
 */
import { appNotificationService } from './episodeNotificationService';
import { alertKey, matchEpgKeywords } from '../utils/epgKeywords';

const KEYWORDS_KEY = 'neostream_epg_keywords';
const SEEN_KEY = 'neostream_epg_keyword_seen';

export function listKeywords(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(KEYWORDS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
        return [];
    }
}

export function addKeyword(raw: string): string[] {
    const clean = raw.trim().slice(0, 60);
    const current = listKeywords();
    if (!clean || current.some(k => k.toLowerCase() === clean.toLowerCase())) return current;
    const next = [...current, clean].slice(0, 20);
    localStorage.setItem(KEYWORDS_KEY, JSON.stringify(next));
    return next;
}

export function removeKeyword(raw: string): string[] {
    const next = listKeywords().filter(k => k !== raw);
    localStorage.setItem(KEYWORDS_KEY, JSON.stringify(next));
    return next;
}

function loadSeen(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
        return [];
    }
}

/** Varre o EPG carregado e notifica só os matches inéditos. */
export function scanEpgForKeywords(
    entries: Iterable<[string, { title: string; start: string }[]]>,
    nowMs = Date.now()
): number {
    const keywords = listKeywords();
    if (!keywords.length) return 0;
    const seen = loadSeen();
    const seenSet = new Set(seen);
    let fired = 0;
    for (const match of matchEpgKeywords(entries, keywords, nowMs)) {
        const key = alertKey(match);
        if (seenSet.has(key)) continue;
        seenSet.add(key);
        seen.push(key);
        fired += 1;
        const when = new Date(match.startIso);
        const hh = String(when.getHours()).padStart(2, '0');
        const mm = String(when.getMinutes()).padStart(2, '0');
        appNotificationService.addNotification({
            type: 'epg_keyword',
            title: `🔎 ${match.keyword}`,
            message: `${match.title} — ${match.channelKey} · ${hh}:${mm}`,
        });
    }
    if (fired) {
        try {
            localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-200)));
        } catch { /* melhor perder dedupe do que travar o scan */ }
    }
    return fired;
}
