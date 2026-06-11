import { useEffect, useState } from 'react';
import { useLanguage } from '../../services/languageService';
import { useSaveAnimation } from './useSaveAnimation';

export function NetworkSection() {
    const [allowInvalidProviderCertificates, setAllowInvalidProviderCertificates] = useState(true);
    const { t } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();

    useEffect(() => {
        (async () => {
            try {
                const result = await window.ipcRenderer.invoke('security:get-certificate-settings');
                if (result.success && result.settings) {
                    setAllowInvalidProviderCertificates(Boolean(result.settings.allowInvalidProviderCertificates));
                }
            } catch (error) {
                console.error('Failed to load certificate settings:', error);
            }
        })();
    }, []);

    const handleAllowInvalidProviderCertificatesChange = async (value: boolean) => {
        setAllowInvalidProviderCertificates(value);
        try {
            const result = await window.ipcRenderer.invoke('security:set-allow-invalid-provider-certificates', value);
            if (result.success && result.settings) {
                setAllowInvalidProviderCertificates(Boolean(result.settings.allowInvalidProviderCertificates));
            }
            triggerSaveAnimation('allowInvalidProviderCertificates');
        } catch (error) {
            console.error('Failed to save certificate settings:', error);
            setAllowInvalidProviderCertificates(prev => !prev);
        }
    };

    return (
        <div className="section-card">
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, #14b8a6, #0f766e)' }}>🔐</div>
                <div>
                    <h2>Rede e certificados</h2>
                    <p>Controle de compatibilidade para provedores IPTV com TLS ou CORS antigo ou mal configurado.</p>
                </div>
            </div>

            <div className="settings-group">
                <div className="setting-item">
                    <div className="setting-info">
                        <label>Modo compatível com certificados inválidos</label>
                        <p>Permite certificados inválidos e compatibilidade CORS somente para o provedor IPTV configurado e subdomínios relacionados. Útil para provedores antigos, mas reduz a segurança dessa conexão.</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={allowInvalidProviderCertificates}
                            onChange={(e) => handleAllowInvalidProviderCertificatesChange(e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                    {saveAnimation === 'allowInvalidProviderCertificates' && (
                        <span className="save-indicator">{t('settings', 'saved')}</span>
                    )}
                </div>

                {allowInvalidProviderCertificates && (
                    <div className="certificate-warning">
                        <strong>Atenção:</strong> este modo não libera certificados inválidos nem CORS para TMDB, atualizações, GitHub ou domínios externos independentes. Ele vale apenas para o servidor IPTV salvo no app e hosts relacionados aprovados.
                    </div>
                )}
            </div>
        </div>
    );
}
