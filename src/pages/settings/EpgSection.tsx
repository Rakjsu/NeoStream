import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useLanguage } from '../../services/languageService';
import { epgService } from '../../services/epgService';
import epgTestService, { type EpgTestResult, type EpgTestProgress } from '../../services/epgTestService';

export type EpgResultsFilter = 'all' | 'working' | 'notWorking';
export type EpgCountryFilter = 'all' | 'BR' | 'ARG' | 'US' | 'PT';

interface EpgSectionProps {
    epgResultsFilter: EpgResultsFilter;
    setEpgResultsFilter: Dispatch<SetStateAction<EpgResultsFilter>>;
    epgCountryFilter: EpgCountryFilter;
    setEpgCountryFilter: Dispatch<SetStateAction<EpgCountryFilter>>;
    epgSearchTerm: string;
    setEpgSearchTerm: Dispatch<SetStateAction<string>>;
    epgCurrentPage: number;
    setEpgCurrentPage: Dispatch<SetStateAction<number>>;
}

export function EpgSection({
    epgResultsFilter,
    setEpgResultsFilter,
    epgCountryFilter,
    setEpgCountryFilter,
    epgSearchTerm,
    setEpgSearchTerm,
    epgCurrentPage,
    setEpgCurrentPage
}: EpgSectionProps) {
    const { t } = useLanguage();

    // EPG Test states - synced with global background service
    const [externalEpgUrl, setExternalEpgUrl] = useState(() => epgService.getUserEpgUrl());
    const [externalEpgSaved, setExternalEpgSaved] = useState(false);
    const [testingEpg, setTestingEpg] = useState(epgTestService.isRunning);
    const [epgTestProgress, setEpgTestProgress] = useState<EpgTestProgress>(epgTestService.progress);
    const [epgTestResults, setEpgTestResults] = useState<EpgTestResult | null>(epgTestService.results);
    const [lastEpgTestDate, setLastEpgTestDate] = useState<string | null>(epgTestService.lastTestDate);
    const EPG_ITEMS_PER_PAGE = 50;
    const epgResultsRef = useRef<HTMLDivElement>(null);

    type EpgWorkingItem = EpgTestResult['working'][number] & { type: 'working' };
    type EpgNotWorkingItem = EpgTestResult['notWorking'][number] & { type: 'notWorking' };

    // Subscribe to EPG test service state changes (runs in background even when navigating away)
    useEffect(() => {
        epgTestService.setTranslateFunction(t);
        const unsubscribe = epgTestService.subscribe(() => {
            setTestingEpg(epgTestService.isRunning);
            setEpgTestProgress(epgTestService.progress);
            setEpgTestResults(epgTestService.results);
            setLastEpgTestDate(epgTestService.lastTestDate);
        });
        return unsubscribe;
    }, [t]);

    // EPG handlers - delegate to background service
    const handleEpgTest = (mode: 'full' | 'continue' | 'retryFailed' = 'full') => {
        epgTestService.startTest(mode);
    };
    const handleEpgPause = () => epgTestService.pause();
    const handleClearEpgCache = () => epgTestService.clearCache();

    // Playlist channel counts by country
    const [playlistChannelCounts, setPlaylistChannelCounts] = useState<{
        total: number;
        BR: number;
        ARG: number;
        US: number;
        PT: number;
    }>({ total: 0, BR: 0, ARG: 0, US: 0, PT: 0 });

    // Load playlist channel counts when EPG section is active
    useEffect(() => {
        (async () => {
            try {
                const result = await window.ipcRenderer.invoke('streams:get-live');
                if (result.success && result.data) {
                    const channels = result.data as { name: string }[];
                    let BR = 0, ARG = 0, US = 0, PT = 0;

                    channels.forEach(ch => {
                        const name = ch.name.toUpperCase();
                        if (name.startsWith('USA:') || name.includes(' USA')) {
                            US++;
                        } else if (name.startsWith('ARG |') || name.startsWith('AR:')) {
                            ARG++;
                        } else if (name.startsWith('PT:') || name.startsWith('PT |')) {
                            PT++;
                        } else {
                            BR++; // Default to BR
                        }
                    });

                    setPlaylistChannelCounts({
                        total: channels.length,
                        BR, ARG, US, PT
                    });
                }
            } catch (e) {
                console.error('Failed to load playlist counts:', e);
            }
        })();
    }, []);

    return (
        <div className="section-card">
            {/* EPG Animations */}
            <style>{`
                @keyframes epgPulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                @keyframes epgGlow {
                    0%, 100% { box-shadow: 0 0 15px rgba(6, 182, 212, 0.3); }
                    50% { box-shadow: 0 0 25px rgba(6, 182, 212, 0.5); }
                }
                @keyframes epgSlideIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes epgProgressShine {
                    0% { background-position: -200% 0; }
                    100% { background-position: 200% 0; }
                }
                .epg-grid-item {
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    cursor: default;
                }
                .epg-grid-item:hover {
                    transform: translateY(-3px) scale(1.02);
                    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
                }
                .epg-country-card {
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    cursor: pointer;
                }
                .epg-country-card:hover {
                    transform: translateY(-4px) scale(1.05);
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
                }
                .epg-channel-item {
                    transition: all 0.2s ease;
                    animation: epgSlideIn 0.3s ease forwards;
                }
                .epg-channel-item:hover {
                    transform: translateX(4px);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                }
                .epg-progress-bar {
                    background: linear-gradient(90deg, #06b6d4, var(--ns-accent), #06b6d4);
                    background-size: 200% 100%;
                    animation: epgProgressShine 2s linear infinite;
                }
                .epg-testing-badge {
                    animation: epgPulse 1.5s ease-in-out infinite;
                }
                .epg-filter-btn {
                    transition: all 0.25s ease;
                }
                .epg-filter-btn:hover {
                    transform: translateY(-2px);
                }
                .epg-filter-btn:active {
                    transform: scale(0.95);
                }
                .epg-page-btn {
                    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                    position: relative;
                    overflow: hidden;
                }
                .epg-page-btn:hover:not(:disabled) {
                    transform: translateY(-3px) scale(1.05);
                    box-shadow: 0 6px 20px rgba(6, 182, 212, 0.4);
                }
                .epg-page-btn:active:not(:disabled) {
                    transform: scale(0.92);
                }
                .epg-page-btn:disabled {
                    opacity: 0.5;
                }
                .epg-page-indicator {
                    transition: all 0.3s ease;
                    animation: epgPulse 2s ease-in-out infinite;
                }
            `}</style>
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, #06b6d4, #0891b2)' }}>📡</div>
                <div>
                    <h2>Teste de EPG</h2>
                    <p>Verifique se seus canais têm guia de programação. O teste continua mesmo navegando.</p>
                </div>
            </div>

            <div className="settings-group">
                {/* XMLTV externo do usuário — prioridade máxima na cadeia de EPG */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>🌐 {t('epg', 'externalEpgTitle')}</label>
                        <p>{t('epg', 'externalEpgHint')}</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '0 4px 18px' }}>
                    <input
                        type="text"
                        value={externalEpgUrl}
                        placeholder="https://exemplo.com/guia.xml"
                        spellCheck={false}
                        onChange={(e) => { setExternalEpgUrl(e.target.value); setExternalEpgSaved(false); }}
                        style={{
                            flex: '1 1 320px', maxWidth: 520, padding: '12px 14px', borderRadius: 10,
                            border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.06)',
                            color: '#fff', fontSize: 14, fontFamily: 'monospace',
                        }}
                    />
                    <button
                        onClick={() => { epgService.setUserEpgUrl(externalEpgUrl); setExternalEpgSaved(true); }}
                        style={{
                            padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                            background: 'linear-gradient(135deg, #06b6d4, #0891b2)', color: '#06222a', fontWeight: 700,
                        }}
                    >
                        {t('epg', 'externalEpgSave')}
                    </button>
                    {externalEpgSaved && (
                        <span style={{ alignSelf: 'center', color: '#34d399', fontSize: 13, fontWeight: 600 }}>
                            ✓ {t('epg', 'externalEpgSaved')}
                        </span>
                    )}
                </div>

                {/* Playlist Channel Counts Grid - Redesigned */}
                {playlistChannelCounts.total > 0 && (
                    <div style={{ marginBottom: '24px' }}>
                        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', marginBottom: '12px', display: 'block', textTransform: 'uppercase', letterSpacing: '1px' }}>
                            📺 {t('epg', 'playlistChannels')}
                        </label>
                        {/* Featured Total Card */}
                        <div className="setting-item epg-grid-item" style={{
                            padding: '20px',
                            background: 'linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.2), rgba(var(--ns-accent-grad-to-rgb), 0.15))',
                            border: '1px solid rgba(var(--ns-accent-rgb), 0.4)',
                            marginBottom: '12px',
                            justifyContent: 'center'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
                                <div style={{ fontSize: '42px', fontWeight: 800, color: 'var(--ns-accent)' }}>
                                    {playlistChannelCounts.total}
                                </div>
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ color: 'white', fontSize: '16px', fontWeight: 600 }}>{t('epg', 'channelsLabel')}</div>
                                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>{t('epg', 'availableForTest')}</div>
                                </div>
                            </div>
                        </div>
                        {/* Countries Row */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                            {[
                                { code: 'BR', flag: '🇧🇷', count: playlistChannelCounts.BR, color: '#22c55e', label: 'Brasil' },
                                { code: 'ARG', flag: '🇦🇷', count: playlistChannelCounts.ARG, color: '#60a5fa', label: 'Argentina' },
                                { code: 'US', flag: '🇺🇸', count: playlistChannelCounts.US, color: '#f59e0b', label: 'EUA' },
                                { code: 'PT', flag: '🇵🇹', count: playlistChannelCounts.PT, color: '#ef4444', label: 'Portugal' }
                            ].map(({ code, flag, count, color, label }) => (
                                <div key={code} className="setting-item epg-grid-item" style={{
                                    padding: '12px 8px',
                                    background: `rgba(${color === '#22c55e' ? '34, 197, 94' : color === '#60a5fa' ? '96, 165, 250' : color === '#f59e0b' ? '245, 158, 11' : '239, 68, 68'}, 0.1)`,
                                    border: `1px solid rgba(${color === '#22c55e' ? '34, 197, 94' : color === '#60a5fa' ? '96, 165, 250' : color === '#f59e0b' ? '245, 158, 11' : '239, 68, 68'}, 0.25)`,
                                    justifyContent: 'center'
                                }}>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '18px', marginBottom: '4px' }}>{flag}</div>
                                        <div style={{ fontSize: '20px', fontWeight: 800, color }}>{count}</div>
                                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', marginTop: '2px' }}>{label}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Status Info */}
                {lastEpgTestDate && !testingEpg && (
                    <div className="last-check">
                        <span className="check-icon">📅</span>
                        <span>{t('epg', 'lastTest')} <strong>{lastEpgTestDate}</strong></span>
                    </div>
                )}

                {/* Progress when testing */}
                {testingEpg && (
                    <div className="setting-item" style={{
                        background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(var(--ns-accent-rgb), 0.1))',
                        border: '1px solid rgba(6, 182, 212, 0.3)'
                    }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <label className="epg-testing-badge" style={{ color: '#06b6d4', fontWeight: 700 }}>
                                    ⏳ {t('epg', 'testingBackground')}
                                </label>
                                <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
                                    {epgTestProgress.current} / {epgTestProgress.total}
                                </span>
                            </div>
                            <div style={{
                                height: '8px',
                                background: 'rgba(255,255,255,0.1)',
                                borderRadius: '4px',
                                overflow: 'hidden',
                                marginBottom: '8px'
                            }}>
                                <div className="epg-progress-bar" style={{
                                    width: `${epgTestProgress.total > 0 ? (epgTestProgress.current / epgTestProgress.total) * 100 : 0}%`,
                                    height: '100%',
                                    borderRadius: '4px',
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                            <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>
                                📺 {epgTestProgress.currentChannel}
                            </p>
                        </div>
                    </div>
                )}

                {/* Main Action Button */}
                {!testingEpg ? (
                    <button className="check-btn" onClick={() => handleEpgTest('full')} style={{
                        background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)'
                    }}>
                        <span>🧪</span>
                        <span>{t('epg', 'testAllChannels')}</span>
                    </button>
                ) : (
                    <button className="check-btn" onClick={handleEpgPause} style={{
                        background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                    }}>
                        <span>⏸️</span>
                        <span>{t('epg', 'pauseTest')}</span>
                    </button>
                )}

                {/* Secondary Actions */}
                {!testingEpg && epgTestResults && (
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {epgTestResults.lastScannedIndex && epgTestResults.lastScannedIndex < (epgTestResults.summary?.total || 0) && (
                            <button className="check-btn" onClick={() => handleEpgTest('continue')} style={{
                                flex: 1,
                                background: 'linear-gradient(135deg, var(--ns-accent) 0%, var(--ns-accent-dark) 100%)'
                            }}>
                                <span>▶️</span>
                                <span>{t('epg', 'continueFrom')} ({epgTestResults.lastScannedIndex}/{epgTestResults.summary?.total})</span>
                            </button>
                        )}
                        {epgTestResults.notWorking.length > 0 && (
                            <button className="check-btn" onClick={() => handleEpgTest('retryFailed')} style={{
                                flex: 1,
                                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                            }}>
                                <span>🔁</span>
                                <span>{t('epg', 'retryFailed')} ({epgTestResults.notWorking.length})</span>
                            </button>
                        )}
                        <button className="check-btn" onClick={handleClearEpgCache} style={{
                            flex: 1,
                            background: 'rgba(255,255,255,0.1)',
                            color: 'rgba(255,255,255,0.7)'
                        }}>
                            <span>🗑️</span>
                            <span>{t('epg', 'clearCache')}</span>
                        </button>
                    </div>
                )}
                {/* Results Summary */}
                {epgTestResults && (
                    <div ref={epgResultsRef} style={{ marginTop: '24px' }}>
                        {/* Success Rate Bar */}
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>{t('epg', 'successRate')}</span>
                                <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '14px' }}>
                                    {Math.round((epgTestResults.working.length / (epgTestResults.working.length + epgTestResults.notWorking.length || 1)) * 100)}%
                                </span>
                            </div>
                            <div style={{
                                height: '12px',
                                background: 'rgba(239, 68, 68, 0.3)',
                                borderRadius: '6px',
                                overflow: 'hidden',
                                display: 'flex'
                            }}>
                                <div style={{
                                    width: `${(epgTestResults.working.length / (epgTestResults.working.length + epgTestResults.notWorking.length || 1)) * 100}%`,
                                    background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                                    borderRadius: '6px',
                                    transition: 'width 0.5s ease'
                                }} />
                            </div>
                        </div>

                        {/* Summary Cards - Horizontal */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
                            <div className="setting-item epg-grid-item" style={{
                                background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05))',
                                border: '1px solid rgba(34, 197, 94, 0.3)',
                                padding: '18px',
                                flexDirection: 'row',
                                justifyContent: 'flex-start',
                                gap: '14px',
                                alignItems: 'center'
                            }}>
                                <div style={{
                                    fontSize: '28px',
                                    width: '48px',
                                    height: '48px',
                                    background: 'rgba(34, 197, 94, 0.2)',
                                    borderRadius: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>✅</div>
                                <div>
                                    <div style={{ fontSize: '28px', fontWeight: 800, color: '#22c55e' }}>
                                        {epgTestResults.working.length}
                                    </div>
                                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>{t('epg', 'workingLabel')}</div>
                                </div>
                            </div>
                            <div className="setting-item epg-grid-item" style={{
                                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05))',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                padding: '18px',
                                flexDirection: 'row',
                                justifyContent: 'flex-start',
                                gap: '14px',
                                alignItems: 'center'
                            }}>
                                <div style={{
                                    fontSize: '28px',
                                    width: '48px',
                                    height: '48px',
                                    background: 'rgba(239, 68, 68, 0.2)',
                                    borderRadius: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>❌</div>
                                <div>
                                    <div style={{ fontSize: '28px', fontWeight: 800, color: '#ef4444' }}>
                                        {epgTestResults.notWorking.length}
                                    </div>
                                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>{t('epg', 'noDataLabel')}</div>
                                </div>
                            </div>
                        </div>

                        {/* Country Counts Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px' }}>
                            {[
                                { code: 'BR', flag: '🇧🇷', label: 'Brasil', color: '#22c55e' },
                                { code: 'ARG', flag: '🇦🇷', label: 'Argentina', color: '#60a5fa' },
                                { code: 'US', flag: '🇺🇸', label: 'EUA', color: '#f59e0b' },
                                { code: 'PT', flag: '🇵🇹', label: 'Portugal', color: '#ef4444' }
                            ].map(({ code, flag, label, color }) => {
                                const count = [...epgTestResults.working, ...epgTestResults.notWorking]
                                    .filter(c => c.country === code).length;
                                return (
                                    <div key={code} className="setting-item epg-country-card" style={{
                                        padding: '16px 12px',
                                        background: `rgba(${color === '#22c55e' ? '34, 197, 94' : color === '#60a5fa' ? '96, 165, 250' : color === '#f59e0b' ? '245, 158, 11' : '239, 68, 68'}, 0.08)`,
                                        border: `1px solid rgba(${color === '#22c55e' ? '34, 197, 94' : color === '#60a5fa' ? '96, 165, 250' : color === '#f59e0b' ? '245, 158, 11' : '239, 68, 68'}, 0.2)`,
                                        justifyContent: 'center'
                                    }}
                                        onClick={() => setEpgCountryFilter(code as EpgCountryFilter)}
                                    >
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: '24px', marginBottom: '4px' }}>{flag}</div>
                                            <div style={{ fontSize: '20px', fontWeight: 800, color }}>
                                                {count}
                                            </div>
                                            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px' }}>
                                                {label}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Filters - Reorganized */}
                        <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '14px', marginBottom: '16px' }}>
                            {/* Row 1: Status Filters + Search */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px', alignItems: 'center' }}>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    {(['all', 'working', 'notWorking'] as const).map((filter) => (
                                        <button
                                            key={filter}
                                            className="epg-filter-btn"
                                            onClick={() => { setEpgResultsFilter(filter); setEpgCurrentPage(1); }}
                                            style={{
                                                padding: '8px 14px',
                                                borderRadius: '8px',
                                                border: epgResultsFilter === filter ? '2px solid #818cf8' : '1px solid rgba(255,255,255,0.1)',
                                                cursor: 'pointer',
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                background: epgResultsFilter === filter ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                                                color: epgResultsFilter === filter ? '#a5b4fc' : 'rgba(255,255,255,0.6)'
                                            }}
                                        >
                                            {filter === 'all' ? '📺 Todos' : filter === 'working' ? '✅' : '❌'}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    placeholder="🔍 Buscar canal..."
                                    value={epgSearchTerm}
                                    onChange={(e) => { setEpgSearchTerm(e.target.value); setEpgCurrentPage(1); }}
                                    className="setting-select"
                                    style={{ padding: '10px 14px', fontSize: '13px' }}
                                />
                            </div>

                            {/* Row 2: Country Filters */}
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {(['all', 'BR', 'ARG', 'US', 'PT'] as const).map((country) => {
                                    const icons: Record<string, string> = { all: '🌍', BR: '🇧🇷', ARG: '🇦🇷', US: '🇺🇸', PT: '🇵🇹' };
                                    const labels: Record<string, string> = { all: 'Todos', BR: 'BR', ARG: 'ARG', US: 'US', PT: 'PT' };
                                    return (
                                        <button
                                            key={country}
                                            className="epg-filter-btn"
                                            onClick={() => { setEpgCountryFilter(country); setEpgCurrentPage(1); }}
                                            style={{
                                                padding: '6px 12px',
                                                borderRadius: '8px',
                                                border: epgCountryFilter === country ? '2px solid #06b6d4' : '1px solid rgba(255,255,255,0.1)',
                                                cursor: 'pointer',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                background: epgCountryFilter === country ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255,255,255,0.05)',
                                                color: epgCountryFilter === country ? '#67e8f9' : 'rgba(255,255,255,0.6)'
                                            }}
                                        >
                                            {icons[country]} {labels[country]}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Channel List with Pagination */}
                        {(() => {
                            const filteredItems = [
                                ...epgTestResults.working.map((w): EpgWorkingItem => ({ ...w, type: 'working' })),
                                ...epgTestResults.notWorking.map((n): EpgNotWorkingItem => ({ ...n, type: 'notWorking' }))
                            ]
                                .filter(item =>
                                    (epgResultsFilter === 'all' || item.type === epgResultsFilter) &&
                                    (epgCountryFilter === 'all' || item.country === epgCountryFilter) &&
                                    (epgSearchTerm === '' || item.channel.toLowerCase().includes(epgSearchTerm.toLowerCase()))
                                );

                            const totalPages = Math.ceil(filteredItems.length / EPG_ITEMS_PER_PAGE);
                            const currentPage = Math.min(epgCurrentPage, totalPages || 1);
                            const startIndex = (currentPage - 1) * EPG_ITEMS_PER_PAGE;
                            const endIndex = startIndex + EPG_ITEMS_PER_PAGE;
                            const displayedItems = filteredItems.slice(startIndex, endIndex);

                            return (
                                <>
                                    {/* Counter Header with Pagination Info */}
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: '10px',
                                        paddingBottom: '10px',
                                        borderBottom: '1px solid rgba(255,255,255,0.1)'
                                    }}>
                                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
                                            📋 {t('epg', 'showing')} <strong style={{ color: 'white' }}>{startIndex + 1}-{Math.min(endIndex, filteredItems.length)}</strong> {t('epg', 'of')} <strong style={{ color: 'white' }}>{filteredItems.length}</strong> {t('epg', 'channelsCount')}
                                        </span>
                                        {totalPages > 1 && (
                                            <span style={{ color: '#06b6d4', fontSize: '11px', fontWeight: 600 }}>
                                                📄 {currentPage} / {totalPages}
                                            </span>
                                        )}
                                    </div>

                                    {/* List */}
                                    <div style={{
                                        maxHeight: '350px',
                                        overflowY: 'auto',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '8px',
                                        paddingRight: '8px'
                                    }}>
                                        {displayedItems.map((item, i) => (
                                            <div key={startIndex + i} className="setting-item epg-channel-item" style={{
                                                padding: '14px 16px',
                                                background: item.type === 'working'
                                                    ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(34, 197, 94, 0.02))'
                                                    : 'linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(239, 68, 68, 0.02))',
                                                border: `1px solid ${item.type === 'working' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)'}`,
                                                flexDirection: 'column',
                                                alignItems: 'stretch',
                                                gap: '8px'
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ color: 'white', fontWeight: 600, fontSize: '14px' }}>{item.channel}</span>
                                                    <span style={{
                                                        color: item.type === 'working' ? '#22c55e' : '#ef4444',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        background: item.type === 'working' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                                        padding: '4px 10px',
                                                        borderRadius: '6px'
                                                    }}>
                                                        {item.type === 'working' ? `${item.programCount} prog` : item.reason}
                                                    </span>
                                                </div>
                                                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px' }}>
                                                    <span style={{ color: '#06b6d4' }}>{item.source}</span>
                                                    <span style={{ margin: '0 6px' }}>•</span>
                                                    <code style={{ color: 'var(--ns-accent-light)', background: 'rgba(var(--ns-accent-rgb), 0.1)', padding: '2px 5px', borderRadius: '3px', fontSize: '10px' }}>{item.epgId}</code>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Pagination Controls */}
                                    {totalPages > 1 && (
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                            gap: '12px',
                                            marginTop: '16px',
                                            paddingTop: '12px',
                                            borderTop: '1px solid rgba(255,255,255,0.1)'
                                        }}>
                                            <button
                                                className="epg-page-btn"
                                                onClick={() => setEpgCurrentPage(1)}
                                                disabled={currentPage === 1}
                                                style={{
                                                    padding: '8px 12px',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    background: currentPage === 1 ? 'rgba(255,255,255,0.05)' : 'rgba(6, 182, 212, 0.2)',
                                                    color: currentPage === 1 ? 'rgba(255,255,255,0.3)' : '#67e8f9',
                                                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                                    fontWeight: 600,
                                                    fontSize: '12px',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >⏮️</button>
                                            <button
                                                className="epg-page-btn"
                                                onClick={() => setEpgCurrentPage(p => Math.max(1, p - 1))}
                                                disabled={currentPage === 1}
                                                style={{
                                                    padding: '8px 16px',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    background: currentPage === 1 ? 'rgba(255,255,255,0.05)' : 'rgba(6, 182, 212, 0.2)',
                                                    color: currentPage === 1 ? 'rgba(255,255,255,0.3)' : '#67e8f9',
                                                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                                    fontWeight: 600,
                                                    fontSize: '12px',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >◀ {t('epg', 'previous')}</button>
                                            <span className="epg-page-indicator" style={{
                                                color: 'white',
                                                fontWeight: 700,
                                                fontSize: '14px',
                                                padding: '8px 16px',
                                                background: 'rgba(99, 102, 241, 0.2)',
                                                borderRadius: '8px'
                                            }}>
                                                {currentPage} / {totalPages}
                                            </span>
                                            <button
                                                className="epg-page-btn"
                                                onClick={() => setEpgCurrentPage(p => Math.min(totalPages, p + 1))}
                                                disabled={currentPage === totalPages}
                                                style={{
                                                    padding: '8px 16px',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    background: currentPage === totalPages ? 'rgba(255,255,255,0.05)' : 'rgba(6, 182, 212, 0.2)',
                                                    color: currentPage === totalPages ? 'rgba(255,255,255,0.3)' : '#67e8f9',
                                                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                                    fontWeight: 600,
                                                    fontSize: '12px',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >{t('epg', 'next')} ▶</button>
                                            <button
                                                className="epg-page-btn"
                                                onClick={() => setEpgCurrentPage(totalPages)}
                                                disabled={currentPage === totalPages}
                                                style={{
                                                    padding: '8px 12px',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    background: currentPage === totalPages ? 'rgba(255,255,255,0.05)' : 'rgba(6, 182, 212, 0.2)',
                                                    color: currentPage === totalPages ? 'rgba(255,255,255,0.3)' : '#67e8f9',
                                                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                                    fontWeight: 600,
                                                    fontSize: '12px',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >⏭️</button>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
}
