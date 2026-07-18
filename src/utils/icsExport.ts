/**
 * Exportação .ics da Agenda (lembretes ⏰ + gravações agendadas ⏺). PURO —
 * gera o texto VCALENDAR; o download em si é um blob no componente.
 */
export interface IcsEvent {
    title: string;
    startMs: number;
    /** Sem fim conhecido (lembrete) → o evento assume 1h. */
    endMs?: number;
    description?: string;
}

/** Data no formato básico UTC do RFC 5545 (YYYYMMDDTHHMMSSZ). */
function icsDate(ms: number): string {
    return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeIcsText(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

const HOUR_MS = 60 * 60 * 1000;

export function buildIcs(events: IcsEvent[], nowMs: number): string {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//NeoStream//Agenda//PT',
        'CALSCALE:GREGORIAN',
    ];
    events.forEach((event, index) => {
        lines.push(
            'BEGIN:VEVENT',
            `UID:neostream-${nowMs}-${index}@neostream`,
            `DTSTAMP:${icsDate(nowMs)}`,
            `DTSTART:${icsDate(event.startMs)}`,
            `DTEND:${icsDate(event.endMs ?? event.startMs + HOUR_MS)}`,
            `SUMMARY:${escapeIcsText(event.title)}`,
        );
        if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
        lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
}
