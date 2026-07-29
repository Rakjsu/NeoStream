import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeListWindow, scrollTopForIndex, scrollTopToCenter } from '../../utils/listWindow';

export interface PlayerChannel {
    id: string | number;
    name: string;
    logo?: string;
    /** Provider channel number (digit-jump uses it). */
    num?: number;
    /** Starred channel (⭐ filter in the overlay). */
    favorite?: boolean;
    /** Direct play URL (M3U playlists) — used by the PiP zap. */
    directUrl?: string;
    /** ⏱️ Posição no histórico de zapping (0 = mais recente) — liga os chips
     *  "Recentes" do overlay sem precisar de prop nova no player. */
    recentRank?: number;
}

interface ChannelZapOverlayProps {
    channels: PlayerChannel[];
    currentId: string | number | undefined;
    visible: boolean;
    onSelect: (id: string | number) => void;
    onClose: () => void;
}

/** Altura fixa da linha (px) — é o que torna a janela exata sem medir o DOM. */
const ROW_HEIGHT = 54;
const ROW_GAP = 2;
/** Passo vertical de uma linha: altura + margem. */
const ROW_PITCH = ROW_HEIGHT + ROW_GAP;
/** Linhas extras montadas acima/abaixo da tela (rolagem rápida sem buraco). */
const ROW_OVERSCAN = 8;

/** O player manda o canal atual como string e a lista traz números. */
const isSameId = (a: string | number | undefined, b: string | number | undefined) =>
    a !== undefined && b !== undefined && String(a) === String(b);

const normalizeName = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** normalize('NFD') em milhares de nomes é caro: o resultado fica preso à
 *  IDENTIDADE da lista, então digitar a segunda letra não paga de novo (e uma
 *  lista nova só custa quando o usuário realmente busca). */
const normalizedNamesCache = new WeakMap<PlayerChannel[], string[]>();
const normalizedNamesOf = (list: PlayerChannel[]): string[] => {
    let names = normalizedNamesCache.get(list);
    if (!names) {
        names = list.map(ch => normalizeName(ch.name));
        normalizedNamesCache.set(list, names);
    }
    return names;
};

interface ZapRowProps {
    channel: PlayerChannel;
    isCurrent: boolean;
    isHighlighted: boolean;
    onSelect: (id: string | number) => void;
}

/** Linha memoizada: rolar a lista só reconcilia quem entra/sai da janela. */
const ZapRow = memo(function ZapRow({ channel, isCurrent, isHighlighted, onSelect }: ZapRowProps) {
    return (
        <div
            data-ch={String(channel.id)}
            className={isHighlighted ? 'zap-row kb-focus' : 'zap-row'}
            onClick={() => onSelect(channel.id)}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0 12px',
                height: ROW_HEIGHT,
                boxSizing: 'border-box',
                borderRadius: 10,
                cursor: 'pointer',
                marginBottom: ROW_GAP,
                background: isCurrent ? 'linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.3), rgba(var(--ns-accent-grad-to-rgb), 0.2))' : 'transparent',
                border: isCurrent ? '1px solid rgba(var(--ns-accent-rgb), 0.5)' : '1px solid transparent'
            }}
        >
            {channel.logo ? (
                <img
                    src={channel.logo}
                    alt=""
                    width={34}
                    height={34}
                    style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 6, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                />
            ) : (
                <span style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📺</span>
            )}
            <span style={{ color: 'white', fontSize: 13, fontWeight: isCurrent ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {channel.num !== undefined && <span style={{ color: 'rgba(255,255,255,0.45)', marginRight: 6 }}>{channel.num}</span>}
                {channel.name}
            </span>
            {isCurrent && <span style={{ marginLeft: 'auto', color: 'var(--ns-accent-light)', fontSize: 11, flexShrink: 0 }}>● AO VIVO</span>}
        </div>
    );
});

/**
 * In-player channel list ("zapping"): switch channels without leaving the
 * player. Keyboard (↑/↓/Enter/Esc) is handled with a CAPTURE listener so the
 * player's own shortcuts (volume on arrows) don't fire while the list is open.
 *
 * A lista é VIRTUALIZADA: com 12 mil canais o `filtered.map` montava ~60 mil
 * nós de DOM de uma vez e travava o app por mais de um segundo ao abrir. Como
 * a linha tem altura fixa, dois espaçadores mantêm a barra de rolagem correta
 * enquanto só a fatia visível fica montada.
 */
