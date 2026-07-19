import { useEffect, useState, useMemo } from 'react';
import { useLanguage } from '../../services/languageService';
import { useSaveAnimation } from './useSaveAnimation';
import { qrToSvg } from '../../utils/qrEncoder';

export function NetworkSection() {
    const [allowInvalidProviderCertificates, setAllowInvalidProviderCertificates] = useState(true);
    const [webRemote, setWebRemote] = useState<{ enabled: boolean; https: boolean; url: string | null; pin: string | null }>({ enabled: false, https: false, url: null, pin: null });
    // 📟 Aparelhos conectados no controle web (polling leve enquanto ligado).
    const [remoteClients, setRemoteClients] = useState<{ ip: string; name: string | null; role: string; connectedAt: number }[]>([]);
    const { t } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();

    // Offline QR of the LAN URL (own pure encoder — no lib, no network).
    useEffect(() => {
        if (!webRemote.enabled) {
            queueMicrotask(() => setRemoteClients([]));
            return;
        }
        let cancelled = false;
        const load = async () => {
            const res = await window.ipcRenderer.invoke('web-remote:clients-list').catch(() => null) as
                { success?: boolean; clients?: { ip: string; name: string | null; role: string; connectedAt: number }[] } | null;
            if (!cancelled && res?.success) setRemoteClients(res.clients ?? []);
        };
        void load();
        const id = setInterval(load, 5000);
        return () => { cancelled = true; clearInterval(id); };
    }, [webRemote.enabled]);

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
                const result = await window.ipcRenderer.invoke('web-remote:get-config') as { success: boolean; enabled?: boolean; https?: boolean; url?: string | null; pin?: string | null };
                if (result.success) setWebRemote({ enabled: result.enabled ?? false, https: result.https ?? false, url: result.url ?? null, pin: result.pin ?? null });
            } catch { /* handler absent in old builds */ }
        })();
    }, []);

    type WebRemoteResult = { success: boolean; enabled?: boolean; https?: boolean; url?: string | null; pin?: string | null } | null;
    const applyWebRemote = (result: WebRemoteResult) => {
        if (result?.success) setWebRemote({ enabled: result.enabled ?? false, https: result.https ?? false, url: result.url ?? null, pin: result.pin ?? null });
    };

    const handleWebRemoteToggle = async (value: boolean) => {
        const result = await window.ipcRenderer.invoke('web-remote:set-enabled', { enabled: value })
            .catch(() => null) as WebRemoteResult;
        applyWebRemote(result);
        triggerSaveAnimation('webRemote');
    };

    const handleWebRemoteHttpsToggle = async (value: boolean) => {
        const result = await window.ipcRenderer.invoke('web-remote:set-enabled', { https: value })
            .catch(() => null) as WebRemoteResult;
        applyWebRemote(result);
        triggerSaveAnimation('webRemote');
    };

    const handleRegenPin = async () => {
        const result = await window.ipcRenderer.invoke('web-remote:regen-pin')
            .catch(() => null) as { success: boolean; pin?: string } | null;
        if (result?.success && result.pin) setWebRemote(prev => ({ ...prev, pin: result.pin! }));
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
                                <div style={{ marginTop: 12, fontSize: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                    {t('network', 'webRemotePin')}:{' '}
                                    <strong style={{ fontSize: 22, letterSpacing: 4, color: 'var(--ns-accent-light)' }}>{webRemote.pin}</strong>
                                    <button
                                        onClick={() => void handleRegenPin()}
                                        style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', fontSize: 12, cursor: 'pointer' }}
                                    >
                                        🔄 {t('network', 'webRemoteNewPin')}
                                    </button>
                                </div>
                            )}
                            <p style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>{t('network', 'webRemoteQrHint')}</p>
                            <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>📟 {t('network', 'devicesTitle')}</div>
                                {remoteClients.length === 0 ? (
                                    <p style={{ margin: '4px 0', fontSize: 12, opacity: 0.7 }}>{t('network', 'devicesEmpty')}</p>
                                ) : remoteClients.map((c, index) => (
                                    <p key={`${c.ip}-${index}`} style={{ margin: '4px 0', fontSize: 12 }}>
                                        {c.role === 'mobile' ? '📱' : '🌐'} {c.name || c.ip}
                                        <span style={{ opacity: 0.6 }}>
                                            {' '}· {c.ip} · {c.connectedAt ? new Date(c.connectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                        </span>
                                    </p>
                                ))}
                            </div>
                            <label style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={webRemote.https}
                                    onChange={(e) => void handleWebRemoteHttpsToggle(e.target.checked)}
                                />
                                🔒 {t('network', 'webRemoteHttps')}
                            </label>
                            <p style={{ marginTop: 4, fontSize: 11, opacity: 0.6 }}>{t('network', 'webRemoteHttpsHint')}</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
