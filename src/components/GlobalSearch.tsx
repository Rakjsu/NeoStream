import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LazyImage } from './LazyImage';
import { debounce } from '../utils/debounce';
import { useLanguage } from '../services/languageService';
import { profileService } from '../services/profileService';
import { parentalService } from '../services/parentalService';
import { isCategoryNameBlocked } from '../hooks/useContentFiltering';

/**
 * sessionStorage bridge: the section pages (LiveTV/VOD/Series) don't support
 * deep-linking, so on activation we store the typed term under this key,
 * navigate to the section route and fire GLOBAL_SEARCH_EVENT. Each section
 * page consumes (read + remove) the key on mount and on that event, feeding
 * it into its own setSearchQuery — the user lands on the page already
 * filtered to the term.
 */
export const GLOBAL_SEARCH_TERM_KEY = 'neostream_global_search_term';
export const GLOBAL_SEARCH_EVENT = 'neostream-global-search';
/** Dispatched (e.g. by the Sidebar search button) to open the overlay. */
export const GLOBAL_SEARCH_OPEN_EVENT = 'neostream-open-global-search';

type SectionKind = 'live' | 'vod' | 'series';

interface SearchItem {
    id: number;
    name: string;
    icon: string;
    kind: SectionKind;
    categoryIds: string[];
}

interface SearchCategory {
    category_id: string;
    category_name: string;
}

interface SearchData {
    live: SearchItem[];
    vod: SearchItem[];
    series: SearchItem[];
    categories: Record<SectionKind, SearchCategory[]>;
}

interface RawStream {
    stream_id?: number;
    series_id?: number;
    name?: string;
    stream_icon?: string;
    cover?: string;
    category_id?: string | string[];
}

const SECTION_ROUTES: Record<SectionKind, string> = {
    live: '/dashboard/live',
    vod: '/dashboard/vod',
    series: '/dashboard/series'
};

const MAX_PER_CATEGORY = 8;

// Module-level session cache: the three lists are fetched once on first open
// and reused for the rest of the session (same IPC channels Home uses; the
// main process serves them quickly from its own cache).
let sessionCache: SearchData | null = null;
let sessionCachePromise: Promise<SearchData> | null = null;

function mapItems(data: unknown, kind: SectionKind): SearchItem[] {
    if (!Array.isArray(data)) return [];
    const items: SearchItem[] = [];
    for (const raw of data as RawStream[]) {
        const id = kind === 'series' ? raw.series_id : raw.stream_id;
        if (typeof id !== 'number' || !raw.name) continue;
        items.push({
            id,
            name: raw.name,
            icon: raw.stream_icon || raw.cover || '',
            kind,
            categoryIds: Array.isArray(raw.category_id)
                ? raw.category_id
                : raw.category_id ? [raw.category_id] : []
        });
    }
    return items;
}

function mapCategories(result: { success?: boolean; data?: unknown } | undefined): SearchCategory[] {
    if (!result?.success || !Array.isArray(result.data)) return [];
    return result.data as SearchCategory[];
}

async function fetchSearchData(): Promise<SearchData> {
    if (sessionCache) return sessionCache;
    if (!sessionCachePromise) {
        sessionCachePromise = (async () => {
            const [live, vod, series, liveCats, vodCats, seriesCats] = await Promise.all([
                window.ipcRenderer.invoke('streams:get-live'),
                window.ipcRenderer.invoke('streams:get-vod'),
                window.ipcRenderer.invoke('streams:get-series'),
                window.ipcRenderer.invoke('categories:get-live'),
                window.ipcRenderer.invoke('categories:get-vod'),
                window.ipcRenderer.invoke('categories:get-series')
            ]);
            const data: SearchData = {
                live: mapItems(live?.success ? live.data : [], 'live'),
                vod: mapItems(vod?.success ? vod.data : [], 'vod'),
                series: mapItems(series?.success ? series.data : [], 'series'),
                categories: {
                    live: mapCategories(liveCats),
                    vod: mapCategories(vodCats),
                    series: mapCategories(seriesCats)
                }
            };
            sessionCache = data;
            return data;
        })().catch(err => {
            // Allow a retry on the next open instead of caching the failure
            sessionCachePromise = null;
            throw err;
        });
    }
    return sessionCachePromise;
}

// Same patterns LiveTV whitelists for Kids profiles
const KIDS_ALLOWED_PATTERNS = ['infantil', 'infantis', 'kids', 'criança', '24 horas infantis'];
// Name backstop: adult markers providers commonly embed in titles. Kept to
// explicit adult terms (unlike category blocking, which also covers horror)
// so regular titles aren't over-filtered by name.
const ADULT_NAME_PATTERNS = ['xxx', '+18', '18+', 'adult', 'adulto', 'erotic', 'erótico', 'porn'];

