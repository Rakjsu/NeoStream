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
    PX_PER_HALF_HOUR,
    WINDOW_HALF_HOURS
} from '../utils/epgGuide';

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
                const programs = await epgService.fetchChannelEPG(channel.epg_channel_id || '', channel.name);
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
    const scrollRef = useRef<HTMLDivElement>(null);
    const isKidsProfile = profileService.getActiveProfile()?.isKids || false;
    const { t } = useLanguage();

    // Fixed window for the page's lifetime; the "now" line moves within it.
    const guideWindow = useMemo(() => getGuideWindow(), []);
    const ticks = useMemo(() => buildTimeTicks(guideWindow), [guideWindow]);

    // "Now" line updates every minute
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(id);
    }, []);

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

    // Reset windowed rows when category changes
    useEffect(() => {
        setVisibleRows(INITIAL_ROWS);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [selectedCategory]);

    // Lazy EPG fetch for the rendered rows (concurrency-limited, module-cached)
    useEffect(() => {
        let cancelled = false;
        for (const channel of renderedStreams) {
            const cached = epgCache.get(channel.name);
            if (cached) {
                if (epgByChannel[channel.name] === undefined) {
                    setEpgByChannel(prev =>
                        prev[channel.name] === undefined ? { ...prev, [channel.name]: cached } : prev
                    );
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

    const buildLiveStreamUrl = async (channel: LiveStream): Promise<string> => {
        const result = await window.ipcRenderer.invoke('auth:get-credentials');
        if (result.success) {
            const { url, username, password } = result.credentials;
            return `${url}/live/${username}/${password}/${channel.stream_id}.m3u8`;
        }
        throw new Error('Credenciais não encontradas');
    };

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
            `}</style>

            {/* Header: title + category selector */}
            <div style={{
                position: 'relative', zIndex: 2,
                display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap',
                padding: '20px 24px 16px 60px'
            }}>
                <h1 style={{
                    fontSize: '24px', fontWeight: 800, margin: 0,
                    background: 'linear-gradient(135deg, #ffffff 0%, #c4b5fd 100%)',
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
                        <div style={{
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
                                textTransform: 'uppercase', color: 'rgba(196, 181, 253, 0.9)'
                            }}>
                                {t('guide', 'channelsHeader')}
                            </div>
                            {ticks.map(tick => (
                                <div key={tick} style={{
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
                                    <div key={channel.stream_id} style={{
                                        display: 'flex', height: ROW_HEIGHT,
                                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
                                    }}>
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
                                                    return (
                                                        <div
                                                            key={program.id + program.start}
                                                            className="guide-program"
                                                            onClick={airing ? () => setPlayingChannel(channel) : undefined}
                                                            title={program.description ? `${program.title}\n${program.description}` : program.title}
                                                            style={{
                                                                position: 'absolute',
                                                                left: block.left + 2,
                                                                width: Math.max(block.width - 4, 6),
                                                                top: 5, bottom: 5,
                                                                borderRadius: '8px',
                                                                padding: '6px 8px',
                                                                overflow: 'hidden',
                                                                cursor: airing ? 'pointer' : 'default',
                                                                background: airing
                                                                    ? 'linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.35) 0%, rgba(var(--ns-accent-grad-to-rgb), 0.25) 100%)'
                                                                    : 'rgba(255, 255, 255, 0.05)',
                                                                border: airing
                                                                    ? '1px solid rgba(var(--ns-accent-rgb), 0.6)'
                                                                    : '1px solid rgba(255, 255, 255, 0.08)',
                                                                transition: 'filter 0.2s ease'
                                                            }}
                                                        >
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
        </div>
    );
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

const rowPlaceholderStyle: React.CSSProperties = {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: '12px',
    fontStyle: 'italic',
    color: 'rgba(100, 116, 139, 0.8)'
};