export function ChannelZapOverlay({ channels, currentId, visible, onSelect, onClose }: ChannelZapOverlayProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    // Highlight follows keyboard focus; starts at the playing channel.
    const highlightIdRef = useRef<string | number | undefined>(currentId);
    const [highlightId, setHighlightId] = useState<string | number | undefined>(undefined);
    const [query, setQuery] = useState('');
    const [onlyFavorites, setOnlyFavorites] = useState(false);
    const [scrollTop, setScrollTop] = useState(0);
    // Estimativa ANTES da primeira pintura: sem ela o primeiro render cairia no
    // modo seguro (lista inteira) e o congelamento de abrir a lista continuaria
    // — a medida real só chega no efeito, depois do commit. A lista nunca é
    // mais alta que a janela, então superestimar só monta linhas a mais.
    const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight));
    const hasFavorites = useMemo(() => channels.some(ch => ch.favorite), [channels]);

    // ⏱️ Últimos canais zapeados (sem o atual), mais recente primeiro.
    const recents = useMemo(() =>
        channels
            .filter(ch => ch.recentRank !== undefined && !isSameId(ch.id, currentId))
            .sort((a, b) => (a.recentRank ?? 0) - (b.recentRank ?? 0))
            .slice(0, 6),
    [channels, currentId]);

    const filtered = useMemo(() => {
        const q = normalizeName(query.trim());
        if (!q && !onlyFavorites) return channels;
        const names = q ? normalizedNamesOf(channels) : null;
        const out: PlayerChannel[] = [];
        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            if (onlyFavorites && !ch.favorite) continue;
            if (names && !(names[i].includes(q) || (ch.num !== undefined && String(ch.num).startsWith(q)))) continue;
            out.push(ch);
        }
        return out;
    }, [channels, query, onlyFavorites]);

    // Espelho pro efeito de abertura (que não pode depender de `filtered`, ou
    // rolaria a lista de volta pro canal atual a cada tecla digitada).
    const filteredRef = useRef(filtered);
    useEffect(() => { filteredRef.current = filtered; });

    // onSelect vem como arrow inline do player: o espelho mantém a prop das
    // linhas estável, senão o memo() delas nunca acerta.
    const onSelectRef = useRef(onSelect);
    useEffect(() => { onSelectRef.current = onSelect; });
    const selectChannel = useCallback((id: string | number) => onSelectRef.current(id), []);

    // Reset highlight + search every time the list opens; focus the input.
    // (A busca é limpa no FECHAMENTO para que a lista já abra completa — a
    // rolagem inicial depende disso.)
    useEffect(() => {
        if (!visible) {
            const reset = setTimeout(() => setQuery(''), 0);
            return () => clearTimeout(reset);
        }
        highlightIdRef.current = currentId;
        const t = setTimeout(() => {
            // O contorno do teclado só aparece depois da primeira seta.
            setHighlightId(undefined);
            searchRef.current?.focus();
        }, 60);
        return () => clearTimeout(t);
    }, [visible, currentId]);

    // Abrir a lista já no canal atual (com a janela, não dá pra confiar num
    // scrollIntoView: a linha alvo pode nem estar montada).
    useEffect(() => {
        if (!visible) return;
        const list = listRef.current;
        if (!list) return;
        const height = list.clientHeight;
        if (height > 0) setViewportHeight(height);
        const index = filteredRef.current.findIndex(ch => isSameId(ch.id, currentId));
        const top = scrollTopToCenter({ index, rowHeight: ROW_PITCH, viewportHeight: height });
        list.scrollTop = top;
        setScrollTop(top);
    }, [visible, currentId]);

    // Rolagem (throttled no rAF) + altura do container.
    useEffect(() => {
        if (!visible) return;
        const list = listRef.current;
        if (!list) return;
        let raf: number | null = null;
        const onScroll = () => {
            if (raf !== null) return;
            raf = requestAnimationFrame(() => {
                raf = null;
                setScrollTop(list.scrollTop);
            });
        };
        list.addEventListener('scroll', onScroll, { passive: true });
        const observer = new ResizeObserver(() => {
            if (list.clientHeight > 0) setViewportHeight(list.clientHeight);
        });
        observer.observe(list);
        return () => {
            list.removeEventListener('scroll', onScroll);
            observer.disconnect();
            if (raf !== null) cancelAnimationFrame(raf);
        };
    }, [visible]);

    // Capture-phase keyboard handling while open.
    useEffect(() => {
        if (!visible) return;
        const onKey = (e: KeyboardEvent) => {
            const list = filtered;
            const idx = list.findIndex(c => isSameId(c.id, highlightIdRef.current));
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                const next = e.key === 'ArrowDown'
                    ? Math.min(list.length - 1, idx + 1)
                    : Math.max(0, idx - 1);
                highlightIdRef.current = list[next]?.id;
                setHighlightId(list[next]?.id);
                const container = listRef.current;
                if (container) {
                    const top = scrollTopForIndex({
                        index: next,
                        rowHeight: ROW_PITCH,
                        scrollTop: container.scrollTop,
                        viewportHeight: container.clientHeight
                    });
                    if (top !== container.scrollTop) {
                        container.scrollTop = top;
                        setScrollTop(top);
                    }
                }
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

    const listSlice = computeListWindow({
        itemCount: filtered.length,
        rowHeight: ROW_PITCH,
        scrollTop,
        viewportHeight,
        overscan: ROW_OVERSCAN
    });

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
            {recents.length > 0 && !query.trim() && !onlyFavorites && (
                <div style={{ padding: '0 16px 10px' }}>
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                        ⏱️ Recentes
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {recents.map(ch => (
                            <button
                                key={`recent-${ch.id}`}
                                onClick={() => onSelect(ch.id)}
                                title={ch.name}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '5px 10px',
                                    borderRadius: 16,
                                    border: '1px solid rgba(var(--ns-accent-rgb), 0.35)',
                                    background: 'rgba(var(--ns-accent-rgb), 0.12)',
                                    color: 'white',
                                    fontSize: 12,
                                    cursor: 'pointer',
                                    maxWidth: 150
                                }}
                            >
                                {ch.logo && (
                                    <img
                                        src={ch.logo}
                                        alt=""
                                        width={16}
                                        height={16}
                                        style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }}
                                        loading="lazy"
                                        decoding="async"
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                )}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px' }}>
                {filtered.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                        Nenhum canal encontrado
                    </div>
                )}
                {listSlice.topSpacer > 0 && <div style={{ height: listSlice.topSpacer }} />}
                {filtered.slice(listSlice.start, listSlice.end).map(ch => (
                    <ZapRow
                        key={ch.id}
                        channel={ch}
                        isCurrent={isSameId(ch.id, currentId)}
                        isHighlighted={isSameId(ch.id, highlightId)}
                        onSelect={selectChannel}
                    />
                ))}
                {listSlice.bottomSpacer > 0 && <div style={{ height: listSlice.bottomSpacer }} />}
            </div>
        </div>
    );
}