interface GateConfig {
    isKids: boolean;
    /** Hide items in adult-flagged categories (kids profile OR parental lock) */
    blockAdult: boolean;
    blockedIds: Record<SectionKind, Set<string>>;
    /** Kids: live channels are whitelisted to kid categories (mirrors LiveTV) */
    liveAllowedIds: Set<string>;
}

function computeGate(data: SearchData | null): GateConfig {
    const isKids = profileService.getActiveProfile()?.isKids || false;
    const parental = parentalService.getConfig();
    const parentalActive = parental.enabled && parental.blockAdultCategories && !parentalService.isSessionUnlocked();
    const blockAdult = isKids || parentalActive;

    const blockedIds: Record<SectionKind, Set<string>> = {
        live: new Set(), vod: new Set(), series: new Set()
    };
    const liveAllowedIds = new Set<string>();

    if (data && blockAdult) {
        for (const kind of ['live', 'vod', 'series'] as SectionKind[]) {
            for (const cat of data.categories[kind]) {
                if (isCategoryNameBlocked(cat.category_name)) {
                    blockedIds[kind].add(cat.category_id);
                }
                if (kind === 'live' && isKids) {
                    const lower = cat.category_name.toLowerCase();
                    if (KIDS_ALLOWED_PATTERNS.some(p => lower.includes(p))) {
                        liveAllowedIds.add(cat.category_id);
                    }
                }
            }
        }
    }

    return { isKids, blockAdult, blockedIds, liveAllowedIds };
}

function isItemAllowed(item: SearchItem, gate: GateConfig): boolean {
    if (!gate.blockAdult) return true;
    if (item.categoryIds.some(id => gate.blockedIds[item.kind].has(id))) return false;
    // Kids: live channels are whitelist-only, like the LiveTV page
    if (gate.isKids && item.kind === 'live' && !item.categoryIds.some(id => gate.liveAllowedIds.has(id))) {
        return false;
    }
    const lowerName = item.name.toLowerCase();
    if (ADULT_NAME_PATTERNS.some(p => lowerName.includes(p))) return false;
    return true;
}

/**
 * Case-insensitive substring match, ranked startsWith > includes,
 * capped at MAX_PER_CATEGORY results.
 */
function matchItems(items: SearchItem[], query: string): SearchItem[] {
    const q = query.toLowerCase();
    const startsWith: SearchItem[] = [];
    const includes: SearchItem[] = [];
    for (const item of items) {
        const name = item.name.toLowerCase();
        const index = name.indexOf(q);
        if (index === -1) continue;
        if (index === 0) {
            startsWith.push(item);
            if (startsWith.length >= MAX_PER_CATEGORY) break;
        } else if (includes.length < MAX_PER_CATEGORY) {
            includes.push(item);
        }
    }
    return startsWith.concat(includes).slice(0, MAX_PER_CATEGORY);
}

interface ResultGroup {
    kind: SectionKind;
    emoji: string;
    label: string;
    items: SearchItem[];
    /** Flat index of the first item in this group (for keyboard navigation) */
    offset: number;
}

/**
 * Global search overlay (Ctrl+K / Cmd+K), Spotlight style, searching live
 * channels + movies + series at once.
 *
 * Kids/parental gating: results are pre-filtered with the same category
 * rules the section pages use (blocked adult categories, kids live-channel
 * whitelist) plus an adult-term name backstop. The destination pages still
 * apply their own TMDB-rating click-gating on top.
 */
