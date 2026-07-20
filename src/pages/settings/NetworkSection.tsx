import { useEffect, useState, useMemo } from 'react';
import { useLanguage } from '../../services/languageService';
import { useSaveAnimation } from './useSaveAnimation';
import { qrToSvg } from '../../utils/qrEncoder';
import { buildRemoteWsUrl, parsePeerState, sendPeerCommand, type RemotePeerState } from '../../services/desktopRemoteClient';

export function NetworkSection() {
    const [allowInvalidProviderCertificates, setAllowInvalidProviderCertificates] = useState(true);
    const [webRemote, setWebRemote] = useState<{ enabled: boolean; https: boolean; url: string | null; pin: string | null }>({ enabled: false, https: false, url: null, pin: null });
    // 📟 Aparelhos conectados no controle web (polling leve enquanto ligado).
    const [remoteClients, setRemoteClients] = useState<{ id?: string; ip: string; name: string | null; role: string; connectedAt: number }[]>([]);
    // 🕓 Item 14: histórico de conexões do controle.
    const [connectionHistory, setConnectionHistory] = useState<{ name: string | null; ip: string; role: string; at: number; event: string }[]>([]);
    const { t } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();

    // 🖥️ Item 38: PC controla PC — cliente WS do controle web de outro NeoStream.
    const [peerAddr, setPeerAddr] = useState('');
    const [peerPin, setPeerPin] = useState('');
    const [peerSocket, setPeerSocket] = useState<WebSocket | null>(null);
    const [peerState, setPeerState] = useState<RemotePeerState | null>(null);
    const [peerError, setPeerError] = useState<string | null>(null);
    const connectPeer = () => {
        setPeerError(null);
        try {
            const socket = new WebSocket(buildRemoteWsUrl(peerAddr, peerPin));
            socket.onopen = () => setPeerSocket(socket);
            socket.onmessage = (event) => {
                const state = parsePeerState(String(event.data));
                if (state) setPeerState(state);
            };
            socket.onerror = () => setPeerError('Não conectou — confira endereço, PIN e se o controle está ativado no outro PC.');
            socket.onclose = () => { setPeerSocket(null); setPeerState(null); };
        } catch {
            setPeerError('Endereço inválido.');
        }
    };
    const disconnectPeer = () => { peerSocket?.close(); };
    // Desmontar a página fecha o socket (sem vazamento).
    useEffect(() => () => { peerSocket?.close(); }, [peerSocket]);

    // Offline QR of the LAN URL (own pure encoder — no lib, no network).
    useEffect(() => {
        if (!webRemote.enabled) {
            queueMicrotask(() => setRemoteClients([]));
            return;
        }
        let cancelled = false;
        const load = async () => {
            void window.ipcRenderer.invoke('web-remote:connection-history')
                .then((r: { success?: boolean; history?: { name: string | null; ip: string; role: string; at: number; event: string }[] } | null) => {
                    if (!cancelled && r?.success && r.history) setConnectionHistory(r.history);
                })
                .catch(() => undefined);
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
                                    <p key={`${c.ip}-${index}`} style={{ margin: '4px 0', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span>{c.role === 'mobile' ? '📱' : '🌐'} {c.name || c.ip}</span>
                                        <span style={{ opacity: 0.6 }}>
                                            · {c.ip} · {c.connectedAt ? new Date(c.connectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                        </span>
                                        {c.id && (
                                            <button
                                                onClick={() => {
                                                    void window.ipcRenderer.invoke('web-remote:disconnect-client', { id: c.id })
                                                        .then(() => setRemoteClients(prev => prev.filter(x => x.id !== c.id)))
                                                        .catch(() => undefined);
                                                }}
                                                title={t('network', 'devicesDisconnect')}
                                                style={{ padding: '1px 8px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.12)', color: '#f87171', fontSize: 11, cursor: 'pointer' }}
                                            >
                                                ✕ {t('network', 'devicesDisconnect')}
                                            </button>
                                        )}
                                    </p>
                                ))}
                                {connectionHistory.length > 0 && (
                                    <div style={{ marginTop: 10 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600 }}>🕓 {t('network', 'historyTitle')}</div>
                                        {connectionHistory.slice(0, 8).map((h, index) => (
                                            <p key={`${h.at}-${index}`} style={{ margin: '3px 0', fontSize: 11, opacity: 0.75 }}>
                                                {h.event === 'connect' ? '🔌' : '❌'} {h.name || h.ip}
                                                <span style={{ opacity: 0.6 }}> · {new Date(h.at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                            </p>
                                        ))}
                                    </div>
                                )}
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

                {/* 🖥️ Item 38: este PC controla OUTRO NeoStream (mesmo protocolo do celular). */}
                <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                    <div className="setting-info">
                        <label>🖥️ Controlar outro NeoStream</label>
                        <p>Conecte no controle remoto de outro PC da rede (endereço e PIN mostrados nas Configurações dele) e comande a reprodução daqui.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input
                            type="text"
                            placeholder="192.168.0.20:8974"
                            value={peerAddr}
                            onChange={(e) => setPeerAddr(e.target.value)}
                            disabled={!!peerSocket}
                            style={{ flex: 2, minWidth: 160, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'white' }}
                        />
                        <input
                            type="text"
                            placeholder="PIN"
                            value={peerPin}
                            onChange={(e) => setPeerPin(e.target.value)}
                            disabled={!!peerSocket}
                            maxLength={4}
                            style={{ width: 70, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'white' }}
                        />
                        <button
                            onClick={peerSocket ? disconnectPeer : connectPeer}
                            disabled={!peerSocket && (!peerAddr.trim() || peerPin.trim().length < 4)}
                            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, background: peerSocket ? 'rgba(239,68,68,0.7)' : 'var(--ns-accent)', color: 'white' }}
                        >
                            {peerSocket ? 'Desconectar' : 'Conectar'}
                        </button>
                    </div>
                    {peerError && <p style={{ color: '#fca5a5', fontSize: 12, margin: 0 }}>{peerError}</p>}
                    {peerSocket && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, opacity: 0.8 }}>
                                🟢 {peerState?.casting ? `Transmitindo: ${peerState.castTitle || '…'}`
                                    : peerState?.title ? `${peerState.playing ? '▶' : '⏸'} ${peerState.title}` : 'Conectado'}
                            </span>
                            {(['previous', 'togglePlay', 'stop', 'next', 'volumeDown', 'volumeUp'] as const).map(action => (
                                <button
                                    key={action}
                                    onClick={() => sendPeerCommand(peerSocket, action)}
                                    title={action}
                                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: 'white', cursor: 'pointer' }}
                                >
                                    {action === 'previous' ? '⏮' : action === 'togglePlay' ? '⏯' : action === 'stop' ? '⏹' : action === 'next' ? '⏭' : action === 'volumeDown' ? '🔉' : '🔊'}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
