import { useEffect, useState } from 'react';
import { useLanguage } from '../../services/languageService';
import { collectBackup, applyBackup, encodePlaylistPassword, decodePlaylistPassword, type BackupPlaylist } from '../../services/backupService';
import { useSaveAnimation } from './useSaveAnimation';

interface BackupFileResult {
    success: boolean;
    canceled?: boolean;
    path?: string;
    json?: string;
    error?: string;
}

export function BackupSection() {
    const { t } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [pendingImportJson, setPendingImportJson] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Auto-backup config (lives in the main process store)
    const [autoBackup, setAutoBackup] = useState<{ enabled: boolean; dirPath: string; lastBackupAt: number } | null>(null);

    useEffect(() => {
        let cancelled = false;
        window.ipcRenderer.invoke('backup:auto-config-get')
            .then((result: { success: boolean; config?: { enabled: boolean; dirPath: string; lastBackupAt: number } }) => {
                if (!cancelled && result?.success && result.config) setAutoBackup(result.config);
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, []);

    const handleAutoBackupToggle = async (enabled: boolean) => {
        if (enabled && !autoBackup?.dirPath) {
            const picked = await window.ipcRenderer.invoke('backup:choose-dir') as { success: boolean; config?: { enabled: boolean; dirPath: string; lastBackupAt: number } };
            if (!picked.success || !picked.config) return; // canceled
            setAutoBackup(picked.config);
        }
        const result = await window.ipcRenderer.invoke('backup:auto-config-set', { enabled }) as { success: boolean; config?: { enabled: boolean; dirPath: string; lastBackupAt: number } };
        if (result.success && result.config) setAutoBackup(result.config);
    };

    const handleExport = async () => {
        setErrorMessage(null);
        setSuccessMessage(null);
        setBusy(true);
        try {
            // Saved playlists come from the main-process store; passwords are
            // base64-encoded before touching the file.
            let playlists: BackupPlaylist[] = [];
            try {
                const exported = await window.ipcRenderer.invoke('backup:export-playlists') as {
                    success: boolean;
                    playlists?: { name: string; url: string; username: string; password: string }[];
                };
                if (exported.success && exported.playlists) {
                    playlists = exported.playlists.map(p => ({
                        name: p.name,
                        url: p.url,
                        username: p.username,
                        passwordB64: encodePlaylistPassword(p.password)
                    }));
                }
            } catch { /* main handler absent in old builds — export without playlists */ }

            const payload = collectBackup(playlists);
            const result = await window.ipcRenderer.invoke(
                'backup:save-file',
                { json: JSON.stringify(payload, null, 2) }
            ) as BackupFileResult;

            if (result.success) {
                triggerSaveAnimation('export');
            } else if (!result.canceled) {
                setErrorMessage(t('backup', 'exportError'));
            }
        } catch (error) {
            console.error('[Backup] Export failed:', error);
            setErrorMessage(t('backup', 'exportError'));
        } finally {
            setBusy(false);
        }
    };

    const handleImportClick = async () => {
        setErrorMessage(null);
        setSuccessMessage(null);
        setBusy(true);
        try {
            const result = await window.ipcRenderer.invoke('backup:load-file') as BackupFileResult;
            if (result.success && result.json) {
                // Ask for confirmation before overwriting current data
                setPendingImportJson(result.json);
            } else if (!result.canceled) {
                setErrorMessage(t('backup', 'importError'));
            }
        } catch (error) {
            console.error('[Backup] Load failed:', error);
            setErrorMessage(t('backup', 'importError'));
        } finally {
            setBusy(false);
        }
    };

    const handleConfirmImport = async () => {
        if (!pendingImportJson) return;

        try {
            const parsed: unknown = JSON.parse(pendingImportJson);
            const report = applyBackup(parsed);

            // v2 backups also carry saved playlists — restored in the main store.
            if (report.playlists.length > 0) {
                try {
                    await window.ipcRenderer.invoke('backup:import-playlists', {
                        playlists: report.playlists.map(p => ({
                            name: p.name,
                            url: p.url,
                            username: p.username,
                            password: decodePlaylistPassword(p.passwordB64)
                        }))
                    });
                } catch (error) {
                    console.error('[Backup] Playlist import failed:', error);
                }
            }

            setSuccessMessage(t('backup', 'importSuccess'));
        } catch (error) {
            console.error('[Backup] Apply failed:', error);
            setErrorMessage(t('backup', 'invalidFile'));
        } finally {
            setPendingImportJson(null);
        }
    };

    return (
        <div className="section-card">
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, #64748b, #475569)' }}>💾</div>
                <div>
                    <h2>{t('backup', 'title')}</h2>
                    <p>{t('backup', 'description')}</p>
                </div>
            </div>

            <div className="settings-group">
                {/* Export */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('backup', 'exportTitle')}</label>
                        <p>{t('backup', 'exportDesc')}</p>
                    </div>
                    <button
                        className="check-btn"
                        style={{ width: 'auto', padding: '14px 24px' }}
                        onClick={handleExport}
                        disabled={busy}
                    >
                        <span>📤</span>
                        <span>{t('backup', 'exportButton')}</span>
                    </button>
                    {saveAnimation === 'export' && (
                        <span className="save-indicator">{t('backup', 'exported')}</span>
                    )}
                </div>

                {/* Import */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('backup', 'importTitle')}</label>
                        <p>{t('backup', 'importDesc')}</p>
                    </div>
                    <button
                        className="check-btn"
                        style={{ width: 'auto', padding: '14px 24px' }}
                        onClick={handleImportClick}
                        disabled={busy}
                    >
                        <span>📥</span>
                        <span>{t('backup', 'importButton')}</span>
                    </button>
                </div>

                {/* Scheduled automatic backup */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>🗓️ {t('backup', 'autoTitle')}</label>
                        <p>
                            {t('backup', 'autoDesc')}
                            {autoBackup?.dirPath ? ` · ${autoBackup.dirPath}` : ''}
                            {autoBackup?.lastBackupAt
                                ? ` · ${t('backup', 'autoLast')}: ${new Date(autoBackup.lastBackupAt).toLocaleDateString()}`
                                : ''}
                        </p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={autoBackup?.enabled ?? false}
                            onChange={(e) => void handleAutoBackupToggle(e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {/* Credentials are not part of the backup */}
                <div className="certificate-warning">
                    {t('backup', 'credentialsNote')}
                </div>

                {errorMessage && (
                    <div className="certificate-warning" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.12)' }}>
                        ⚠️ {errorMessage}
                    </div>
                )}

                {successMessage && (
                    <div className="last-check">
                        <span className="check-icon">✅</span>
                        <span>{successMessage}</span>
                    </div>
                )}
            </div>

            {/* Import confirmation modal */}
            {pendingImportJson && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0, 0, 0, 0.85)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10001
                    }}
                    onClick={() => setPendingImportJson(null)}
                >
                    <div
                        style={{
                            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                            borderRadius: 24,
                            padding: 32,
                            maxWidth: 480,
                            width: '90%',
                            border: '1px solid rgba(var(--ns-accent-rgb), 0.2)',
                            boxShadow: '0 25px 80px rgba(0, 0, 0, 0.5)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ textAlign: 'center', marginBottom: 24 }}>
                            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>⚠️</span>
                            <h2 style={{ color: 'white', fontSize: 24, fontWeight: 700, margin: 0 }}>
                                {t('backup', 'confirmImportTitle')}
                            </h2>
                        </div>

                        <p style={{ color: '#9ca3af', textAlign: 'center', lineHeight: 1.6, marginBottom: 28 }}>
                            {t('backup', 'confirmImportMessage')}
                        </p>

                        <div style={{ display: 'flex', gap: 12 }}>
                            <button
                                style={{
                                    flex: 1,
                                    padding: '14px 20px',
                                    borderRadius: 12,
                                    fontSize: 15,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: '2px solid rgba(255, 255, 255, 0.2)',
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    color: 'rgba(255, 255, 255, 0.8)'
                                }}
                                onClick={() => setPendingImportJson(null)}
                            >
                                {t('backup', 'confirmImportCancel')}
                            </button>
                            <button
                                style={{
                                    flex: 1,
                                    padding: '14px 20px',
                                    borderRadius: 12,
                                    fontSize: 15,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: 'none',
                                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                    color: 'white',
                                    boxShadow: '0 8px 24px rgba(239, 68, 68, 0.3)'
                                }}
                                onClick={() => void handleConfirmImport()}
                            >
                                {t('backup', 'confirmImportConfirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
