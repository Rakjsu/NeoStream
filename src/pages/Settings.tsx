import { useState, useEffect } from 'react';
import { useLanguage } from '../services/languageService';
import epgTestService from '../services/epgTestService';
import { UpdatesSection } from './settings/UpdatesSection';
import { PlaybackSection } from './settings/PlaybackSection';
import { AppearanceSection } from './settings/AppearanceSection';
import { NetworkSection } from './settings/NetworkSection';
import { EpgSection, type EpgResultsFilter, type EpgCountryFilter } from './settings/EpgSection';
import { StatsSection } from './settings/StatsSection';
import { ParentalSection } from './settings/ParentalSection';
import { BackupSection } from './settings/BackupSection';
import { AboutSection } from './settings/AboutSection';
import { PlaylistsSection } from './settings/PlaylistsSection';
import { DiagnosticsSection } from './settings/DiagnosticsSection';


export function Settings() {
    const [activeSection, setActiveSection] = useState<string>('updates');

    // Language
    const { t } = useLanguage();

    // Update check state - kept in the shell so an in-flight check survives section switches
    const [updateChecking, setUpdateChecking] = useState(false);

    // EPG result filters - kept in the shell so they persist when navigating between sections
    const [epgResultsFilter, setEpgResultsFilter] = useState<EpgResultsFilter>('all');
    const [epgCountryFilter, setEpgCountryFilter] = useState<EpgCountryFilter>('all');
    const [epgSearchTerm, setEpgSearchTerm] = useState('');
    const [epgCurrentPage, setEpgCurrentPage] = useState(1);

    // Keep the EPG background service translated even if the EPG section is never opened
    useEffect(() => {
        epgTestService.setTranslateFunction(t);
    }, [t]);

    const sections = [
        { id: 'updates', icon: '🔄', label: t('nav', 'updates'), color: '#10b981' },
        { id: 'playlists', icon: '📺', label: t('playlists', 'title'), color: '#6366f1' },
        { id: 'playback', icon: '⏯️', label: t('nav', 'playback') || 'Reprodução', color: '#3b82f6' },
        { id: 'appearance', icon: '🎨', label: t('nav', 'appearance') || 'Aparência', color: 'var(--ns-accent)' },
        { id: 'network', icon: '🔐', label: 'Rede', color: '#14b8a6' },
        { id: 'epg', icon: '📡', label: 'EPG', color: '#06b6d4' },
        { id: 'stats', icon: '📊', label: t('nav', 'stats'), color: '#8b5cf6' },
        { id: 'parental', icon: '👨‍👩‍👧', label: t('nav', 'parental'), color: '#ef4444' },
        { id: 'backup', icon: '💾', label: t('nav', 'backup'), color: '#64748b' },
        { id: 'diagnostics', icon: '🩺', label: t('nav', 'diagnostics'), color: '#ec4899' },
        { id: 'about', icon: 'ℹ️', label: t('nav', 'about'), color: '#f59e0b' }
    ];

    return (
        <>
            <style>{settingsStyles}</style>
            <div className="settings-page">
                <div className="settings-backdrop" />

                {/* Header */}
                <header className="settings-header">
                    <div className="header-icon">⚙️</div>
                    <div>
                        <h1>{t('settings', 'title')}</h1>
                        <p className="subtitle">{t('settings', 'subtitle')}</p>
                    </div>
                </header>

                <div className="settings-layout">
                    {/* Sidebar Navigation */}
                    <nav className="settings-nav">
                        {sections.map((section, index) => (
                            <button
                                key={section.id}
                                className={`nav-item ${activeSection === section.id ? 'active' : ''}`}
                                onClick={() => setActiveSection(section.id)}
                                style={{
                                    animationDelay: `${index * 0.1}s`,
                                    '--section-color': section.color
                                } as React.CSSProperties}
                            >
                                <span className="nav-icon">{section.icon}</span>
                                <span className="nav-label">{section.label}</span>
                            </button>
                        ))}
                    </nav>

                    {/* Content Area */}
                    <div className="settings-content">
                        {/* Updates Section */}
                        {activeSection === 'updates' && (
                            <UpdatesSection checking={updateChecking} setChecking={setUpdateChecking} />
                        )}

                        {/* Playlists Section */}
                        {activeSection === 'playlists' && <PlaylistsSection />}

                        {/* Playback Section */}
                        {activeSection === 'playback' && <PlaybackSection />}

                        {/* Appearance Section */}
                        {activeSection === 'appearance' && <AppearanceSection />}

                        {/* Network Section */}
                        {activeSection === 'network' && <NetworkSection />}

                        {/* EPG Section - Test runs in background */}
                        {activeSection === 'epg' && (
                            <EpgSection
                                epgResultsFilter={epgResultsFilter}
                                setEpgResultsFilter={setEpgResultsFilter}
                                epgCountryFilter={epgCountryFilter}
                                setEpgCountryFilter={setEpgCountryFilter}
                                epgSearchTerm={epgSearchTerm}
                                setEpgSearchTerm={setEpgSearchTerm}
                                epgCurrentPage={epgCurrentPage}
                                setEpgCurrentPage={setEpgCurrentPage}
                            />
                        )}

                        {/* Statistics Section */}
                        {activeSection === 'stats' && <StatsSection />}

                        {/* Parental Control Section */}
                        {activeSection === 'parental' && <ParentalSection />}

                        {/* Backup Section */}
                        {activeSection === 'backup' && <BackupSection />}

                        {/* Diagnostics Section */}
                        {activeSection === 'diagnostics' && <DiagnosticsSection />}

                        {/* About Section */}
                        {activeSection === 'about' && <AboutSection />}
                    </div>
                </div>
            </div >
        </>
    );
}

