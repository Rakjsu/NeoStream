import { useState } from 'react';
import { useLanguage } from '../../services/languageService';
import { diagnosticsService } from '../../services/diagnosticsService';

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