export function GlobalSearch() {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [query, setQuery] = useState('');
    const [data, setData] = useState<SearchData | null>(sessionCache);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const openRef = useRef(open);
    useEffect(() => {
        openRef.current = open;
    }, [open]);

    // Debounced input -> query (250ms); selection resets with each new query
    const setQueryDebounced = useMemo(() => debounce((value: string) => {
        setQuery(value);
        setSelectedIndex(0);
    }, 250), []);
    useEffect(() => () => setQueryDebounced.cancel(), [setQueryDebounced]);

    // First open: fetch + cache the three lists for the session
    // (called from the open handlers, deduped by the module-level promise)
    const ensureDataLoaded = useCallback(() => {
        if (sessionCache) {
            setData(sessionCache);
            return;
        }
        setLoading(true);
        setLoadError(false);
        fetchSearchData()
            .then(result => setData(result))
            .catch(() => setLoadError(true))
            .finally(() => setLoading(false));
    }, []);

    // Global shortcut: Ctrl+K / Cmd+K toggles, Escape closes.
    // Registered once at app (Dashboard) level.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                const target = e.target as HTMLElement | null;
                const isTyping = !!target && (
                    target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable
                );
                // Ignore while typing in some other input; our own search
                // input may still toggle the overlay closed.
                if (isTyping && target !== inputRef.current) return;
                e.preventDefault();
                const willOpen = !openRef.current;
                setOpen(willOpen);
                if (willOpen) ensureDataLoaded();
            } else if (e.key === 'Escape' && openRef.current) {
                e.preventDefault();
                setOpen(false);
            }
        };
        const onOpenRequest = () => {
            setOpen(true);
            ensureDataLoaded();
        };

        document.addEventListener('keydown', onKeyDown);
        window.addEventListener(GLOBAL_SEARCH_OPEN_EVENT, onOpenRequest);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener(GLOBAL_SEARCH_OPEN_EVENT, onOpenRequest);
        };
    }, [ensureDataLoaded]);

    // Autofocus on open
    useEffect(() => {
        if (open) {
            // After the overlay paints
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    // Kids/parental gate, recomputed on each open so a parental unlock made
    // during the session is respected. The destination pages still apply
    // their own click-gating (TMDB rating checks) on top of this.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` forces recompute per open; parental unlock state lives outside React
    const gate = useMemo<GateConfig>(() => computeGate(data), [data, open]);

    const groups = useMemo<ResultGroup[]>(() => {
        const trimmed = query.trim();
        if (!data || !trimmed) return [];
        const result: ResultGroup[] = [];
        let offset = 0;
        const sections: Array<{ kind: SectionKind; emoji: string; label: string; items: SearchItem[] }> = [
            { kind: 'live', emoji: '📺', label: t('nav', 'liveTV'), items: data.live },
            { kind: 'vod', emoji: '🎬', label: t('nav', 'movies'), items: data.vod },
            { kind: 'series', emoji: '📺', label: t('nav', 'series'), items: data.series }
        ];
        for (const section of sections) {
            const visible = gate.blockAdult
                ? section.items.filter(item => isItemAllowed(item, gate))
                : section.items;
            const matched = matchItems(visible, trimmed);
            if (matched.length === 0) continue;
            result.push({ ...section, items: matched, offset });
            offset += matched.length;
        }
        return result;
    }, [data, query, t, gate]);

    const flatResults = useMemo(() => groups.flatMap(g => g.items), [groups]);

    // Keep the selected row in view while navigating with the keyboard
    useEffect(() => {
        const el = listRef.current?.querySelector('[data-selected="true"]');
        el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    const close = useCallback(() => {
        setOpen(false);
    }, []);

    const activate = useCallback((item: SearchItem) => {
        const term = query.trim() || item.name;
        try {
            sessionStorage.setItem(GLOBAL_SEARCH_TERM_KEY, term);
        } catch {
            // sessionStorage unavailable: navigation still works, just unfiltered
        }
        navigate(SECTION_ROUTES[item.kind]);
        // Covers the "already on that page" case (no remount on same-route navigate)
        window.dispatchEvent(new Event(GLOBAL_SEARCH_EVENT));
        setOpen(false);
        setInputValue('');
        setQuery('');
    }, [navigate, query]);

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (flatResults.length > 0) {
                setSelectedIndex(prev => (prev + 1) % flatResults.length);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (flatResults.length > 0) {
                setSelectedIndex(prev => (prev - 1 + flatResults.length) % flatResults.length);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const item = flatResults[selectedIndex];
            if (item) activate(item);
        }
    };

    if (!open) return null;

    const trimmedQuery = query.trim();
    const showNoResults = !!data && !!trimmedQuery && flatResults.length === 0;

    return (
        <>
            <style>{globalSearchStyles}</style>
            <div className="gsearch-overlay" onClick={close}>
                <div
                    className="gsearch-panel"
                    role="dialog"
                    aria-modal="true"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="gsearch-input-row">
                        <span className="gsearch-input-icon">🔍</span>
                        <input
                            ref={inputRef}
                            type="text"
                            className="gsearch-input"
                            placeholder={t('search', 'placeholder')}
                            value={inputValue}
                            onChange={e => {
                                setInputValue(e.target.value);
                                setQueryDebounced(e.target.value);
                            }}
                            onKeyDown={handleInputKeyDown}
                            autoFocus
                            spellCheck={false}
                        />
                        <span className="gsearch-kbd">Esc</span>
                    </div>

                    <div className="gsearch-results" ref={listRef}>
                        {loading && (
                            <div className="gsearch-status">
                                <div className="gsearch-spinner" />
                                <span>{t('search', 'loading')}</span>
                            </div>
                        )}

                        {loadError && !loading && (
                            <div className="gsearch-status">
                                <span>⚠️ {t('search', 'loadError')}</span>
                            </div>
                        )}

                        {showNoResults && !loading && (
                            <div className="gsearch-status">
                                <span>{t('search', 'noResults')}</span>
                            </div>
                        )}

                        {groups.map(group => (
                            <div key={group.kind} className="gsearch-group">
                                <div className="gsearch-group-header">
                                    <span>{group.emoji}</span>
                                    <span>{group.label}</span>
                                </div>
                                {group.items.map((item, i) => {
                                    const flatIndex = group.offset + i;
                                    const isSelected = flatIndex === selectedIndex;
                                    return (
                                        <button
                                            key={`${item.kind}-${item.id}`}
                                            type="button"
                                            className={`gsearch-item ${isSelected ? 'selected' : ''}`}
                                            data-selected={isSelected || undefined}
                                            onClick={() => activate(item)}
                                            onMouseEnter={() => setSelectedIndex(flatIndex)}
                                        >
                                            <div className="gsearch-thumb">
                                                {item.icon ? (
                                                    <LazyImage
                                                        src={item.icon}
                                                        alt={item.name}
                                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                        fallback={
                                                            <div className="gsearch-thumb-fallback">
                                                                {item.name.charAt(0).toUpperCase()}
                                                            </div>
                                                        }
                                                    />
                                                ) : (
                                                    <div className="gsearch-thumb-fallback">
                                                        {item.name.charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <span className="gsearch-item-name">{item.name}</span>
                                            <span className={`gsearch-badge badge-${item.kind}`}>
                                                {group.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                    <div className="gsearch-footer">
                        <span>{t('search', 'hint')}</span>
                    </div>
                </div>
            </div>
        </>
    );
}

const globalSearchStyles = `
.gsearch-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(8px);
    z-index: 10000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    animation: gsearchFadeIn 0.2s ease;
}

@keyframes gsearchFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.gsearch-panel {
    width: 90%;
    max-width: 640px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6), 0 0 40px rgba(168, 85, 247, 0.1);
    animation: gsearchSlide 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes gsearchSlide {
    from { opacity: 0; transform: scale(0.97) translateY(-12px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}

/* Input */
.gsearch-input-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.gsearch-input-icon {
    font-size: 18px;
    opacity: 0.7;
}

.gsearch-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: white;
    font-size: 17px;
}

.gsearch-input::placeholder {
    color: rgba(255, 255, 255, 0.35);
}

.gsearch-kbd {
    padding: 3px 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 11px;
    font-weight: 600;
}

/* Results */
.gsearch-results {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(168, 85, 247, 0.4) transparent;
}

.gsearch-results::-webkit-scrollbar {
    width: 6px;
}

.gsearch-results::-webkit-scrollbar-thumb {
    background: rgba(168, 85, 247, 0.4);
    border-radius: 3px;
}

.gsearch-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 32px 16px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
}

.gsearch-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(168, 85, 247, 0.2);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: gsearchSpin 0.8s linear infinite;
}

@keyframes gsearchSpin {
    to { transform: rotate(360deg); }
}

/* Group */
.gsearch-group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px 6px;
    color: rgba(196, 181, 253, 0.8);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* Item */
.gsearch-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
}

.gsearch-item.selected {
    background: rgba(168, 85, 247, 0.18);
}

.gsearch-thumb {
    width: 40px;
    height: 40px;
    min-width: 40px;
    border-radius: 8px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.05);
}

.gsearch-thumb-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(236, 72, 153, 0.35));
    color: white;
    font-size: 18px;
    font-weight: 700;
}

.gsearch-item-name {
    flex: 1;
    color: white;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.gsearch-badge {
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
}

.badge-live {
    background: rgba(168, 85, 247, 0.15);
    color: #c4b5fd;
    border: 1px solid rgba(168, 85, 247, 0.3);
}

.badge-vod {
    background: rgba(59, 130, 246, 0.15);
    color: #93c5fd;
    border: 1px solid rgba(59, 130, 246, 0.3);
}

.badge-series {
    background: rgba(236, 72, 153, 0.15);
    color: #f9a8d4;
    border: 1px solid rgba(236, 72, 153, 0.3);
}

/* Footer */
.gsearch-footer {
    padding: 10px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
    text-align: center;
}
`;
