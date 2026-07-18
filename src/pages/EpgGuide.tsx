import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { LazyImage } from '../components/LazyImage';
import { epgService } from '../services/epgService';
import { profileService } from '../services/profileService';
import { parentalService } from '../services/parentalService';
import { useLanguage } from '../services/languageService';
import {
    getGuideWindow,
    buildTimeTicks,
    programToBlock,
    nowOffsetPx,
    isAiringNow,
    formatGuideTime,
    shiftWindow,
    clampWindow,
    searchPrograms,
    isReplayable,
    replayDurationMinutes,
    HALF_HOUR_MS,
    PX_PER_HALF_HOUR,
    WINDOW_HALF_HOURS,
    WINDOW_SHIFT_MS
} from '../utils/epgGuide';
import type { ProgramSearchResult } from '../utils/epgGuide';
import { getTimeshiftUrl } from '../services/timeshiftService';
import { reminderService, reminderId } from '../services/reminderService';
import { scheduledRecordingService, scheduleId } from '../services/scheduledRecordingService';

interface LiveStream {
    num: number;
    name: string;
    stream_type: string;
    stream_id: number;
    stream_icon: string;
    epg_channel_id: string;
    added: string;
    category_id: string;
    custom_sid: string;
    tv_archive: number;
    direct_source: string;
    tv_archive_duration: number;
}

interface LiveCategory {
    category_id: string;
    category_name: string;
    parent_id: number;
}

interface EPGProgram {
    id: string;
    start: string;
    end: string;
    title: string;
    description?: string;
    channel_id: string;
}

// Same gating patterns LiveTV uses (kids whitelist / parental blocklist)
const KIDS_ALLOWED_PATTERNS = ['infantil', 'infantis', 'kids', 'criança', '24 horas infantis'];
const BLOCKED_CATEGORY_PATTERNS = ['adult', 'adulto', '+18', '18+', 'xxx', 'erotic', 'erótico'];

const CHANNEL_COL_WIDTH = 220;
const ROW_HEIGHT = 64;
const HEADER_HEIGHT = 40;
const TIMELINE_WIDTH = WINDOW_HALF_HOURS * PX_PER_HALF_HOUR;
const INITIAL_ROWS = 25;
const ROWS_INCREMENT = 25;
const MAX_CONCURRENT_EPG = 4;

// ---------------------------------------------------------------------------
// Module-level EPG cache + concurrency limiter (persists across page visits)
// ---------------------------------------------------------------------------
const epgCache = new Map<string, EPGProgram[]>();
const epgPending = new Map<string, Promise<EPGProgram[]>>();
let epgInFlight = 0;
const epgWaiters: Array<() => void> = [];

async function acquireEpgSlot(): Promise<void> {
    if (epgInFlight >= MAX_CONCURRENT_EPG) {
        await new Promise<void>(resolve => epgWaiters.push(resolve));
    }
    epgInFlight++;
}

function releaseEpgSlot(): void {
    epgInFlight--;
    const next = epgWaiters.shift();
    if (next) next();
}

function loadChannelEpg(channel: LiveStream): Promise<EPGProgram[]> {
    const key = channel.name;
    const cached = epgCache.get(key);
    if (cached) return Promise.resolve(cached);

    let pending = epgPending.get(key);
    if (!pending) {
        pending = (async () => {
            await acquireEpgSlot();
            try {
                const programs = await epgService.fetchChannelEPG(channel.epg_channel_id || '', channel.name, channel.stream_id);
                epgCache.set(key, programs);
                return programs;
            } catch {
                epgCache.set(key, []);
                return [];
            } finally {
                releaseEpgSlot();
                epgPending.delete(key);
            }
        })();
        epgPending.set(key, pending);
    }
    return pending;
}

