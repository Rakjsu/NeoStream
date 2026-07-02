import { useEffect, useRef } from 'react';

export interface PlayerChannel {
    id: string | number;
    name: string;
    logo?: string;
}

interface ChannelZapOverlayProps {
    channels: PlayerChannel[];
    currentId: string | number | undefined;
    visible: boolean;
    onSelect: (id: string | number) => void;
    onClose: () => void;
}

/**
 * In-player channel list ("zapping"): switch channels without leaving the
 * player. Keyboard (↑/↓/Enter/Esc) is handled with a CAPTURE listener so the
 * player's own shortcuts (volume on arrows) don't fire while the list is open.
 */
export function ChannelZapOverlay({ channels, currentId, visible, onSelect, onClose }: ChannelZapOverlayProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const highlightRef = useRef<HTMLDivElement>(null);
    // Highlight follows keyboard focus; starts at the playing channel.
    const highlightIdRef = useRef<string | number | undefined>(currentId);

    // Reset highlight to the playing channel every time the list opens.
    useEffect(() => {
        if (visible) highlightIdRef.current = currentId;
    }, [visible, currentId]);

    // Scroll the highlighted row into view when opening.
    useEffect(() => {
        if (!visible) return;
        const t = setTimeout(() => highlightRef.current?.scrollIntoView({ block: 'center' }), 30);
        return () => clearTimeout(t);
    }, [visible]);

    // Capture-phase keyboard handling while open.
    useEffect(() => {
        if (!visible) return;
        const onKey = (e: KeyboardEvent) => {
            const idx = channels.findIndex(c => c.id === highlightIdRef.current);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                const next = e.key === 'ArrowDown'
                    ? Math.min(channels.length - 1, idx + 1)
                    : Math.max(0, idx - 1);
                highlightIdRef.current = channels[next]?.id;
                // Re-render via scroll: simplest is to force through DOM — the
                // highlight is read during render, so poke React with a state
                // in the parent? Keep it simple: use scrollIntoView on next tick.
                const el = listRef.current?.querySelector(`[data-ch="${String(channels[next]?.id)}"]`) as HTMLElement | null;
                el?.scrollIntoView({ block: 'nearest' });
                // Visual highlight via class toggling (no re-render needed).
                listRef.current?.querySelectorAll('.zap-row.kb-focus').forEach(n => n.classList.remove('kb-focus'));
                el?.classList.add('kb-focus');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (highlightIdRef.current !== undefined) onSelect(highlightIdRef.current);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [visible, channels, onSelect, onClose]);

    if (!visible) return null;

    return (
        <div
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                width: 340,
                zIndex: 1002,
                background: 'linear-gradient(90deg, rgba(8, 8, 20, 0.95) 0%, rgba(8, 8, 20, 0.88) 85%, transparent 100%)',
                display: 'flex',
                flexDirection: 'column',
                animation: 'fadeIn 0.2s ease'
            }}
        >
            <style>{`
                .zap-row.kb-focus { outline: 2px solid var(--ns-accent); outline-offset: -2px; }
            `}</style>
            <div style={{ padding: '18px 20px 10px', color: 'white', fontSize: 16, fontWeight: 700 }}>
                📺 Canais
            </div>
            <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px' }}>
                {channels.map(ch => {
                    const isCurrent = ch.id === currentId;
                    return (
                        <div
                            key={ch.id}
                            data-ch={String(ch.id)}
                            ref={isCurrent ? highlightRef : undefined}
                            className="zap-row"
                            onClick={() => onSelect(ch.id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '10px 12px',
                                borderRadius: 10,
                                cursor: 'pointer',
                                marginBottom: 2,
                                background: isCurrent ? 'linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.3), rgba(var(--ns-accent-grad-to-rgb), 0.2))' : 'transparent',
                                border: isCurrent ? '1px solid rgba(var(--ns-accent-rgb), 0.5)' : '1px solid transparent'
                            }}
                        >
                            {ch.logo ? (
                                <img
                                    src={ch.logo}
                                    alt=""
                                    style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 6, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }}
                                    loading="lazy"
                                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                                />
                            ) : (
                                <span style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📺</span>
                            )}
                            <span style={{ color: 'white', fontSize: 13, fontWeight: isCurrent ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {ch.name}
                            </span>
                            {isCurrent && <span style={{ marginLeft: 'auto', color: 'var(--ns-accent-light)', fontSize: 11, flexShrink: 0 }}>● AO VIVO</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
