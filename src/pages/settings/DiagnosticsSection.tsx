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

    const ENDPOINT_LABELS: Record<string, string> = {
        player_api: 'API (player_api.php)',
        live_streams: t('diagnostics', 'healthChannels'),
        xmltv: 'EPG (xmltv.php)'
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
