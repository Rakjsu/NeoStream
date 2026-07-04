import { useState } from 'react';
import { usageStatsService, type UsageStats, type DailyStats } from '../../services/usageStatsService';
import {
    aggregateTopContent,
    aggregateTopGenres,
    fillLastNDays,
    typeShare,
    dailyAverageSeconds,
    busiestWeekday
} from '../../services/statsDashboardHelpers';
import { useLanguage } from '../../services/languageService';
import { WrappedOverlay } from '../../components/WrappedOverlay';

const TYPE_COLORS = { movies: '#3b82f6', series: '#10b981', live: '#f59e0b' } as const;
const LOCALE_BY_LANGUAGE: Record<string, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

export function StatsSection() {
    // Load usage stats
    const [usageStats] = useState<UsageStats | null>(() => usageStatsService.getStats());
    const [weeklyStats] = useState<DailyStats[]>(() => usageStatsService.getWeeklyStats());
    const [showWrapped, setShowWrapped] = useState(false);
    const { t, language } = useLanguage();

    const today = new Date().toISOString().split('T')[0];
    const monthlyStats = fillLastNDays(usageStats?.dailyStats || [], 30, today);
    const share = typeShare(usageStats?.contentBreakdown || { movies: 0, series: 0, live: 0 });
    const topContent = aggregateTopContent(usageStats?.sessionsThisMonth || []);
    const topGenres = aggregateTopGenres(usageStats?.sessionsThisMonth || []);
    const dailyAverage = dailyAverageSeconds(usageStats?.dailyStats || [], 30, today);
    const busiestDay = busiestWeekday(usageStats?.dailyStats || []);

    // Helper functions for stats display
    const formatWatchTime = (seconds: number) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours}h ${minutes}min`;
        return `${minutes}min`;
    };

    const getWeekDayLabel = (dateStr: string) => {
        const date = new Date(dateStr + 'T12:00:00');
        return ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][date.getDay()];
    };

    const getMaxWeeklySeconds = () => {
        return Math.max(...weeklyStats.map(d => d.totalSeconds), 1);
    };

    const weekdayName = (dayIndex: number) => {
        // 2026-03-01 is a Sunday; offset from it to name any weekday.
        const date = new Date(2026, 2, 1 + dayIndex, 12);
        return date.toLocaleDateString(LOCALE_BY_LANGUAGE[language] || 'pt-BR', { weekday: 'long' });
    };

    const maxMonthlySeconds = Math.max(...monthlyStats.map(d => d.totalSeconds), 1);
    const hasShare = share.movies + share.series + share.live > 0;
    const donutGradient = hasShare
        ? `conic-gradient(${TYPE_COLORS.movies} 0% ${share.movies}%, ${TYPE_COLORS.series} ${share.movies}% ${share.movies + share.series}%, ${TYPE_COLORS.live} ${share.movies + share.series}% 100%)`
        : 'conic-gradient(rgba(255,255,255,0.08) 0% 100%)';

    const renderRankedBars = (items: { name: string; seconds: number; type?: string }[], accentColor: string) => {
        const maxSeconds = Math.max(...items.map(i => i.seconds), 1);
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {items.map((item) => (
                    <div key={`${item.type || 'genre'}:${item.name}`}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                                {item.type === 'movie' ? '🎬 ' : item.type === 'series' ? '📺 ' : item.type === 'live' ? '📡 ' : ''}{item.name}
                            </span>
                            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                                {formatWatchTime(item.seconds)}
                            </span>
                        </div>
                        <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px' }}>
                            <div style={{
                                height: '100%',
                                width: `${Math.max(2, (item.seconds / maxSeconds) * 100)}%`,
                                background: `linear-gradient(90deg, ${accentColor}, ${accentColor}88)`,
                                borderRadius: '3px',
                                transition: 'width 0.3s ease'
                            }} />
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="section-card">
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, var(--ns-accent), var(--ns-accent-dark))' }}>📊</div>
                <div>
                    <h2>{t('stats', 'title')}</h2>
                    <p>{t('stats', 'description')}</p>
                </div>
                <button
                    className="check-btn"
                    style={{ width: 'auto', padding: '10px 20px', marginLeft: 'auto' }}
                    onClick={() => setShowWrapped(true)}
                >
                    <span>🎁</span>
                    <span>{t('wrapped', 'open')}</span>
                </button>
            </div>

            {showWrapped && <WrappedOverlay onClose={() => setShowWrapped(false)} />}

            <div className="settings-group">
                {/* Main Stats Cards */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '16px',
                    marginBottom: '24px'
                }}>
                    {/* Total Watch Time */}
                    <div style={{
                        background: 'linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.2), rgba(var(--ns-accent-rgb), 0.1))',
                        borderRadius: '16px',
                        padding: '24px',
                        border: '1px solid rgba(var(--ns-accent-rgb), 0.3)'
                    }}>
                        <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏱️</div>
                        <div style={{
                            fontSize: '28px',
                            fontWeight: 700,
                            color: 'var(--ns-accent-light)',
                            marginBottom: '4px'
                        }}>
                            {formatWatchTime(usageStats?.totalWatchTimeThisMonth || 0)}
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>
                            {t('stats', 'thisMonth')}
                        </div>
                    </div>

                    {/* Watch Streak */}
                    <div style={{
                        background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.2), rgba(234, 88, 12, 0.1))',
                        borderRadius: '16px',
                        padding: '24px',
                        border: '1px solid rgba(251, 146, 60, 0.3)'
                    }}>
                        <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔥</div>
                        <div style={{
                            fontSize: '28px',
                            fontWeight: 700,
                            color: '#fb923c',
                            marginBottom: '4px'
                        }}>
                            {usageStats?.watchStreak || 0} {t('stats', 'days')}
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>
                            {t('stats', 'currentStreak')}
                        </div>
                    </div>
                </div>

                {/* Content Breakdown */}
                <div style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '16px',
                    padding: '20px',
                    border: '1px solid rgba(255,255,255,0.05)',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>
                        {t('stats', 'timeByType')}
                    </h3>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <div style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', marginBottom: '4px' }}>🎬</div>
                            <div style={{ color: '#3b82f6', fontWeight: 600 }}>
                                {formatWatchTime(usageStats?.contentBreakdown?.movies || 0)}
                            </div>
                            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px' }}>{t('stats', 'movies')}</div>
                        </div>
                        <div style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', marginBottom: '4px' }}>📺</div>
                            <div style={{ color: '#10b981', fontWeight: 600 }}>
                                {formatWatchTime(usageStats?.contentBreakdown?.series || 0)}
                            </div>
                            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px' }}>{t('stats', 'series')}</div>
                        </div>
                        <div style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', marginBottom: '4px' }}>📡</div>
                            <div style={{ color: '#f59e0b', fontWeight: 600 }}>
                                {formatWatchTime(usageStats?.contentBreakdown?.live || 0)}
                            </div>
                            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px' }}>{t('stats', 'liveTV')}</div>
                        </div>
                    </div>
                </div>

                {/* Weekly Chart */}
                <div style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '16px',
                    padding: '20px',
                    border: '1px solid rgba(255,255,255,0.05)'
                }}>
                    <h3 style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>
                        {t('stats', 'last7Days')}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '80px' }}>
                        {weeklyStats.map((day, i) => {
                            const height = Math.max(8, (day.totalSeconds / getMaxWeeklySeconds()) * 70);
                            const isToday = day.date === new Date().toISOString().split('T')[0];
                            return (
                                <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                                    <div
                                        style={{
                                            height: `${height}px`,
                                            background: isToday
                                                ? 'linear-gradient(180deg, var(--ns-accent), var(--ns-accent-dark))'
                                                : 'linear-gradient(180deg, rgba(var(--ns-accent-rgb), 0.5), rgba(var(--ns-accent-rgb), 0.2))',
                                            borderRadius: '4px',
                                            margin: '0 auto',
                                            width: '100%',
                                            maxWidth: '24px',
                                            transition: 'height 0.3s ease'
                                        }}
                                        title={`${formatWatchTime(day.totalSeconds)}`}
                                    />
                                    <div style={{
                                        color: isToday ? 'var(--ns-accent-light)' : 'rgba(255,255,255,0.4)',
                                        fontSize: '11px',
                                        marginTop: '6px',
                                        fontWeight: isToday ? 600 : 400
                                    }}>
                                        {getWeekDayLabel(day.date)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 30-day chart */}
                <div style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '16px',
                    padding: '20px',
                    border: '1px solid rgba(255,255,255,0.05)',
                    marginTop: '20px'
                }}>
                    <h3 style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>
                        {t('stats', 'last30Days')}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '70px' }}>
                        {monthlyStats.map((dayStats) => {
                            const height = dayStats.totalSeconds > 0
                                ? Math.max(4, (dayStats.totalSeconds / maxMonthlySeconds) * 64)
                                : 2;
                            const isToday = dayStats.date === today;
                            return (
                                <div
                                    key={dayStats.date}
                                    title={`${dayStats.date} — ${formatWatchTime(dayStats.totalSeconds)}`}
                                    style={{
                                        flex: 1,
                                        height: `${height}px`,
                                        background: isToday
                                            ? 'linear-gradient(180deg, var(--ns-accent), var(--ns-accent-dark))'
                                            : dayStats.totalSeconds > 0
                                                ? 'linear-gradient(180deg, rgba(var(--ns-accent-rgb), 0.55), rgba(var(--ns-accent-rgb), 0.2))'
                                                : 'rgba(255,255,255,0.06)',
                                        borderRadius: '2px',
                                        transition: 'height 0.3s ease'
                                    }}
                                />
                            );
                        })}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', color: 'rgba(255,255,255,0.35)', fontSize: '10px' }}>
                        <span>{monthlyStats[0]?.date.slice(5)}</span>
                        <span>{monthlyStats[monthlyStats.length - 1]?.date.slice(5)}</span>
                    </div>
                </div>

                {/* Type share donut + top content side by side */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '20px',
                    marginTop: '20px'
                }}>
                    {/* Donut chart */}
                    <div style={{
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '16px',
                        padding: '20px',
                        border: '1px solid rgba(255,255,255,0.05)'
                    }}>
                        <h3 style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>
                            {t('stats', 'typeShare')}
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                            <div style={{
                                width: '110px',
                                height: '110px',
                                borderRadius: '50%',
                                background: donutGradient,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                            }}>
                                <div style={{
                                    width: '70px',
                                    height: '70px',
                                    borderRadius: '50%',
                                    background: 'var(--ns-bg, #141414)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'rgba(255,255,255,0.7)',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    textAlign: 'center'
                                }}>
                                    {formatWatchTime(usageStats?.totalWatchTimeSeconds || 0)}
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                                {([
                                    ['movies', t('stats', 'movies')],
                                    ['series', t('stats', 'series')],
                                    ['live', t('stats', 'liveTV')]
                                ] as const).map(([key, label]) => (
                                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: TYPE_COLORS[key], flexShrink: 0 }} />
                                        <span style={{ color: 'rgba(255,255,255,0.75)' }}>{label}</span>
                                        <span style={{ color: 'rgba(255,255,255,0.45)', fontVariantNumeric: 'tabular-nums' }}>{share[key]}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Averages */}
                    <div style={{
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '16px',
                        padding: '20px',
                        border: '1px solid rgba(255,255,255,0.05)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px',
                        justifyContent: 'center'
                    }}>
                        <div>
                            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginBottom: '4px' }}>
                                📈 {t('stats', 'dailyAverage')}
                            </div>
                            <div style={{ color: 'white', fontSize: '22px', fontWeight: 700 }}>
                                {formatWatchTime(dailyAverage)}
                            </div>
                        </div>
                        {busiestDay !== null && (
                            <div>
                                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginBottom: '4px' }}>
                                    📅 {t('stats', 'busiestDay')}
                                </div>
                                <div style={{ color: 'white', fontSize: '18px', fontWeight: 600, textTransform: 'capitalize' }}>
                                    {weekdayName(busiestDay)}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Top content of the month */}
                {topContent.length > 0 && (
                    <div style={{
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '16px',
                        padding: '20px',
                        border: '1px solid rgba(255,255,255,0.05)',
                        marginTop: '20px'
                    }}>
                        <h3 style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>
                            🏆 {t('stats', 'topContent')}
                        </h3>
                        {renderRankedBars(topContent, 'var(--ns-accent)')}
                    </div>
                )}

                {/* Top genres of the month */}
                {topGenres.length > 0 && (
                    <div style={{
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '16px',
                        padding: '20px',
                        border: '1px solid rgba(255,255,255,0.05)',
                        marginTop: '20px'
                    }}>
                        <h3 style={{ color: 'white', fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>
                            🎭 {t('stats', 'topGenres')}
                        </h3>
                        {renderRankedBars(topGenres, '#a855f7')}
                    </div>
                )}

                {/* Empty state hint */}
                {!hasShare && (
                    <div style={{ marginTop: '16px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>
                        {t('stats', 'noData')}
                    </div>
                )}

                {/* Total All Time */}
                <div style={{
                    marginTop: '16px',
                    padding: '16px',
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: '12px',
                    textAlign: 'center'
                }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>
                        {t('stats', 'totalAccumulated')}: {' '}
                    </span>
                    <span style={{ color: 'white', fontWeight: 600 }}>
                        {formatWatchTime(usageStats?.totalWatchTimeSeconds || 0)}
                    </span>
                    {usageStats?.longestStreak && usageStats.longestStreak > 0 && (
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginLeft: '16px' }}>
                            • {t('stats', 'longestStreak')}: {usageStats.longestStreak} {t('stats', 'days')}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
