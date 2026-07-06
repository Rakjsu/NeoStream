import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tv, Plus, Settings, Sparkles, X, Globe, Link2, Archive, ArrowLeft } from 'lucide-react';
import { useLanguage, languageService } from '../services/languageService';
import { playlistService } from '../services/playlistService';
import { applyBackup, decodePlaylistPassword } from '../services/backupService';

// First-run onboarding: step 1 picks the language, step 2 offers the three
// ways in (Xtream account, M3U list, restore a backup). The page only renders
// while no playlist is configured, so it doubles as the empty state.
type WizardStep = 'language' | 'connect';

export function Welcome() {
    const navigate = useNavigate();
    const { t, language } = useLanguage();
    const [showSettings, setShowSettings] = useState(false);
    const [step, setStep] = useState<WizardStep>('language');
    const [connectMode, setConnectMode] = useState<'menu' | 'm3u'>('menu');
    const [m3uName, setM3uName] = useState('');
    const [m3uUrl, setM3uUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const handleLanguageChange = (lang: 'pt' | 'en' | 'es') => {
        languageService.setLanguage(lang);
    };

    const languageOptions: { code: 'pt' | 'en' | 'es', name: string, flag: string }[] = [
        { code: 'pt', name: 'Português', flag: '🇧🇷' },
        { code: 'en', name: 'English', flag: '🇺🇸' },
        { code: 'es', name: 'Español', flag: '🇪🇸' }
    ];

    const handleAddM3u = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            const result = await playlistService.addM3u({
                name: m3uName.trim() || undefined,
                url: m3uUrl.trim()
            });
            if (result.success) {
                playlistService.reloadIntoDashboard(true);
            } else {
                setError(result.error || t('welcome', 'm3uError'));
            }
        } catch {
            setError(t('welcome', 'm3uError'));
        } finally {
            setBusy(false);
        }
    };

    const handleRestoreBackup = async () => {
        setError('');
        setBusy(true);
        try {
            const result = await window.ipcRenderer.invoke('backup:load-file') as {
                success: boolean; canceled?: boolean; json?: string;
            };
            if (!result.success || !result.json) {
                if (!result.canceled) setError(t('welcome', 'restoreError'));
                return;
            }
            // Fresh install: nothing to overwrite, apply directly.
            const report = applyBackup(JSON.parse(result.json));
            if (report.playlists.length > 0) {
                await window.ipcRenderer.invoke('backup:import-playlists', {
                    playlists: report.playlists.map(p => ({
                        name: p.name,
                        url: p.url,
                        username: p.username,
                        password: decodePlaylistPassword(p.passwordB64)
                    }))
                }).catch(() => undefined);
            }
            // v3: the backup carries the OpenSubtitles credentials too.
            if (report.openSubtitles) {
                await window.ipcRenderer.invoke('opensubtitles:set-config', report.openSubtitles).catch(() => undefined);
            }
            playlistService.reloadIntoDashboard(true);
        } catch {
            setError(t('welcome', 'restoreError'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <style>{welcomeStyles}</style>
            <div className="welcome-container">
                {/* Animated Background */}
                <div className="welcome-bg">
                    <div className="welcome-orb welcome-orb-1" />
                    <div className="welcome-orb welcome-orb-2" />
                    <div className="welcome-orb welcome-orb-3" />
                    <div className="welcome-grid" />
                </div>

                {/* Content */}
                <div className="welcome-content">
                    {/* Logo Section */}
                    <div className="welcome-logo">
                        <div className="welcome-logo-bg">
                            <Tv className="welcome-logo-icon" strokeWidth={1.5} />
                        </div>
                        <h1 className="welcome-title">NeoStream</h1>
                        <div className="welcome-badge">
                            <Sparkles size={12} />
                            <span>IPTV Player</span>
                        </div>
                    </div>

                    {/* Wizard progress */}
                    <div className="welcome-steps" aria-hidden="true">
                        <span className={`welcome-step-dot ${step === 'language' ? 'active' : 'done'}`} />
                        <span className={`welcome-step-dot ${step === 'connect' ? 'active' : ''}`} />
                    </div>

                    {step === 'language' && (
                        <>
                            <div className="welcome-message">
                                <h2>{t('welcome', 'stepLanguageTitle')}</h2>
                                <p>{t('welcome', 'stepLanguageDesc')}</p>
                            </div>
                            <div className="welcome-lang-cards">
                                {languageOptions.map((lang) => (
                                    <button
                                        key={lang.code}
                                        className={`welcome-lang-card ${language === lang.code ? 'welcome-lang-active' : ''}`}
                                        onClick={() => handleLanguageChange(lang.code)}
                                    >
                                        <span className="welcome-lang-flag">{lang.flag}</span>
                                        <span>{lang.name}</span>
                                    </button>
                                ))}
                            </div>
                            <button className="welcome-continue" onClick={() => setStep('connect')}>
                                {t('welcome', 'continue')}
                            </button>
                        </>
                    )}

                    {step === 'connect' && connectMode === 'menu' && (
                        <>
                            <div className="welcome-message">
                                <h2>{t('welcome', 'noChannels') || 'Nenhuma playlist configurada'}</h2>
                                <p>{t('welcome', 'addPlaylistHint') || 'Adicione uma playlist do seu provedor IPTV para começar a assistir'}</p>
                            </div>
                            <div className="welcome-cards">
                                <button
                                    className="welcome-card welcome-card-primary"
                                    onClick={() => navigate('/login')}
                                >
                                    <div className="welcome-card-icon">
                                        <Plus size={24} />
                                    </div>
                                    <div className="welcome-card-text">
                                        <span className="welcome-card-title">{t('welcome', 'addPlaylist') || 'Adicionar Playlist'}</span>
                                        <span className="welcome-card-desc">{t('welcome', 'addPlaylistDesc') || 'Conecte sua conta IPTV'}</span>
                                    </div>
                                </button>

                                <button
                                    className="welcome-card welcome-card-secondary"
                                    onClick={() => { setError(''); setConnectMode('m3u'); }}
                                >
                                    <div className="welcome-card-icon">
                                        <Link2 size={24} />
                                    </div>
                                    <div className="welcome-card-text">
                                        <span className="welcome-card-title">{t('welcome', 'connectM3u')}</span>
                                        <span className="welcome-card-desc">{t('welcome', 'connectM3uDesc')}</span>
                                    </div>
                                </button>

                                <button
                                    className="welcome-card welcome-card-secondary"
                                    onClick={() => void handleRestoreBackup()}
                                    disabled={busy}
                                >
                                    <div className="welcome-card-icon">
                                        <Archive size={24} />
                                    </div>
                                    <div className="welcome-card-text">
                                        <span className="welcome-card-title">{t('welcome', 'restoreBackup')}</span>
                                        <span className="welcome-card-desc">{t('welcome', 'restoreBackupDesc')}</span>
                                    </div>
                                </button>

                                <button
                                    className="welcome-card welcome-card-secondary"
                                    onClick={() => setShowSettings(true)}
                                >
                                    <div className="welcome-card-icon">
                                        <Settings size={24} />
                                    </div>
                                    <div className="welcome-card-text">
                                        <span className="welcome-card-title">{t('welcome', 'settings') || 'Configurações'}</span>
                                        <span className="welcome-card-desc">{t('welcome', 'settingsDesc') || 'Personalize o aplicativo'}</span>
                                    </div>
                                </button>
                            </div>
                            <button className="welcome-back" onClick={() => setStep('language')}>
                                <ArrowLeft size={14} /> {t('welcome', 'back')}
                            </button>
                        </>
                    )}

                    {step === 'connect' && connectMode === 'm3u' && (
                        <>
                            <div className="welcome-message">
                                <h2>{t('welcome', 'connectM3u')}</h2>
                                <p>{t('welcome', 'connectM3uHint')}</p>
                            </div>
                            <form className="welcome-m3u-form" onSubmit={(e) => void handleAddM3u(e)}>
                                <input
                                    type="text"
                                    placeholder={t('welcome', 'm3uName')}
                                    value={m3uName}
                                    onChange={(e) => setM3uName(e.target.value)}
                                    disabled={busy}
                                />
                                <input
                                    type="url"
                                    placeholder="http://exemplo.com/lista.m3u"
                                    value={m3uUrl}
                                    onChange={(e) => setM3uUrl(e.target.value)}
                                    required
                                    disabled={busy}
                                />
                                <button type="submit" className="welcome-continue" disabled={busy || !m3uUrl.trim()}>
                                    {busy ? t('welcome', 'm3uAdding') : t('welcome', 'm3uAdd')}
                                </button>
                            </form>
                            <button className="welcome-back" onClick={() => { setError(''); setConnectMode('menu'); }}>
                                <ArrowLeft size={14} /> {t('welcome', 'back')}
                            </button>
                        </>
                    )}

                    {error && <p className="welcome-error">⚠️ {error}</p>}

                    {/* Footer */}
                    <p className="welcome-footer">
                        {t('welcome', 'disclaimer') || 'NeoStream não fornece conteúdo. Use sua própria assinatura IPTV.'}
                    </p>
                </div>

                {/* Settings Panel Overlay */}
                {showSettings && (
                    <div className="settings-overlay" onClick={() => setShowSettings(false)} />
                )}

                {/* Settings Slide Panel */}
                <div className={`settings-panel ${showSettings ? 'settings-panel-open' : ''}`}>
                    <div className="settings-panel-header">
                        <h2>{t('welcome', 'settings') || 'Configurações'}</h2>
                        <button className="settings-close-btn" onClick={() => setShowSettings(false)}>
                            <X size={20} />
                        </button>
                    </div>

                    <div className="settings-panel-content">
                        {/* Language Section */}
                        <div className="settings-section">
                            <div className="settings-section-header">
                                <Globe size={18} />
                                <span>{t('updates', 'language') || 'Idioma'}</span>
                            </div>
                            <div className="settings-options">
                                {languageOptions.map((lang) => (
                                    <button
                                        key={lang.code}
                                        className={`settings-option ${language === lang.code ? 'settings-option-active' : ''}`}
                                        onClick={() => handleLanguageChange(lang.code)}
                                    >
                                        <span className="settings-option-flag">{lang.flag}</span>
                                        <span>{lang.name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="settings-panel-footer">
                        <p>NeoStream v{__APP_VERSION__}</p>
                    </div>
                </div>
            </div>
        </>
    );
}

const welcomeStyles = `
.welcome-steps {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-bottom: 28px;
}

.welcome-step-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    transition: all 0.3s ease;
}

.welcome-step-dot.active {
    background: var(--ns-accent);
    width: 24px;
    border-radius: 4px;
}

.welcome-step-dot.done {
    background: rgba(255, 255, 255, 0.4);
}

.welcome-lang-cards {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-bottom: 28px;
}

.welcome-lang-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 18px 26px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    color: rgba(255, 255, 255, 0.85);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.welcome-lang-card:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: translateY(-2px);
}

.welcome-lang-active {
    border-color: var(--ns-accent);
    background: rgba(99, 102, 241, 0.12);
}

.welcome-lang-flag {
    font-size: 28px;
}

.welcome-continue {
    padding: 14px 44px;
    background: linear-gradient(135deg, var(--ns-accent-dark), var(--ns-accent));
    border: none;
    border-radius: 12px;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
}

.welcome-continue:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 10px 30px rgba(99, 102, 241, 0.4);
}

.welcome-continue:disabled {
    opacity: 0.5;
    cursor: default;
}

.welcome-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 20px;
    padding: 8px 16px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
    cursor: pointer;
}

.welcome-back:hover {
    color: rgba(255, 255, 255, 0.85);
}

.welcome-m3u-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 380px;
    margin: 0 auto;
}

.welcome-m3u-form input {
    padding: 13px 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: white;
    font-size: 14px;
    outline: none;
}

.welcome-m3u-form input:focus {
    border-color: var(--ns-accent);
}

.welcome-error {
    margin-top: 16px;
    color: #fca5a5;
    font-size: 13px;
}

.welcome-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    background: linear-gradient(135deg, #0a0a0f 0%, #0d0d15 50%, #0a0f1a 100%);
    position: relative;
    overflow: hidden;
}

.welcome-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.welcome-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(100px);
    opacity: 0.4;
    animation: orbFloat 20s ease-in-out infinite;
}

.welcome-orb-1 {
    width: 500px;
    height: 500px;
    background: radial-gradient(circle, #6366f1 0%, transparent 70%);
    top: -150px;
    left: -150px;
}

.welcome-orb-2 {
    width: 400px;
    height: 400px;
    background: radial-gradient(circle, var(--ns-accent) 0%, transparent 70%);
    bottom: -100px;
    right: -100px;
    animation-delay: -7s;
}

.welcome-orb-3 {
    width: 300px;
    height: 300px;
    background: radial-gradient(circle, #06b6d4 0%, transparent 70%);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    animation-delay: -14s;
}

@keyframes orbFloat {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(40px, -40px) scale(1.1); }
    50% { transform: translate(-30px, 30px) scale(0.9); }
    75% { transform: translate(30px, 40px) scale(1.05); }
}

.welcome-grid {
    position: absolute;
    inset: 0;
    background-image: 
        linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 60px 60px;
    mask-image: radial-gradient(ellipse at center, black 30%, transparent 70%);
}

.welcome-content {
    position: relative;
    z-index: 1;
    text-align: center;
    max-width: 500px;
    animation: fadeInUp 0.8s ease;
}

@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
}

.welcome-logo {
    margin-bottom: 48px;
}

.welcome-logo-bg {
    width: 100px;
    height: 100px;
    background: linear-gradient(135deg, var(--ns-accent-dark) 0%, var(--ns-accent) 100%);
    border-radius: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
    box-shadow: 
        0 20px 60px rgba(99, 102, 241, 0.4),
        0 0 0 1px rgba(255,255,255,0.1);
    animation: pulse 3s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { box-shadow: 0 20px 60px rgba(99, 102, 241, 0.4), 0 0 0 1px rgba(255,255,255,0.1); }
    50% { box-shadow: 0 25px 80px rgba(99, 102, 241, 0.6), 0 0 0 1px rgba(255,255,255,0.15); }
}

.welcome-logo-icon {
    width: 50px;
    height: 50px;
    color: white;
}

.welcome-title {
    font-size: 36px;
    font-weight: 700;
    color: white;
    margin: 0;
    letter-spacing: -0.02em;
}

.welcome-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    padding: 6px 14px;
    background: rgba(var(--ns-accent-rgb), 0.15);
    border: 1px solid rgba(var(--ns-accent-rgb), 0.3);
    border-radius: 20px;
    color: var(--ns-accent-light);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
}

.welcome-message {
    margin-bottom: 40px;
}

.welcome-message h2 {
    font-size: 22px;
    font-weight: 600;
    color: rgba(255,255,255,0.9);
    margin: 0 0 12px 0;
}

.welcome-message p {
    font-size: 15px;
    color: rgba(255,255,255,0.5);
    margin: 0;
    line-height: 1.6;
}

.welcome-cards {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 40px;
}

.welcome-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px 24px;
    border-radius: 16px;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: all 0.3s ease;
}

.welcome-card-primary {
    background: linear-gradient(135deg, var(--ns-accent-dark) 0%, var(--ns-accent) 100%);
    box-shadow: 0 8px 32px rgba(99, 102, 241, 0.3);
}

.welcome-card-primary:hover {
    transform: translateY(-4px);
    box-shadow: 0 16px 48px rgba(99, 102, 241, 0.4);
}

.welcome-card-secondary {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
}

.welcome-card-secondary:hover {
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.2);
    transform: translateY(-2px);
}

.welcome-card-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.welcome-card-primary .welcome-card-icon {
    background: rgba(255,255,255,0.2);
    color: white;
}

.welcome-card-secondary .welcome-card-icon {
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.7);
}

.welcome-card-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.welcome-card-title {
    font-size: 16px;
    font-weight: 600;
    color: white;
}

.welcome-card-desc {
    font-size: 13px;
    color: rgba(255,255,255,0.6);
}

.welcome-card-primary .welcome-card-desc {
    color: rgba(255,255,255,0.8);
}

.welcome-footer {
    font-size: 12px;
    color: rgba(255,255,255,0.3);
    margin: 0;
    line-height: 1.5;
}

/* Settings Panel */
.settings-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: 100;
    animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.settings-panel {
    position: fixed;
    top: 0;
    left: 0;
    width: 340px;
    height: 100vh;
    background: linear-gradient(180deg, var(--ns-bg-panel) 0%, var(--ns-bg-tint) 100%);
    border-right: 1px solid rgba(255,255,255,0.1);
    z-index: 101;
    transform: translateX(-100%);
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    box-shadow: 10px 0 40px rgba(0, 0, 0, 0.5);
}

.settings-panel-open {
    transform: translateX(0);
}

.settings-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
}

.settings-panel-header h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: white;
}

.settings-close-btn {
    width: 36px;
    height: 36px;
    border: none;
    background: rgba(255,255,255,0.08);
    border-radius: 10px;
    color: rgba(255,255,255,0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
}

.settings-close-btn:hover {
    background: rgba(255,255,255,0.15);
    color: white;
}

.settings-panel-content {
    flex: 1;
    padding: 24px;
    overflow-y: auto;
}

.settings-section {
    margin-bottom: 32px;
}

.settings-section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    color: #a5b4fc;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.settings-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.settings-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    color: rgba(255,255,255,0.7);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.settings-option:hover {
    background: rgba(255,255,255,0.06);
    border-color: rgba(255,255,255,0.1);
}

.settings-option-active {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.4);
    color: white;
}

.settings-option-active:hover {
    background: rgba(99, 102, 241, 0.2);
}

.settings-option-flag {
    font-size: 20px;
}

.settings-panel-footer {
    padding: 20px 24px;
    border-top: 1px solid rgba(255,255,255,0.08);
    text-align: center;
}

.settings-panel-footer p {
    margin: 0;
    font-size: 12px;
    color: rgba(255,255,255,0.3);
}
`;
