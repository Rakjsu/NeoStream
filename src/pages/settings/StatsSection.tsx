import { useState } from 'react';
import { usageStatsService, type UsageStats, type DailyStats } from '../../services/usageStatsService';
import { useLanguage } from '../../services/languageService';

export function StatsSection() {
    // Load usage stats
    const [usageStats] = useState<UsageStats | null>(() => usageStatsService.getStats());
    const [weeklyStats] = useState<DailyStats[]>(() => usageStatsService.getWeeklyStats());
    const { t } = useLanguage();

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

    return (
        <div className="section-card">
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, var(--ns-accent), var(--ns-accent-dark))' }}>📊</div>
                <div>
                    <h2>{t('stats', 'title')}</h2>
                    <p>{t('stats', 'description')}</p>
                </div>
            </div>

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
