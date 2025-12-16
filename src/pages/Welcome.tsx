import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tv, Plus, Settings, Sparkles, X, Globe } from 'lucide-react';
import { useLanguage, languageService } from '../services/languageService';

export function Welcome() {
    const navigate = useNavigate();
    const { t, language } = useLanguage();
    const [showSettings, setShowSettings] = useState(false);

    const handleLanguageChange = (lang: 'pt' | 'en' | 'es') => {
        languageService.setLanguage(lang);
    };

    const languageOptions: { code: 'pt' | 'en' | 'es', name: string, flag: string }[] = [
        { code: 'pt', name: 'Português', flag: '🇧🇷' },
        { code: 'en', name: 'English', flag: '🇺🇸' },
        { code: 'es', name: 'Español', flag: '🇪🇸' }
    ];

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

                    {/* Message */}
                    <div className="welcome-message">
                        <h2>{t('welcome', 'noChannels') || 'Nenhuma playlist configurada'}</h2>
                        <p>{t('welcome', 'addPlaylistHint') || 'Adicione uma playlist do seu provedor IPTV para começar a assistir'}</p>
                    </div>

                    {/* Action Cards */}
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
    background: radial-gradient(circle, #a855f7 0%, transparent 70%);
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
    background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
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
    background: rgba(168, 85, 247, 0.15);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 20px;
    color: #c4b5fd;
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
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
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
    background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
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
