import { useState } from 'react';
import { useLanguage } from '../../services/languageService';
import { diagnosticsService } from '../../services/diagnosticsService';
import { classifyLatency, overallStatus, LATENCY_COLORS, type ProbeResult } from '../../utils/providerHealth';

interface ExportReportResult {
    success: boolean;
    canceled?: boolean;
    path?: string;
    error?: string;
}

export function DiagnosticsSection() {
    const { t } = useLanguage();
    const [enabled, setEnabled] = useState<boolean>(diagnosticsService.isEnabled());
    const [busy, setBusy] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const handleToggle = (value: boolean) => {
        setEnabled(value);
        diagnosticsService.setEnabled(value);
    };

    const handleExport = async () => {
        setErrorMessage(null);
        setSuccessMessage(null);
        setBusy(true);
        try {
            // Detailed breadcrumbs are only included when the user opted in.
            const breadcrumbs = diagnosticsService.isEnabled()
                ? diagnosticsService.formatBreadcrumbs()
                : undefined;

            const result = await window.ipcRenderer.invoke(
                'diagnostics:export-report',
                { breadcrumbs }
            ) as ExportReportResult;

            if (result.success) {
                setSuccessMessage(`${t('diagnostics', 'exported')}${result.path ? `\n${result.path}` : ''}`);
            } else if (result.canceled) {
                setSuccessMessage(t('diagnostics', 'exportCanceled'));
            } else {
                setErrorMessage(t('diagnostics', 'exportError'));
            }
        } catch (error) {
            console.error('[Diagnostics] Export failed:', error);
            setErrorMessage(t('diagnostics', 'exportError'));
        } finally {
            setBusy(false);
        }
    };

    // Provider health probe (endpoints + latency, measured in the main process)
    const [healthResults, setHealthResults] = useState<ProbeResult[] | null>(null);
    const [healthBusy, setHealthBusy] = useState(false);
    const [healthError, setHealthError] = useState<string | null>(null);

    const handleHealthCheck = async () => {
        setHealthBusy(true);
        setHealthError(null);
        try {
            const result = await window.ipcRenderer.invoke('diagnostics:provider-health') as {
                success: boolean; results?: ProbeResult[]; error?: string;
            };
            if (result.success && result.results) {
                setHealthResults(result.results);
            } else {
                setHealthError(t('diagnostics', 'healthError'));
            }
        } catch (error) {
            console.error('[Diagnostics] Health check failed:', error);
            setHealthError(t('diagnostics', 'healthError'));
        } finally {
            setHealthBusy(false);
        }
    };

    // 🚀 Velocímetro: mesmo canal do health check, com { speedTest: true }.
    const [speedBusy, setSpeedBusy] = useState(false);
    const [speedResult, setSpeedResult] = useState<{ mbps: number; bytes: number; seconds: number } | null>(null);
    const [speedError, setSpeedError] = useState<string | null>(null);

    const handleSpeedTest = async () => {
        setSpeedBusy(true);
        setSpeedError(null);
        try {
            const result = await window.ipcRenderer.invoke('diagnostics:provider-health', { speedTest: true }) as {
                success: boolean; speed?: { mbps: number; bytes: number; seconds: number } | null;
            };
            if (result.success && result.speed) {
                setSpeedResult(result.speed);
            } else {
                setSpeedResult(null);
                setSpeedError(t('diagnostics', 'speedError'));
            }
        } catch (error) {
            console.error('[Diagnostics] Speed test failed:', error);
            setSpeedError(t('diagnostics', 'speedError'));
        } finally {
            setSpeedBusy(false);
        }
    };

    const ENDPOINT_LABELS: Record<string, string> = {
        player_api: 'API (player_api.php)',
        live_streams: t('diagnostics', 'healthChannels'),
        xmltv: 'EPG (xmltv.php)',
        m3u_download: t('diagnostics', 'healthM3uDownload'),
        m3u_parse: t('diagnostics', 'healthM3uParse'),
        stalker_handshake: t('diagnostics', 'healthStalkerHandshake'),
        stalker_channels: t('diagnostics', 'healthStalkerChannels')
    };

    // Storage overview (sizes measured in the main process)
    interface StorageRow { area: string; bytes: number }
    const [storageRows, setStorageRows] = useState<StorageRow[] | null>(null);
    const [storageBusy, setStorageBusy] = useState(false);

    const loadStorage = async () => {
        setStorageBusy(true);
        try {
            const result = await window.ipcRenderer.invoke('storage:usage') as { success: boolean; areas?: StorageRow[] };
            if (result.success && result.areas) setStorageRows(result.areas);
        } catch { /* handler absent in old builds */ }
        setStorageBusy(false);
    };

    const clearCache = async (area: string) => {
        await window.ipcRenderer.invoke('storage:clear-cache', { area }).catch(() => undefined);
        await loadStorage();
    };

    const formatBytes = (bytes: number) => {
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const STORAGE_LABELS: Record<string, { label: string; clearable: boolean }> = {
        downloads: { label: t('storage', 'downloads'), clearable: false },
        recordings: { label: t('storage', 'recordings'), clearable: false },
        catalogCache: { label: t('storage', 'catalogCache'), clearable: true },
        epgCache: { label: t('storage', 'epgCache'), clearable: true }
    };

    const handleOpenLogs = async () => {
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            const result = await window.ipcRenderer.invoke('diagnostics:open-logs') as { success: boolean };
            if (!result.success) {
                setErrorMessage(t('diagnostics', 'openLogsError'));
            }
        } catch (error) {
            console.error('[Diagnostics] Open logs failed:', error);
            setErrorMessage(t('diagnostics', 'openLogsError'));
        }
    };

    return (
        <div className="section-card">
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, #ec4899, #db2777)' }}>🩺</div>
                <div>
                    <h2>{t('diagnostics', 'title')}</h2>
                    <p>{t('diagnostics', 'description')}</p>
                </div>
            </div>

            <div className="settings-group">
                {/* Detailed diagnostics opt-in */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('diagnostics', 'enableDetailed')}</label>
                        <p>{t('diagnostics', 'enableDetailedDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => handleToggle(e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                <div className="certificate-warning">
                    {t('diagnostics', 'note')}
                </div>

                {/* Export report */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('diagnostics', 'exportReport')}</label>
                        <p>{t('diagnostics', 'exportReportDesc')}</p>
                    </div>
                    <button
                        className="check-btn"
                        style={{ width: 'auto', padding: '14px 24px' }}
                        onClick={handleExport}
                        disabled={busy}
                    >
                        <span>📄</span>
                        <span>{t('diagnostics', 'exportReport')}</span>
                    </button>
                </div>

                {/* Open logs folder */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('diagnostics', 'openLogs')}</label>
                        <p>{t('diagnostics', 'openLogsDesc')}</p>
                    </div>
                    <button
                        className="about-link"
                        style={{ whiteSpace: 'nowrap' }}
                        onClick={handleOpenLogs}
                    >
                        📂 {t('diagnostics', 'openLogs')}
                    </button>
                </div>

                {/* Provider health */}
                <div className="setting-item" style={{ alignItems: 'flex-start' }}>
                    <div className="setting-info">
                        <label>{t('diagnostics', 'healthTitle')}</label>
                        <p>{t('diagnostics', 'healthDesc')}</p>
                        {healthResults && (
                            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ fontWeight: 700, fontSize: 13, color: overallStatus(healthResults) === 'online' ? '#10b981' : overallStatus(healthResults) === 'degraded' ? '#f59e0b' : '#ef4444' }}>
                                    {overallStatus(healthResults) === 'online' ? `✅ ${t('diagnostics', 'healthOnline')}`
                                        : overallStatus(healthResults) === 'degraded' ? `⚠️ ${t('diagnostics', 'healthDegraded')}`
                                        : `❌ ${t('diagnostics', 'healthOffline')}`}
                                </div>
                                {healthResults.map(result => (
                                    <div key={result.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: result.ok ? LATENCY_COLORS[classifyLatency(result.ms)] : '#ef4444' }} />
                                        <span style={{ color: 'rgba(255,255,255,0.8)', minWidth: 180 }}>{ENDPOINT_LABELS[result.name] || result.name}</span>
                                        <span style={{ color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>
                                            {result.ok ? `${result.ms} ms` : (result.error || `HTTP ${result.status ?? '—'}`)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {healthError && (
                            <p style={{ color: '#ef4444', marginTop: 8 }}>⚠️ {healthError}</p>
                        )}
                    </div>
                    <button
                        className="check-btn"
                        style={{ width: 'auto', padding: '14px 24px' }}
                        onClick={handleHealthCheck}
                        disabled={healthBusy}
                    >
                        <span>{healthBusy ? '⏳' : '📡'}</span>
                        <span>{healthBusy ? t('diagnostics', 'healthTesting') : t('diagnostics', 'healthTest')}</span>
                    </button>
                </div>

                {/* 🚀 Velocímetro do provedor */}
                <div className="setting-item" style={{ alignItems: 'flex-start' }}>
                    <div className="setting-info">
                        <label>🚀 {t('diagnostics', 'speedTitle')}</label>
                        <p>{t('diagnostics', 'speedDesc')}</p>
                        {speedResult && (
                            <p style={{
                                marginTop: 8, fontWeight: 700, fontSize: 15,
                                color: speedResult.mbps >= 25 ? '#10b981' : speedResult.mbps >= 8 ? '#f59e0b' : '#ef4444'
                            }}>
                                {speedResult.mbps.toFixed(1)} Mbps
                                <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 400, fontSize: 13 }}>
                                    {' '}· {(speedResult.bytes / (1024 * 1024)).toFixed(1)} MB / {speedResult.seconds.toFixed(1)}s
                                </span>
                            </p>
                        )}
                        {speedError && (
                            <p style={{ color: '#ef4444', marginTop: 8 }}>⚠️ {speedError}</p>
                        )}
                    </div>
                    <button
                        className="check-btn"
                        style={{ width: 'auto', padding: '14px 24px' }}
                        onClick={handleSpeedTest}
                        disabled={speedBusy}
                    >
                        <span>{speedBusy ? '⏳' : '🚀'}</span>
                        <span>{speedBusy ? t('diagnostics', 'speedTesting') : t('diagnostics', 'speedTest')}</span>
                    </button>
                </div>

                {/* Storage overview */}
                <div className="setting-item" style={{ alignItems: 'flex-start' }}>
                    <div className="setting-info">
                        <label>💽 {t('storage', 'title')}</label>
                        <p>{t('storage', 'description')}</p>
                        {storageRows && (
                            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {storageRows.map(row => (
                                    <div key={row.area} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                                        <span style={{ color: 'rgba(255,255,255,0.8)', minWidth: 190 }}>
                                            {STORAGE_LABELS[row.area]?.label ?? row.area}
                                        </span>
                                        <span style={{ color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums', minWidth: 80 }}>
                                            {formatBytes(row.bytes)}
                                        </span>
                                        <button
                                            onClick={() => void window.ipcRenderer.invoke('storage:open-area', { area: row.area })}
                                            style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 11, cursor: 'pointer' }}
                                        >
                                            📂
                                        </button>
                                        {STORAGE_LABELS[row.area]?.clearable && row.bytes > 0 && (
                                            <button
                                                onClick={() => void clearCache(row.area)}
                                                style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                                            >
                                                {t('storage', 'clear')}
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <button
                        className="check-btn"
                        style={{ width: 'auto', padding: '14px 24px' }}
                        onClick={() => void loadStorage()}
                        disabled={storageBusy}
                    >
                        <span>{storageBusy ? '⏳' : '💽'}</span>
                        <span>{storageRows ? t('storage', 'refresh') : t('storage', 'measure')}</span>
                    </button>
                </div>

                {errorMessage && (
                    <div className="certificate-warning" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.12)' }}>
                        ⚠️ {errorMessage}
                    </div>
                )}

                {successMessage && (
                    <div className="last-check" style={{ whiteSpace: 'pre-line' }}>
                        <span className="check-icon">✅</span>
                        <span>{successMessage}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