export function EpgGuide() {
    const [streams, setStreams] = useState<LiveStream[]>([]);
    const [categories, setCategories] = useState<LiveCategory[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [visibleRows, setVisibleRows] = useState(INITIAL_ROWS);
    const [epgByChannel, setEpgByChannel] = useState<Record<string, EPGProgram[] | undefined>>({});
    const [now, setNow] = useState(() => Date.now());
    const [playingChannel, setPlayingChannel] = useState<LiveStream | null>(null);
    // Catch-up/replay playback (timeshift) of an already-aired program
    const [timeshiftPlayback, setTimeshiftPlayback] = useState<{ channel: LiveStream; program: EPGProgram } | null>(null);
    // Small action popover for program blocks: CURRENT program on archive
    // channels ("watch live" / "watch from start") and FUTURE programs
    // ("remind me" / "remove reminder").
    const [programPopover, setProgramPopover] = useState<{
        channel: LiveStream;
        program: EPGProgram;
        anchor: { x: number; y: number };
    } | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const isKidsProfile = profileService.getActiveProfile()?.isKids || false;
    const { t } = useLanguage();

    // Pageable window (◀/▶ shift it by 2h; "Hoje/Agora" resets to default).
    const [guideWindow, setGuideWindow] = useState(() => getGuideWindow());
    const ticks = useMemo(() => buildTimeTicks(guideWindow), [guideWindow]);

    // Program search over the already-loaded EPG data
    const [searchQuery, setSearchQuery] = useState('');
    const [pendingScrollChannel, setPendingScrollChannel] = useState<string | null>(null);
    const [highlightedChannel, setHighlightedChannel] = useState<string | null>(null);
    const rowRefs = useRef(new Map<string, HTMLDivElement>());

    // "Now" line updates every minute
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(id);
    }, []);

    // Program reminders: re-render on changes (🔔 indicators + popover label)
    const [reminderVersion, setReminderVersion] = useState(0);
    useEffect(() => reminderService.subscribe(() => setReminderVersion(v => v + 1)), []);
    const reminderIds = useMemo(() => {
        void reminderVersion; // dependency: re-read the list on every change
        return new Set(reminderService.list().map(r => r.id));
    }, [reminderVersion]);

    // Scheduled recordings: same pattern (⏺ indicator + popover label)
    const [scheduleVersion, setScheduleVersion] = useState(0);
    useEffect(() => scheduledRecordingService.subscribe(() => setScheduleVersion(v => v + 1)), []);
    const scheduleIds = useMemo(() => {
        void scheduleVersion;
        return new Set(scheduledRecordingService.list().map(s => s.id));
    }, [scheduleVersion]);

    // Load channels + categories, applying the same gating as LiveTV
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError('');
            try {
                const [streamsResult, categoriesResult] = await Promise.all([
                    window.ipcRenderer.invoke('streams:get-live'),
                    window.ipcRenderer.invoke('categories:get-live')
                ]);
                if (cancelled) return;

                if (!streamsResult.success) {
                    setError(streamsResult.error || 'Failed to load channels');
                    return;
                }

                const allCategories: LiveCategory[] = categoriesResult?.success ? (categoriesResult.data || []) : [];
                const parentalConfig = parentalService.getConfig();
                const blockParental = parentalConfig.enabled && parentalConfig.blockAdultCategories && !parentalService.isSessionUnlocked();

                const allowedCategories = allCategories.filter(cat => {
                    const lowerName = cat.category_name.toLowerCase();
                    if (blockParental && BLOCKED_CATEGORY_PATTERNS.some(p => lowerName.includes(p))) return false;
                    if (isKidsProfile && !KIDS_ALLOWED_PATTERNS.some(p => lowerName.includes(p))) return false;
                    return true;
                });
                const allowedIds = new Set(allowedCategories.map(c => c.category_id));

                const allowedStreams = (streamsResult.data || []).filter(
                    (s: LiveStream) => allowedIds.has(s.category_id)
                );

                setCategories(allowedCategories);
                setStreams(allowedStreams);
                setSelectedCategory(prev =>
                    prev && allowedIds.has(prev) ? prev : (allowedCategories[0]?.category_id || '')
                );
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to connect to server');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [isKidsProfile]);

    // Channels of the selected category (only these render rows)
    const categoryStreams = useMemo(
        () => streams.filter(s => s.category_id === selectedCategory),
        [streams, selectedCategory]
    );
    const renderedStreams = useMemo(
        () => categoryStreams.slice(0, visibleRows),
        [categoryStreams, visibleRows]
    );

    // Reset windowed rows when category changes (deferred setState)
    useEffect(() => {
        queueMicrotask(() => setVisibleRows(INITIAL_ROWS));
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [selectedCategory]);

    // Lazy EPG fetch for the rendered rows (concurrency-limited, module-cached)
    useEffect(() => {
        let cancelled = false;
        for (const channel of renderedStreams) {
            const cached = epgCache.get(channel.name);
            if (cached) {
                if (epgByChannel[channel.name] === undefined) {
                    queueMicrotask(() => setEpgByChannel(prev =>
                        prev[channel.name] === undefined ? { ...prev, [channel.name]: cached } : prev
                    ));
                }
                continue;
            }
            void loadChannelEpg(channel).then(programs => {
                if (!cancelled) {
                    setEpgByChannel(prev => ({ ...prev, [channel.name]: programs }));
                }
            });
        }
        return () => { cancelled = true; };
        // epgByChannel intentionally omitted: it is only written here, and
        // including it would re-run the loop on every fetch resolution.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [renderedStreams]);

    // Load more rows when scrolling near the bottom
    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT * 4) {
            setVisibleRows(prev =>
                prev < categoryStreams.length ? Math.min(prev + ROWS_INCREMENT, categoryStreams.length) : prev
            );
        }
    }, [categoryStreams.length]);

    // Time paging: shift the visible window in 2h steps, clamped to the data range
    const pageWindow = useCallback((direction: 1 | -1) => {
        setGuideWindow(w => shiftWindow(w, direction * WINDOW_SHIFT_MS));
    }, []);
    const resetWindow = useCallback(() => {
        setGuideWindow(getGuideWindow());
    }, []);

    // Search over everything already fetched (module cache + this page's state)
    const searchResults = useMemo<ProgramSearchResult[]>(() => {
        if (!searchQuery.trim()) return [];
        const merged = new Map<string, EPGProgram[]>(epgCache);
        for (const [name, programs] of Object.entries(epgByChannel)) {
            if (programs) merged.set(name, programs);
        }
        return searchPrograms(merged, searchQuery);
    }, [searchQuery, epgByChannel]);

    const goToSearchResult = useCallback((result: ProgramSearchResult) => {
        setSearchQuery('');
        const channel = streams.find(s => s.name === result.channelKey);
        if (!channel) return;
        // Page the window so the program's start is visible
        setGuideWindow(w => {
            if (result.startMs >= w.start && result.startMs < w.end) return w;
            const span = w.end - w.start;
            const start = Math.floor(result.startMs / HALF_HOUR_MS) * HALF_HOUR_MS - HALF_HOUR_MS;
            return clampWindow({ start, end: start + span });
        });
        // Switch category if needed; the effect below scrolls once the row exists
        if (channel.category_id !== selectedCategory) setSelectedCategory(channel.category_id);
        setPendingScrollChannel(channel.name);
    }, [streams, selectedCategory]);

    // Scroll to (and briefly highlight) the searched channel's row once rendered
    useEffect(() => {
        if (!pendingScrollChannel) return;
        const index = categoryStreams.findIndex(s => s.name === pendingScrollChannel);
        if (index === -1) return;
        if (index >= visibleRows) {
            queueMicrotask(() => setVisibleRows(index + 1));
            return;
        }
        const row = rowRefs.current.get(pendingScrollChannel);
        if (!row) return;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setHighlightedChannel(pendingScrollChannel);
        setPendingScrollChannel(null);
        const timer = setTimeout(() => setHighlightedChannel(null), 2200);
        return () => clearTimeout(timer);
    }, [pendingScrollChannel, categoryStreams, visibleRows]);

    const buildLiveStreamUrl = async (channel: LiveStream): Promise<string> => {
        const result = await window.ipcRenderer.invoke('auth:get-credentials');
        if (result.success) {
            const { url, username, password } = result.credentials;
            return `${url}/live/${username}/${password}/${channel.stream_id}.m3u8`;
        }
        throw new Error('Credenciais não encontradas');
    };

    const startReplay = useCallback((channel: LiveStream, program: EPGProgram) => {
        setProgramPopover(null);
        setTimeshiftPlayback({ channel, program });
    }, []);

    // ⬇ Baixa o replay como gravação: resolve a URL de timeshift e entrega
    // pro pipeline do DVR (ffmpeg copy grava até o stream do programa acabar).
    const downloadReplay = useCallback(async (channel: LiveStream, program: EPGProgram) => {
        setProgramPopover(null);
        try {
            const result = await getTimeshiftUrl({
                streamId: channel.stream_id,
                startIso: program.start,
                durationMin: replayDurationMinutes(program.start, program.end)
            });
            if (result?.url) {
                await window.ipcRenderer.invoke('dvr:start', {
                    url: result.url,
                    channelName: `${channel.name} - ${program.title}`
                });
            }
        } catch { /* provedor sem timeshift utilizável */ }
    }, []);

    // Timeshift URL builder for the AsyncVideoPlayer — the main process picks
    // the URL form (probe) and converts the start to provider-local time.
    const buildTimeshiftStreamUrl = useCallback(async (channel: LiveStream): Promise<string> => {
        const program = timeshiftPlayback?.program;
        if (!program) throw new Error('Programa de replay não selecionado');
        const result = await getTimeshiftUrl({
            streamId: channel.stream_id,
            startIso: program.start,
            durationMin: replayDurationMinutes(program.start, program.end)
        });
        return result.url;
    }, [timeshiftPlayback]);

    const nowLineLeft = nowOffsetPx(now, guideWindow);

    if (loading) {
        return (
            <div style={pageWrapperStyle}>
                <div style={backdropStyle} />
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px' }}>
                    <div style={{
                        width: '48px', height: '48px', borderRadius: '50%',
                        border: '3px solid rgba(var(--ns-accent-rgb), 0.2)', borderTopColor: 'var(--ns-accent)',
                        animation: 'guideSpin 0.8s linear infinite'
                    }} />
                    <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '15px', fontWeight: 500 }}>
                        {t('guide', 'loading')}
                    </span>
                    <style>{`@keyframes guideSpin { to { transform: rotate(360deg); } }`}</style>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={pageWrapperStyle}>
                <div style={backdropStyle} />
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px' }}>
                    <span style={{ fontSize: '40px' }}>📡</span>
                    <p style={{ color: '#f87171', fontSize: '14px', maxWidth: '420px', textAlign: 'center' }}>{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div style={pageWrapperStyle}>
            <div style={backdropStyle} />
            <style>{`
                .guide-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
                .guide-scroll::-webkit-scrollbar-track { background: transparent; }
                .guide-scroll::-webkit-scrollbar-thumb {
                    background: linear-gradient(180deg, var(--ns-accent), var(--ns-accent-grad-to));
                    border-radius: 3px;
                }
                .guide-program:hover { filter: brightness(1.25); }
                .guide-channel-cell:hover { background: rgba(var(--ns-accent-rgb), 0.12) !important; }
                .guide-pager-btn:hover { background: rgba(var(--ns-accent-rgb), 0.25) !important; }
                .guide-search-result:hover { background: rgba(var(--ns-accent-rgb), 0.18) !important; }
                .guide-popover-action:hover { background: rgba(var(--ns-accent-rgb), 0.18) !important; }
                .guide-replay-hint { opacity: 0; transition: opacity 0.15s ease; }
                .guide-program-replay:hover .guide-replay-hint { opacity: 1; }
                .guide-row-highlight { animation: guideRowFlash 2.2s ease; }
                @keyframes guideRowFlash {
                    0%, 55% { background: rgba(var(--ns-accent-rgb), 0.22); }
                    100% { background: transparent; }
                }
            `}</style>

            {/* Header: title + category selector */}
            <div style={{
                position: 'relative', zIndex: 2,
                display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap',
                padding: '20px 24px 16px 60px'
            }}>
                <h1 style={{
                    fontSize: '24px', fontWeight: 800, margin: 0,
                    background: 'linear-gradient(135deg, #ffffff 0%, var(--ns-accent-light) 100%)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
                }}>
                    {t('guide', 'title')}
                </h1>
                <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    aria-label={t('guide', 'category')}
                    style={{
                        background: 'rgba(31, 41, 55, 0.9)',
                        color: 'white',
                        border: '1px solid rgba(var(--ns-accent-rgb), 0.4)',
                        borderRadius: '10px',
                        padding: '8px 14px',
                        fontSize: '14px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        outline: 'none',
                        maxWidth: '320px'
                    }}
                >
                    {categories.map(cat => (
                        <option key={cat.category_id} value={cat.category_id}>
                            {cat.category_name}
                        </option>
                    ))}
                </select>

                {/* Time paging: ◀ Hoje/Agora ▶ */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                        className="guide-pager-btn"
                        onClick={() => pageWindow(-1)}
                        aria-label={t('guide', 'earlier')}
                        title={t('guide', 'earlier')}
                        style={pagerButtonStyle}
                    >
                        ◀
                    </button>
                    <button
                        className="guide-pager-btn"
                        onClick={resetWindow}
                        title={t('guide', 'today')}
                        style={{ ...pagerButtonStyle, width: 'auto', padding: '0 12px', fontSize: '12px', fontWeight: 600 }}
                    >
                        {t('guide', 'today')}
                    </button>
                    <button
                        className="guide-pager-btn"
                        onClick={() => pageWindow(1)}
                        aria-label={t('guide', 'later')}
                        title={t('guide', 'later')}
                        style={pagerButtonStyle}
                    >
                        ▶
                    </button>
                </div>

                {/* Program search across the loaded EPG data */}
                <div style={{ position: 'relative', flex: '0 1 300px', minWidth: '210px' }}>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('guide', 'searchPlaceholder')}
                        aria-label={t('guide', 'searchPlaceholder')}
                        style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            background: 'rgba(31, 41, 55, 0.9)',
                            color: 'white',
                            border: '1px solid rgba(var(--ns-accent-rgb), 0.4)',
                            borderRadius: '10px',
                            padding: '8px 14px',
                            fontSize: '13px',
                            outline: 'none'
                        }}
                    />
                    {searchQuery.trim() !== '' && (
                        <div
                            className="guide-scroll"
                            style={{
                                position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                                zIndex: 60, maxHeight: '320px', overflowY: 'auto',
                                background: 'var(--ns-bg-panel)',
                                border: '1px solid rgba(var(--ns-accent-rgb), 0.35)',
                                borderRadius: '10px',
                                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)'
                            }}
                        >
                            {searchResults.length === 0 ? (
                                <div style={{ padding: '12px 14px', fontSize: '12px', fontStyle: 'italic', color: 'rgba(148, 163, 184, 0.9)' }}>
                                    {t('guide', 'searchNoResults')}
                                </div>
                            ) : (
                                searchResults.map(result => (
                                    <button
                                        key={result.channelKey + result.start + result.title}
                                        className="guide-search-result"
                                        onClick={() => goToSearchResult(result)}
                                        style={{
                                            display: 'block', width: '100%', textAlign: 'left',
                                            background: 'transparent', border: 'none', cursor: 'pointer',
                                            padding: '8px 14px',
                                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
                                        }}
                                    >
                                        <div style={{
                                            fontSize: '13px', fontWeight: 600, color: 'rgba(229, 231, 235, 1)',
                                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                        }}>
                                            {result.title}
                                        </div>
                                        <div style={{ fontSize: '11px', color: 'var(--ns-accent-light)' }}>
                                            {result.channelKey} · {formatGuideDayTime(result.startMs)}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    )}
                </div>

                <span style={{ fontSize: '13px', color: 'rgba(148, 163, 184, 0.9)' }}>
                    {categoryStreams.length} {t('guide', 'channels')}
                </span>
            </div>

            {/* Guide grid */}
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="guide-scroll"
                style={{
                    position: 'relative', zIndex: 1,
                    flex: 1, overflow: 'auto',
                    marginLeft: '60px', marginRight: '12px', marginBottom: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '14px',
                    background: 'rgba(15, 15, 26, 0.6)'
                }}
            >
                {categoryStreams.length === 0 ? (
                    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(156, 163, 175, 1)' }}>
                        <div style={{ fontSize: '48px', marginBottom: '12px', opacity: 0.5 }}>📺</div>
                        {t('guide', 'noChannels')}
                    </div>
                ) : (
                    <div style={{ position: 'relative', width: CHANNEL_COL_WIDTH + TIMELINE_WIDTH, minWidth: '100%' }}>
                        {/* Sticky time header */}
                        <div data-testid="guide-timeline-header" style={{
                            position: 'sticky', top: 0, zIndex: 30,
                            display: 'flex', height: HEADER_HEIGHT,
                            background: 'linear-gradient(180deg, var(--ns-bg-panel) 0%, var(--ns-bg-deep) 100%)',
                            borderBottom: '1px solid rgba(var(--ns-accent-rgb), 0.25)'
                        }}>
                            <div style={{
                                position: 'sticky', left: 0, zIndex: 31,
                                width: CHANNEL_COL_WIDTH, minWidth: CHANNEL_COL_WIDTH,
                                display: 'flex', alignItems: 'center', paddingLeft: '14px',
                                background: 'linear-gradient(180deg, var(--ns-bg-panel) 0%, var(--ns-bg-deep) 100%)',
                                borderRight: '1px solid rgba(255, 255, 255, 0.08)',
                                fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
                                textTransform: 'uppercase', color: 'var(--ns-accent-light)'
                            }}>
                                {t('guide', 'channelsHeader')}
                            </div>
                            {ticks.map((tick, i) => (
                                <div key={tick}
                                    data-testid={i === 0 ? 'guide-tick-first' : undefined}
                                    style={{
                                        width: PX_PER_HALF_HOUR, minWidth: PX_PER_HALF_HOUR,
                                        display: 'flex', alignItems: 'center', paddingLeft: '8px',
                                        borderLeft: '1px solid rgba(255, 255, 255, 0.06)',
                                        fontSize: '12px', fontWeight: 600, color: 'rgba(203, 213, 225, 0.9)'
                                    }}>
                                    {formatGuideTime(tick)}
                                </div>
                            ))}
                        </div>

                        {/* Channel rows */}
                        <div style={{ position: 'relative' }}>
                            {/* "Now" vertical line over all rows */}
                            {nowLineLeft !== null && (
                                <div style={{
                                    position: 'absolute',
                                    left: CHANNEL_COL_WIDTH + nowLineLeft,
                                    top: 0, bottom: 0, width: '2px',
                                    background: 'linear-gradient(180deg, var(--ns-accent), var(--ns-accent-grad-to))',
                                    boxShadow: '0 0 8px rgba(var(--ns-accent-rgb), 0.7)',
                                    zIndex: 20, pointerEvents: 'none'
                                }}>
                                    <span style={{
                                        position: 'absolute', top: '2px', left: '4px',
                                        fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px',
                                        textTransform: 'uppercase', color: 'var(--ns-accent-light)', whiteSpace: 'nowrap'
                                    }}>
                                        {t('guide', 'now')}
                                    </span>
                                </div>
                            )}

                            {renderedStreams.map(channel => {
                                const programs = epgByChannel[channel.name];
                                return (
                                    <div
                                        key={channel.stream_id}
                                        className={highlightedChannel === channel.name ? 'guide-row-highlight' : undefined}
                                        ref={el => {
                                            if (el) rowRefs.current.set(channel.name, el);
                                            else rowRefs.current.delete(channel.name);
                                        }}
                                        style={{
                                            display: 'flex', height: ROW_HEIGHT,
                                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
                                        }}
                                    >
                                        {/* Sticky channel cell */}
                                        <div
                                            className="guide-channel-cell"
                                            onClick={() => setPlayingChannel(channel)}
                                            title={channel.name}
                                            style={{
                                                position: 'sticky', left: 0, zIndex: 10,
                                                width: CHANNEL_COL_WIDTH, minWidth: CHANNEL_COL_WIDTH,
                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                padding: '0 12px',
                                                background: 'linear-gradient(90deg, #14142299 0%, #14142299 100%), var(--ns-bg-deep)',
                                                borderRight: '1px solid rgba(255, 255, 255, 0.08)',
                                                cursor: 'pointer',
                                                transition: 'background 0.2s ease'
                                            }}
                                        >
                                            <div style={{
                                                width: '40px', height: '40px', minWidth: '40px',
                                                borderRadius: '8px', overflow: 'hidden',
                                                background: 'linear-gradient(145deg, rgba(55, 65, 81, 1) 0%, rgba(31, 41, 55, 1) 100%)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}>
                                                {channel.stream_icon ? (
                                                    <LazyImage
                                                        src={channel.stream_icon}
                                                        alt=""
                                                        style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '3px' }}
                                                        fallback={<ChannelLetterFallback name={channel.name} />}
                                                    />
                                                ) : (
                                                    <ChannelLetterFallback name={channel.name} />
                                                )}
                                            </div>
                                            <span style={{
                                                fontSize: '13px', fontWeight: 500, color: 'rgba(229, 231, 235, 1)',
                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                            }}>
                                                {channel.name}
                                            </span>
                                            {channel.tv_archive === 1 && (
                                                <span
                                                    title={t('guide', 'replayBadge').replace('{days}', String(channel.tv_archive_duration || 1))}
                                                    style={{
                                                        marginLeft: 'auto', flexShrink: 0,
                                                        fontSize: '10px', lineHeight: 1,
                                                        padding: '3px 5px', borderRadius: '6px',
                                                        background: 'rgba(var(--ns-accent-rgb), 0.18)',
                                                        border: '1px solid rgba(var(--ns-accent-rgb), 0.35)',
                                                        color: 'var(--ns-accent-light)'
                                                    }}
                                                >
                                                    ⏪
                                                </span>
                                            )}
                                        </div>

                                        {/* Timeline cell */}
                                        <div style={{ position: 'relative', width: TIMELINE_WIDTH, minWidth: TIMELINE_WIDTH }}>
                                            {/* 30-min gridlines */}
                                            {ticks.map((tick, i) => i > 0 && (
                                                <div key={tick} style={{
                                                    position: 'absolute', left: i * PX_PER_HALF_HOUR, top: 0, bottom: 0,
                                                    width: '1px', background: 'rgba(255, 255, 255, 0.04)'
                                                }} />
                                            ))}

                                            {programs === undefined ? (
                                                <span style={rowPlaceholderStyle}>{t('guide', 'loadingEpg')}</span>
                                            ) : (() => {
                                                const blocks = programs
                                                    .map(p => ({ program: p, block: programToBlock(p.start, p.end, guideWindow) }))
                                                    .filter((e): e is { program: EPGProgram; block: NonNullable<ReturnType<typeof programToBlock>> } => e.block !== null);
                                                if (blocks.length === 0) {
                                                    return <span style={rowPlaceholderStyle}>{t('guide', 'noEpg')}</span>;
                                                }
                                                return blocks.map(({ program, block }) => {
                                                    const airing = isAiringNow(program.start, program.end, now);
                                                    const replayable = !airing && isReplayable(program, channel, now);
                                                    const future = !airing && Date.parse(program.start) > now;
                                                    const hasReminder = future && reminderIds.has(reminderId(channel.name, program.start));
                                                    const hasSchedule = future && scheduleIds.has(scheduleId(channel.name, program.start));
                                                    const baseTitle = program.description ? `${program.title}\n${program.description}` : program.title;
                                                    const openPopover = (e: React.MouseEvent<HTMLDivElement>) => {
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        setProgramPopover({
                                                            channel, program,
                                                            anchor: { x: Math.max(rect.left, e.clientX - 110), y: rect.bottom }
                                                        });
                                                    };
                                                    const handleClick = airing
                                                        ? (channel.tv_archive === 1
                                                            ? openPopover
                                                            : () => setPlayingChannel(channel))
                                                        : future
                                                            ? openPopover
                                                            : (replayable ? () => startReplay(channel, program) : undefined);
                                                    return (
                                                        <div
                                                            key={program.id + program.start}
                                                            className={replayable ? 'guide-program guide-program-replay' : 'guide-program'}
                                                            onClick={handleClick}
                                                            title={replayable
                                                                ? `${t('guide', 'replayOf').replace('{title}', program.title)}\n${baseTitle}`
                                                                : baseTitle}
                                                            style={{
                                                                position: 'absolute',
                                                                left: block.left + 2,
                                                                width: Math.max(block.width - 4, 6),
                                                                top: 5, bottom: 5,
                                                                borderRadius: '8px',
                                                                padding: '6px 8px',
                                                                overflow: 'hidden',
                                                                cursor: handleClick ? 'pointer' : 'default',
                                                                background: airing
                                                                    ? 'linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.35) 0%, rgba(var(--ns-accent-grad-to-rgb), 0.25) 100%)'
                                                                    : (replayable ? 'rgba(var(--ns-accent-rgb), 0.08)' : 'rgba(255, 255, 255, 0.05)'),
                                                                border: airing
                                                                    ? '1px solid rgba(var(--ns-accent-rgb), 0.6)'
                                                                    : '1px solid rgba(255, 255, 255, 0.08)',
                                                                borderLeft: airing
                                                                    ? '1px solid rgba(var(--ns-accent-rgb), 0.6)'
                                                                    : (replayable
                                                                        ? '3px solid rgba(var(--ns-accent-rgb), 0.55)'
                                                                        : '1px solid rgba(255, 255, 255, 0.08)'),
                                                                transition: 'filter 0.2s ease'
                                                            }}
                                                        >
                                                            {replayable && (
                                                                <span className="guide-replay-hint" aria-hidden style={{
                                                                    position: 'absolute', top: '4px', right: '6px',
                                                                    fontSize: '11px', color: 'var(--ns-accent-light)'
                                                                }}>
                                                                    ⏪
                                                                </span>
                                                            )}
                                                            {hasReminder && (
                                                                <span
                                                                    aria-hidden
                                                                    title={t('guide', 'removeReminder')}
                                                                    style={{
                                                                        position: 'absolute', top: '4px', right: hasSchedule ? '20px' : '6px',
                                                                        fontSize: '10px', lineHeight: 1
                                                                    }}
                                                                >
                                                                    🔔
                                                                </span>
                                                            )}
                                                            {hasSchedule && (
                                                                <span
                                                                    aria-hidden
                                                                    title={t('guide', 'cancelRecording')}
                                                                    style={{
                                                                        position: 'absolute', top: '4px', right: '6px',
                                                                        fontSize: '10px', lineHeight: 1, color: '#ef4444'
                                                                    }}
                                                                >
                                                                    ⏺
                                                                </span>
                                                            )}
                                                            <div style={{
                                                                fontSize: '12px', fontWeight: 600, lineHeight: '16px',
                                                                color: airing ? '#e9d5ff' : 'rgba(226, 232, 240, 0.9)',
                                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                                            }}>
                                                                {program.title}
                                                            </div>
                                                            <div style={{
                                                                fontSize: '10px', color: 'rgba(148, 163, 184, 0.9)',
                                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                                            }}>
                                                                {(block.clippedStart ? '◂ ' : '') +
                                                                    formatGuideTime(Date.parse(program.start)) + ' – ' +
                                                                    formatGuideTime(Date.parse(program.end)) +
                                                                    (block.clippedEnd ? ' ▸' : '')}
                                                            </div>
                                                        </div>
                                                    );
                                                });
                                            })()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Program actions: current program on archive channels (live /
                from start) or future program (set/remove reminder) */}
            {programPopover && (() => {
                const { channel, program } = programPopover;
                const isFutureProgram = Date.parse(program.start) > now;
                const popoverReminderId = reminderId(channel.name, program.start);
                const popoverScheduleId = scheduleId(channel.name, program.start);
                const actions: ProgramPopoverAction[] = isFutureProgram
                    ? [
                        ...(reminderIds.has(popoverReminderId)
                            ? [{
                                key: 'remove-reminder',
                                icon: '🔕',
                                label: t('guide', 'removeReminder'),
                                onClick: () => {
                                    reminderService.removeReminder(popoverReminderId);
                                    setProgramPopover(null);
                                }
                            }]
                            : ([undefined, 'daily', 'weekly'] as const).map(recurrence => ({
                                key: `add-reminder-${recurrence ?? 'once'}`,
                                icon: recurrence ? '🔁' : '🔔',
                                label: t('guide', recurrence === 'daily' ? 'remindDaily'
                                    : recurrence === 'weekly' ? 'remindWeekly' : 'remind'),
                                onClick: () => {
                                    reminderService.addReminder({
                                        channelName: channel.name,
                                        streamId: channel.stream_id,
                                        categoryId: channel.category_id,
                                        title: program.title,
                                        startIso: program.start,
                                        recurrence
                                    });
                                    setProgramPopover(null);
                                }
                            }))),
                        scheduleIds.has(popoverScheduleId)
                            ? {
                                key: 'remove-recording',
                                icon: '⏹',
                                label: t('guide', 'cancelRecording'),
                                onClick: () => {
                                    scheduledRecordingService.remove(popoverScheduleId);
                                    setProgramPopover(null);
                                }
                            }
                            : {
                                key: 'add-recording',
                                icon: '⏺',
                                label: t('guide', 'scheduleRecording'),
                                onClick: () => {
                                    scheduledRecordingService.add({
                                        channelName: channel.name,
                                        streamId: channel.stream_id,
                                        title: program.title,
                                        startIso: program.start,
                                        endIso: program.end
                                    });
                                    setProgramPopover(null);
                                }
                            }
                    ]
                    : [
                        {
                            key: 'watch-live',
                            icon: '📡',
                            label: t('guide', 'watchLive'),
                            onClick: () => {
                                setProgramPopover(null);
                                setPlayingChannel(channel);
                            }
                        },
                        {
                            key: 'watch-from-start',
                            icon: '▶',
                            label: t('guide', 'watchFromStart'),
                            onClick: () => startReplay(channel, program)
                        },
                        {
                            key: 'download-replay',
                            icon: '⬇',
                            label: t('guide', 'downloadReplay'),
                            onClick: () => { void downloadReplay(channel, program); }
                        }
                    ];
                return (
                    <ProgramActionsPopover
                        title={program.title}
                        anchor={programPopover.anchor}
                        onClose={() => setProgramPopover(null)}
                        actions={actions}
                    />
                );
            })()}

            {playingChannel && (
                <AsyncVideoPlayer
                    movie={playingChannel}
                    buildStreamUrl={buildLiveStreamUrl}
                    onClose={() => setPlayingChannel(null)}
                    customTitle={playingChannel.name}
                    contentId={playingChannel.stream_id.toString()}
                    contentType="live"
                />
            )}

            {timeshiftPlayback && (
                <AsyncVideoPlayer
                    movie={timeshiftPlayback.channel}
                    buildStreamUrl={buildTimeshiftStreamUrl}
                    onClose={() => setTimeshiftPlayback(null)}
                    customTitle={`${timeshiftPlayback.program.title} — ${timeshiftPlayback.channel.name}`}
                    contentId={`${timeshiftPlayback.channel.stream_id}-ts-${timeshiftPlayback.program.start}`}
                    contentType="live"
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Small anchored action popover for a program block. Action list is
// slot-friendly: future features (e.g. reminders) just append entries.
// ---------------------------------------------------------------------------
interface ProgramPopoverAction {
    key: string;
    icon?: string;
    label: string;
    onClick: () => void;
}

function ProgramActionsPopover({ title, anchor, actions, onClose }: {
    title: string;
    anchor: { x: number; y: number };
    actions: ProgramPopoverAction[];
    onClose: () => void;
}) {
    const POPOVER_WIDTH = 232;
    const estimatedHeight = 40 + actions.length * 42;
    const left = Math.max(8, Math.min(anchor.x, window.innerWidth - POPOVER_WIDTH - 8));
    const top = Math.max(8, Math.min(anchor.y + 6, window.innerHeight - estimatedHeight - 8));
    return (
        <>
            {/* Click-away backdrop */}
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80 }} />
            <div
                role="menu"
                style={{
                    position: 'fixed', left, top, zIndex: 81,
                    width: POPOVER_WIDTH, boxSizing: 'border-box',
                    background: 'var(--ns-bg-panel)',
                    border: '1px solid rgba(var(--ns-accent-rgb), 0.35)',
                    borderRadius: '12px',
                    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
                    padding: '6px'
                }}
            >
                <div style={{
                    padding: '8px 10px 6px',
                    fontSize: '11px', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    color: 'var(--ns-accent-light)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}>
                    {title}
                </div>
                {actions.map(action => (
                    <button
                        key={action.key}
                        className="guide-popover-action"
                        role="menuitem"
                        onClick={action.onClick}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            width: '100%', textAlign: 'left',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            borderRadius: '8px', padding: '10px 10px',
                            fontSize: '13px', fontWeight: 500,
                            color: 'rgba(229, 231, 235, 1)',
                            transition: 'background 0.15s ease'
                        }}
                    >
                        {action.icon && <span aria-hidden style={{ fontSize: '13px' }}>{action.icon}</span>}
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {action.label}
                        </span>
                    </button>
                ))}
            </div>
        </>
    );
}

/** "HH:MM" plus "dd/MM" when the timestamp falls on another day. */
function formatGuideDayTime(ms: number): string {
    const time = formatGuideTime(ms);
    const date = new Date(ms);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return time;
    return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`;
}

function ChannelLetterFallback({ name }: { name: string }) {
    // Skip country/quality prefixes when picking the letter (e.g. "BR: Globo" → G)
    const cleaned = name.replace(/^[a-z]{2,3}\s*[:|]\s*/i, '').trim();
    const letter = (cleaned[0] || name[0] || '?').toUpperCase();
    return (
        <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(135deg, var(--ns-accent) 0%, var(--ns-accent-grad-to) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px', fontWeight: 700, color: 'white'
        }}>
            {letter}
        </div>
    );
}

const pageWrapperStyle: React.CSSProperties = {
    position: 'relative',
    height: '100vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
};

const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'linear-gradient(135deg, var(--ns-bg-deep) 0%, var(--ns-bg-panel) 50%, var(--ns-bg-tint) 100%)',
    zIndex: 0
};

const pagerButtonStyle: React.CSSProperties = {
    width: '34px',
    height: '34px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(var(--ns-accent-rgb), 0.12)',
    color: 'var(--ns-accent-light)',
    border: '1px solid rgba(var(--ns-accent-rgb), 0.4)',
    borderRadius: '10px',
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'background 0.2s ease'
};

const rowPlaceholderStyle: React.CSSProperties = {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: '12px',
    fontStyle: 'italic',
    color: 'rgba(100, 116, 139, 0.8)'
};
