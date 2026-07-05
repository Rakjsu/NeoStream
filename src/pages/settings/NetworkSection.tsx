import { useEffect, useState, useMemo } from 'react';
import { useLanguage } from '../../services/languageService';
import { useSaveAnimation } from './useSaveAnimation';
import { qrToSvg } from '../../utils/qrEncoder';

export function NetworkSection() {
    const [allowInvalidProviderCertificates, setAllowInvalidProviderCertificates] = useState(true);
    const [webRemote, setWebRemote] = useState<{ enabled: boolean; url: string | null; pin: string | null }>({ enabled: false, url: null, pin: null });
    const { t } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();

    // Offline QR of the LAN URL (own pure encoder — no lib, no network).
    const webRemoteQr = useMemo(() => {
        if (!webRemote.url) return null;
        try {
            return qrToSvg(webRemote.url, 4);
        } catch {
            return null;
        }
    }, [webRemote.url]);

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
            try {
                const result = await window.ipcRenderer.invoke('web-remote:get-config') as { success: boolean; enabled?: boolean; url?: string | null; pin?: string | null };
                if (result.success) setWebRemote({ enabled: result.enabled ?? false, url: result.url ?? null, pin: result.pin ?? null });
            } catch { /* handler absent in old builds */ }
        })();
    }, []);

    const handleWebRemoteToggle = async (value: boolean) => {
        const result = await window.ipcRenderer.invoke('web-remote:set-enabled', { enabled: value })
            .catch(() => null) as { success: boolean; enabled?: boolean; url?: string | null; pin?: string | null } | null;
        if (result?.success) setWebRemote({ enabled: result.enabled ?? false, url: result.url ?? null, pin: result.pin ?? null });
        triggerSaveAnimation('webRemote');
    };

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

                {/* Phone web remote */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>📱 {t('network', 'webRemoteTitle')}</label>
                        <p>{t('network', 'webRemoteDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={webRemote.enabled}
                            onChange={(e) => void handleWebRemoteToggle(e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                    {saveAnimation === 'webRemote' && (
                        <span className="save-indicator">{t('settings', 'saved')}</span>
                    )}
                </div>

                {webRemote.enabled && webRemote.url && (
                    <div className="certificate-warning" style={{ borderColor: 'rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.1)', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                        {webRemoteQr && (
                            <div
                                style={{ width: 132, height: 132, flexShrink: 0, borderRadius: 8, overflow: 'hidden' }}
                                dangerouslySetInnerHTML={{ __html: webRemoteQr }}
                            />
                        )}
                        <div style={{ flex: '1 1 200px' }}>
                            {t('network', 'webRemoteOpen')}:{' '}
                            <a href={webRemote.url} style={{ color: 'var(--ns-accent-light)', fontWeight: 700 }} onClick={(e) => e.preventDefault()}>
                                {webRemote.url}
                            </a>
                            {webRemote.pin && (
                                <div style={{ marginTop: 12, fontSize: 14 }}>
                                    {t('network', 'webRemotePin')}:{' '}
                                    <strong style={{ fontSize: 22, letterSpacing: 4, color: 'var(--ns-accent-light)' }}>{webRemote.pin}</strong>
                                </div>
                            )}
                            <p style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>{t('network', 'webRemoteQrHint')}</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
