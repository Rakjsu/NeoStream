import { useEffect, useState } from 'react';
import { updateService } from '../../services/updateService';
import { showUpToDateModal } from '../../components/updateNotificationBus';
import type { UpdateConfig } from '../../types/update';
import { useLanguage, type SupportedLanguage } from '../../services/languageService';
import { useSaveAnimation } from './useSaveAnimation';

interface UpdatesSectionProps {
    checking: boolean;
    setChecking: (checking: boolean) => void;
}

export function UpdatesSection({ checking, setChecking }: UpdatesSectionProps) {
    const [updateConfig, setUpdateConfig] = useState<UpdateConfig>({
        checkFrequency: 'on-open',
        autoInstall: false,
        lastCheck: 0
    });
    const [lastCheckDate, setLastCheckDate] = useState<string>('');
    // System behavior (tray + autostart) lives in the MAIN process store.
    const [systemConfig, setSystemConfig] = useState<{ closeToTray: boolean; openAtLogin: boolean }>({ closeToTray: true, openAtLogin: false });
    const { language, setLanguage, t, languages } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();

    const loadUpdateConfig = async () => {
        const config = await updateService.getConfig();
        setUpdateConfig(config);

        if (config.lastCheck) {
            const date = new Date(config.lastCheck);
            setLastCheckDate(date.toLocaleString('pt-BR'));
        }
    };

    useEffect(() => {
        loadUpdateConfig();
        window.ipcRenderer.invoke('system:get-config').then(result => {
            if (result?.success && result.config) setSystemConfig(result.config);
        }).catch(() => { /* main handler absent in old builds */ });
    }, []);

    const handleSystemConfigChange = async (key: 'closeToTray' | 'openAtLogin', value: boolean) => {
        const next = { ...systemConfig, [key]: value };
        setSystemConfig(next);
        await window.ipcRenderer.invoke('system:set-config', { [key]: value }).catch(() => undefined);
        triggerSaveAnimation(key);
    };

    const handleUpdateConfigChange = async <K extends keyof UpdateConfig>(key: K, value: UpdateConfig[K]) => {
        const newConfig = { ...updateConfig, [key]: value };
        setUpdateConfig(newConfig);
        await updateService.setConfig(newConfig);

        // Show save animation
        triggerSaveAnimation(key);
    };

    const handleCheckNow = async () => {
        setChecking(true);
        try {
            // This will trigger update:available event if update exists
            // If no update, we show the "up to date" modal manually
            const result = await updateService.checkForUpdates();
            if (!result.updateAvailable) {
                showUpToDateModal();
            }
            // If update is available, the UpdateNotification will show automatically
            await loadUpdateConfig();
        } catch (error) {
            console.error('Error checking for updates:', error);
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="section-card">
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>🔄</div>
                <div>
                    <h2>{t('updates', 'title')}</h2>
                    <p>{t('updates', 'description')}</p>
                </div>
            </div>

            <div className="settings-group">
                {/* Check Frequency */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('updates', 'checkFrequency')}</label>
                        <p>{t('updates', 'checkFrequencyDesc')}</p>
                    </div>
                    <select
                        className="setting-select"
                        value={updateConfig.checkFrequency}
                        onChange={(e) => handleUpdateConfigChange('checkFrequency', e.target.value as UpdateConfig['checkFrequency'])}
                    >
                        <option value="on-open">{t('updates', 'onOpen')}</option>
                        <option value="1-day">{t('updates', 'daily')}</option>
                        <option value="1-week">{t('updates', 'weekly')}</option>
                        <option value="1-month">{t('updates', 'monthly')}</option>
                    </select>
                </div>

                {/* Auto Install Toggle */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('updates', 'autoInstall')}</label>
                        <p>{t('updates', 'autoInstallDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={updateConfig.autoInstall}
                            onChange={(e) => handleUpdateConfigChange('autoInstall', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                    {saveAnimation === 'autoInstall' && (
                        <span className="save-indicator">✓ Salvo</span>
                    )}
                </div>

                {/* System: close to tray */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('updates', 'closeToTray')}</label>
                        <p>{t('updates', 'closeToTrayDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={systemConfig.closeToTray}
                            onChange={(e) => handleSystemConfigChange('closeToTray', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                    {saveAnimation === 'closeToTray' && (
                        <span className="save-indicator">✓ Salvo</span>
                    )}
                </div>

                {/* System: start with Windows */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('updates', 'openAtLogin')}</label>
                        <p>{t('updates', 'openAtLoginDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={systemConfig.openAtLogin}
                            onChange={(e) => handleSystemConfigChange('openAtLogin', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                    {saveAnimation === 'openAtLogin' && (
                        <span className="save-indicator">✓ Salvo</span>
                    )}
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('updates', 'language')}</label>
                        <p>{t('updates', 'languageDesc')}</p>
                    </div>
                    <select
                        className="setting-select"
                        value={language}
                        onChange={(e) => {
                            setLanguage(e.target.value as SupportedLanguage);
                            triggerSaveAnimation('language');
                        }}
                    >
                        {languages.map(lang => (
                            <option key={lang.code} value={lang.code}>
                                {lang.flag} {lang.name}
                            </option>
                        ))}
                    </select>
                    {saveAnimation === 'language' && (
                        <span className="save-indicator">{t('settings', 'saved')}</span>
                    )}
                </div>

                {/* Last Check */}
                {lastCheckDate && (
                    <div className="last-check">
                        <span className="check-icon">🕐</span>
                        <span>Última verificação: <strong>{lastCheckDate}</strong></span>
                    </div>
                )}

                {/* Check Now Button */}
                <button
                    className={`check-btn ${checking ? 'checking' : ''}`}
                    onClick={handleCheckNow}
                    disabled={checking}
                >
                    {checking ? (
                        <>
                            <span className="spinner"></span>
                            <span>Verificando...</span>
                        </>
                    ) : (
                        <>
                            <span>🔍</span>
                            <span>Verificar Atualizações Agora</span>
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
