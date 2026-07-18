import { useCallback, useEffect, useState } from 'react';
import { reminderService } from '../services/reminderService';
import { scheduledRecordingService } from '../services/scheduledRecordingService';
import { buildAgenda, groupAgendaByDay, isRecordingInFlight, type AgendaEntry } from '../utils/agenda';
import { buildIcs } from '../utils/icsExport';
import { useLanguage } from '../services/languageService';

/**
 * Unified agenda: upcoming program reminders (⏰) and scheduled DVR
 * recordings (⏺) in one chronological list, grouped by day, each row
 * cancelable in place. Rendered inside the Downloads page.
 */
export function AgendaPanel() {
    const { t } = useLanguage();
    // "now" lives in state so render stays pure; a minute tick keeps the
    // in-flight badge and day grouping honest while the panel is open.
    const [now, setNow] = useState(0);
    useEffect(() => {
        queueMicrotask(() => setNow(Date.now()));
        const interval = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(interval);
    }, []);

    const entries = now === 0 ? [] : buildAgenda(reminderService.list(), scheduledRecordingService.list(), now);
    const groups = groupAgendaByDay(entries, now);

    const cancel = useCallback((entry: AgendaEntry) => {
        if (entry.kind === 'reminder') {
            reminderService.removeReminder(entry.id);
        } else {
            scheduledRecordingService.remove(entry.id);
        }
        setNow(Date.now());
    }, []);

    // 📆 Exporta a agenda como .ics (abre no Google Agenda/Outlook/etc).
    const exportIcs = useCallback(() => {
        const nowMs = Date.now();
        const events = buildAgenda(reminderService.list(), scheduledRecordingService.list(), nowMs).map(entry => {
            const endMs = entry.kind === 'recording' && entry.endIso ? Date.parse(entry.endIso) : NaN;
            return {
                title: `${entry.kind === 'reminder' ? '⏰' : '⏺'} ${entry.title}`,
                startMs: entry.startMs,
                endMs: Number.isFinite(endMs) ? endMs : undefined,
                description: entry.channelName,
            };
        });
        const blob = new Blob([buildIcs(events, nowMs)], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'neostream-agenda.ics';
        link.click();
        URL.revokeObjectURL(url);
    }, []);

    const fmtTime = (iso: string) =>
        new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const dayLabel = (day: string) => {
        if (day === 'today') return t('agenda', 'today');
        if (day === 'tomorrow') return t('agenda', 'tomorrow');
        return new Date(day + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    };

    return (
        <div style={{
            margin: '0 0 20px',
            padding: 18,
            borderRadius: 16,
            background: 'rgba(59, 130, 246, 0.06)',
            border: '1px solid rgba(59, 130, 246, 0.25)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ color: 'white', fontSize: 16, margin: 0 }}>
                    🗓️ {t('agenda', 'title')}
                </h3>
                {entries.length > 0 && (
                    <button
                        onClick={exportIcs}
                        title={t('agenda', 'exportIcsHint')}
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)', borderRadius: 10, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
                    >
                        📆 {t('agenda', 'exportIcs')}
                    </button>
                )}
            </div>

            {entries.length === 0 ? (
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: 0 }}>
                    {t('agenda', 'empty')}
                </p>
            ) : (
                groups.map(group => (
                    <div key={group.day} style={{ marginBottom: 14 }}>
                        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                            {dayLabel(group.day)}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {group.entries.map(entry => {
                                const inFlight = isRecordingInFlight(entry, now);
                                return (
                                    <div
                                        key={`${entry.kind}-${entry.id}`}
                                        className="agenda-row"
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            padding: '10px 14px',
                                            borderRadius: 10,
                                            background: 'rgba(255,255,255,0.04)',
                                            border: inFlight ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(255,255,255,0.07)'
                                        }}
                                    >
                                        <span style={{ fontSize: 16, flexShrink: 0 }}>
                                            {entry.kind === 'reminder' ? '⏰' : '⏺'}
                                        </span>
                                        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 88 }}>
                                            {fmtTime(entry.startIso)}{entry.endIso ? `–${fmtTime(entry.endIso)}` : ''}
                                        </span>
                                        <span style={{ color: 'white', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {entry.title}
                                        </span>
                                        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                            {entry.channelName}
                                        </span>
                                        {inFlight && (
                                            <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                                                {t('agenda', 'recordingNow')}
                                            </span>
                                        )}
                                        <button
                                            onClick={() => cancel(entry)}
                                            title={entry.kind === 'reminder' ? t('agenda', 'cancelReminder') : t('agenda', 'cancelRecording')}
                                            style={{
                                                flexShrink: 0,
                                                padding: '5px 12px',
                                                borderRadius: 8,
                                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                                background: 'rgba(239, 68, 68, 0.1)',
                                                color: '#fca5a5',
                                                fontSize: 12,
                                                fontWeight: 600,
                                                cursor: 'pointer'
                                            }}
                                        >
                                            ✕ {t('agenda', 'cancel')}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
