import { useEffect, useState } from 'react';
import { epgService } from '../services/epgService';

interface GuideEntry {
    title: string;
    start: string;
    isNow: boolean;
}

interface ChannelHoverMiniGuideProps {
    streamId: string | number;
    epgChannelId: string;
    channelName: string;
    x: number;
    y: number;
}

// TTL cache so re-hovering the same channel doesn't refetch its guide.
const guideCache = new Map<string, { ts: number; entries: GuideEntry[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 📋 Mini-guia flutuante do hover: programa atual + 2 próximos do canal. */
export function ChannelHoverMiniGuide({ streamId, epgChannelId, channelName, x, y }: ChannelHoverMiniGuideProps) {
    const [entries, setEntries] = useState<GuideEntry[] | null>(() => {
        const hit = guideCache.get(String(streamId));
        return hit && Date.now() - hit.ts < CACHE_TTL_MS ? hit.entries : null;
    });

    // O componente é montado com key por canal (LiveTV), então o cache já
    // chega pelo estado inicial — o effect só busca quando não há hit fresco.
    useEffect(() => {
        const key = String(streamId);
        const hit = guideCache.get(key);
        if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return;
        let cancelled = false;
        const numericId = typeof streamId === 'number' ? streamId : Number(streamId) || undefined;
        epgService.fetchChannelEPG(epgChannelId || '', channelName, numericId)
            .then((programs) => {
                if (cancelled) return;
                const current = epgService.getCurrentProgram(programs);
                const upcoming = epgService.getUpcomingPrograms(programs, current, 2);
                const shown: GuideEntry[] = [
                    ...(current ? [{ title: current.title, start: current.start, isNow: true }] : []),
                    ...upcoming.map(p => ({ title: p.title, start: p.start, isNow: false })),
                ].slice(0, 3);
                guideCache.set(key, { ts: Date.now(), entries: shown });
                setEntries(shown);
            })
            .catch(() => { if (!cancelled) setEntries([]); });
        return () => { cancelled = true; };
    }, [streamId, epgChannelId, channelName]);

    const left = Math.min(x, window.innerWidth - 300);
    const top = Math.min(y, window.innerHeight - 140);

    return (
        <div style={{
            position: 'fixed',
            left,
            top,
            zIndex: 9500,
            width: 280,
            pointerEvents: 'none',
            background: 'rgba(15, 15, 35, 0.96)',
            border: '1px solid rgba(var(--ns-accent-rgb), 0.35)',
            borderRadius: 10,
            padding: '10px 12px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)'
        }}>
            {entries === null && (
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Carregando guia…</div>
            )}
            {entries?.length === 0 && (
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Sem programação disponível</div>
            )}
            {(entries ?? []).map((entry, index) => (
                <div
                    key={`${entry.start}-${index}`}
                    style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: index < (entries?.length ?? 0) - 1 ? 6 : 0 }}
                >
                    <span style={{
                        flexShrink: 0,
                        fontSize: 11,
                        fontWeight: entry.isNow ? 700 : 500,
                        color: entry.isNow ? 'var(--ns-accent-light)' : 'rgba(148, 163, 184, 0.9)'
                    }}>
                        {entry.isNow ? '▶ Agora' : epgService.formatTime(entry.start)}
                    </span>
                    <span style={{
                        fontSize: 12,
                        color: entry.isNow ? 'white' : 'rgba(255, 255, 255, 0.75)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}>
                        {entry.title}
                    </span>
                </div>
            ))}
        </div>
    );
}