// CSS Styles
const settingsStyles = `
/* Page Container */
.settings-page {
    position: relative;
    min-height: 100vh;
    padding: 32px;
    overflow-x: hidden;
    background: linear-gradient(135deg, var(--ns-bg-deep) 0%, var(--ns-bg-panel) 50%, var(--ns-bg-tint) 100%);
}

/* Animated Backdrop */
.settings-backdrop {
    position: fixed;
    inset: 0;
    background:
        radial-gradient(ellipse at 30% 30%, rgba(var(--ns-accent-rgb), 0.1) 0%, transparent 50%),
        radial-gradient(ellipse at 70% 70%, rgba(59, 130, 246, 0.1) 0%, transparent 50%);
    pointer-events: none;
    z-index: 0;
}

/* Header */
.settings-header {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 40px;
    animation: fadeInDown 0.5s ease;
}

@keyframes fadeInDown {
    from {
        opacity: 0;
        transform: translateY(-20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.header-icon {
    font-size: 48px;
    animation: spin 10s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.settings-header h1 {
    font-size: 42px;
    font-weight: 800;
    color: white;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #fff 0%, var(--ns-accent-light) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin: 0;
}

.subtitle {
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
    margin-top: 4px;
}

/* Layout */
.settings-layout {
    position: relative;
    z-index: 10;
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 32px;
    max-width: 1200px;
}

@media (max-width: 900px) {
    .settings-layout {
        grid-template-columns: 1fr;
    }
}

/* Navigation */
.settings-nav {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    height: fit-content;
    min-width: 220px;
}

@media (max-width: 900px) {
    .settings-nav {
        flex-direction: row;
        overflow-x: auto;
        padding: 10px;
        min-width: unset;
    }
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: transparent;
    border: none;
    border-radius: 12px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    animation: slideIn 0.4s ease backwards;
    width: 100%;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateX(-20px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.nav-item:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
}

.nav-item.active {
    background: linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.25), rgba(var(--ns-accent-grad-to-rgb), 0.2));
    color: white;
    box-shadow: inset 0 0 0 1px rgba(var(--ns-accent-rgb), 0.4);
}

.nav-icon {
    font-size: 22px;
}

.nav-label {
    white-space: nowrap;
}

/* Content Area — independently scrollable so tall sections (EPG results,
   Reprodução with the MPV block) aren't cut off in the 800px window */
.settings-content {
    flex: 1;
    max-height: calc(100vh - 180px);
    overflow-y: auto;
    padding-right: 6px;
    scrollbar-width: thin;
    scrollbar-color: rgba(var(--ns-accent-rgb), 0.4) transparent;
}

.settings-content::-webkit-scrollbar {
    width: 6px;
}

.settings-content::-webkit-scrollbar-thumb {
    background: rgba(var(--ns-accent-rgb), 0.4);
    border-radius: 3px;
}

.settings-content::-webkit-scrollbar-track {
    background: transparent;
}

/* Section Card */
.section-card {
    background: rgba(255, 255, 255, 0.03);
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 32px;
    animation: fadeIn 0.4s ease;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.section-header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.section-icon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.section-header h2 {
    font-size: 24px;
    font-weight: 700;
    color: white;
    margin: 0 0 4px 0;
}

.section-header p {
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
    font-size: 14px;
}

/* Settings Group */
.settings-group {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

/* Setting Item */
.setting-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    transition: all 0.3s ease;
}

.setting-item:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
}

.setting-info {
    flex: 1;
}

.setting-info label {
    display: block;
    font-size: 16px;
    font-weight: 600;
    color: white;
    margin-bottom: 4px;
}

.setting-info p {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
}

/* Select */
.setting-select {
    padding: 12px 20px;
    background: rgba(30, 30, 50, 0.9);
    color: white;
    font-size: 14px;
    font-weight: 600;
    border-radius: 12px;
    border: 2px solid rgba(var(--ns-accent-rgb), 0.3);
    cursor: pointer;
    outline: none;
    min-width: 180px;
    transition: all 0.2s ease;
}

.setting-select:hover {
    border-color: rgba(var(--ns-accent-rgb), 0.5);
}

.setting-select:focus {
    border-color: var(--ns-accent);
    box-shadow: 0 0 0 3px rgba(var(--ns-accent-rgb), 0.2);
}

/* Toggle Switch */
.toggle-switch {
    position: relative;
    display: inline-block;
    width: 56px;
    height: 30px;
}

.toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.toggle-slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 30px;
    transition: all 0.4s ease;
}

.toggle-slider:before {
    position: absolute;
    content: "";
    height: 22px;
    width: 22px;
    left: 4px;
    bottom: 4px;
    background: white;
    border-radius: 50%;
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toggle-switch input:checked + .toggle-slider {
    background: linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to));
}

.toggle-switch input:checked + .toggle-slider:before {
    transform: translateX(26px);
}

/* Save Indicator */
.save-indicator {
    margin-left: 12px;
    padding: 6px 12px;
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
    font-size: 12px;
    font-weight: 600;
    border-radius: 20px;
    animation: popIn 0.3s ease;
}

@keyframes popIn {
    from { transform: scale(0); }
    to { transform: scale(1); }
}

/* Last Check */
.last-check {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
    background: rgba(var(--ns-accent-rgb), 0.1);
    border-radius: 12px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
}

.check-icon {
    font-size: 18px;
}

.last-check strong {
    color: white;
}

.certificate-warning {
    padding: 16px 20px;
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.28);
    border-radius: 12px;
    color: rgba(255, 255, 255, 0.72);
    font-size: 13px;
    line-height: 1.5;
}

.certificate-warning strong {
    color: #fbbf24;
}

/* Check Button */
.check-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    padding: 18px 32px;
    background: linear-gradient(135deg, var(--ns-accent) 0%, var(--ns-accent-grad-to) 100%);
    border: none;
    border-radius: 14px;
    color: white;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 8px 24px rgba(var(--ns-accent-rgb), 0.3);
}

.check-btn:hover:not(:disabled) {
    transform: translateY(-3px);
    box-shadow: 0 12px 32px rgba(var(--ns-accent-rgb), 0.4);
}

.check-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
}

.check-btn.checking {
    background: rgba(var(--ns-accent-rgb), 0.3);
}

.spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spinLoader 0.8s linear infinite;
}

@keyframes spinLoader {
    to { transform: rotate(360deg); }
}

/* About Section */
.about-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 32px 0;
}

.app-logo {
    margin-bottom: 24px;
    animation: float 3s ease-in-out infinite;
}

@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}

.app-name {
    font-size: 32px;
    font-weight: 800;
    color: white;
    margin: 0 0 8px 0;
    background: linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.app-version {
    display: inline-block;
    padding: 6px 16px;
    background: rgba(var(--ns-accent-rgb), 0.2);
    border-radius: 20px;
    color: var(--ns-accent-light);
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 20px;
}

.app-description {
    color: rgba(255, 255, 255, 0.6);
    font-size: 15px;
    line-height: 1.6;
    max-width: 400px;
    margin-bottom: 32px;
}

.about-links {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: center;
}

.about-link {
    padding: 14px 24px;
    background: linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.15) 0%, rgba(var(--ns-accent-grad-to-rgb), 0.15) 100%);
    border: 1px solid rgba(var(--ns-accent-rgb), 0.3);
    border-radius: 14px;
    color: var(--ns-accent-light);
    text-decoration: none;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 4px 15px rgba(var(--ns-accent-rgb), 0.15);
}

.about-link:hover {
    background: linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.25) 0%, rgba(var(--ns-accent-grad-to-rgb), 0.25) 100%);
    color: white;
    transform: translateY(-4px) scale(1.02);
    box-shadow: 0 8px 25px rgba(var(--ns-accent-rgb), 0.3);
    border-color: rgba(var(--ns-accent-rgb), 0.5);
}

.about-link:active {
    transform: translateY(-2px) scale(1);
}
`;
