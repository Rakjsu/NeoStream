import { useEffect, useMemo, useRef, useState } from 'react';

export interface PlayerChannel {
    id: string | number;
    name: string;
    logo?: string;
    /** Provider channel number (digit-jump uses it). */
    num?: number;
    /** Starred channel (⭐ filter in the overlay). */
    favorite?: boolean;
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
    const searchRef = useRef<HTMLInputElement>(null);
    // Highlight follows keyboard focus; starts at the playing channel.
    const highlightIdRef = useRef<string | number | undefined>(currentId);
    const [query, setQuery] = useState('');
    const [onlyFavorites, setOnlyFavorites] = useState(false);
    const hasFavorites = useMemo(() => channels.some(ch => ch.favorite), [channels]);

    const normalized = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const filtered = useMemo(() => {
        const base = onlyFavorites ? channels.filter(ch => ch.favorite) : channels;
        const q = normalized(query.trim());
        if (!q) return base;
        return base.filter(ch =>
            normalized(ch.name).includes(q) || (ch.num !== undefined && String(ch.num).startsWith(q)));
    }, [channels, query, onlyFavorites]);

    // Reset highlight + search every time the list opens; focus the input.
    // (The query reset happens inside the timeout — async, not render-phase.)
    useEffect(() => {
        if (!visible) return;
        highlightIdRef.current = currentId;
        const t = setTimeout(() => {
            setQuery('');
            searchRef.current?.focus();
        }, 60);
        return () => clearTimeout(t);
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
            const list = filtered;
            const idx = list.findIndex(c => c.id === highlightIdRef.current);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                const next = e.key === 'ArrowDown'
                    ? Math.min(list.length - 1, idx + 1)
                    : Math.max(0, idx - 1);
                highlightIdRef.current = list[next]?.id;
                const el = listRef.current?.querySelector(`[data-ch="${String(list[next]?.id)}"]`) as HTMLElement | null;
                el?.scrollIntoView({ block: 'nearest' });
                // Visual highlight via class toggling (no re-render needed).
                listRef.current?.querySelectorAll('.zap-row.kb-focus').forEach(n => n.classList.remove('kb-focus'));
                el?.classList.add('kb-focus');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                // With a search active and no keyboard highlight in the filtered
                // list, Enter picks the first result.
                const target = idx >= 0 ? highlightIdRef.current : list[0]?.id;
                if (target !== undefined) onSelect(target);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [visible, filtered, onSelect, onClose]);

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
            <div style={{ padding: '18px 20px 10px', color: 'white', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>📺 Canais</span>
                {hasFavorites && (
                    <button
                        onClick={() => setOnlyFavorites(v => !v)}
                        title="Só favoritos"
                        style={{
                            padding: '4px 12px',
                            borderRadius: 8,
                            border: onlyFavorites ? '1px solid rgba(251, 191, 36, 0.6)' : '1px solid rgba(255,255,255,0.2)',
                            background: onlyFavorites ? 'rgba(251, 191, 36, 0.2)' : 'transparent',
                            color: onlyFavorites ? '#fbbf24' : 'rgba(255,255,255,0.7)',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer'
                        }}
                    >
                        ⭐
                    </button>
                )}
            </div>
            <div style={{ padding: '0 16px 10px' }}>
                <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar canal ou número..."
                    style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        background: 'rgba(255, 255, 255, 0.08)',
                        color: 'white',
                        fontSize: 13,
                        outline: 'none'
                    }}
                />
            </div>
            <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px' }}>
                {filtered.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                        Nenhum canal encontrado
                    </div>
                )}
                {filtered.map(ch => {
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
                                {ch.num !== undefined && <span style={{ color: 'rgba(255,255,255,0.45)', marginRight: 6 }}>{ch.num}</span>}
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
