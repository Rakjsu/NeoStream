import { useState } from 'react';
import { useLanguage } from '../../services/languageService';

export interface ForcedSubtitlesMenuProps {
    forcedEnabledForSession: boolean;
    onToggleForcedSession: () => void | Promise<void>;
}

// "F" button + per-session Forced Subtitles dropdown toggle.
export function ForcedSubtitlesMenu({
    forcedEnabledForSession,
    onToggleForcedSession
}: ForcedSubtitlesMenuProps) {
    const { t } = useLanguage();
    const [showSettingsMenu, setShowSettingsMenu] = useState(false); // Gear menu visibility

    return (
        <div style={{ position: 'relative' }}>
            <button
                className="control-btn"
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                title={t('player', 'forcedSubtitles')}
                style={{ color: showSettingsMenu ? '#a855f7' : (!forcedEnabledForSession ? 'rgba(255,255,255,0.4)' : 'white') }}
            >
                <span style={{ fontSize: 14, fontWeight: 600 }}>F</span>
            </button>

            {/* Settings Dropdown Menu */}
            {showSettingsMenu && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: '100%',
                        right: 0,
                        marginBottom: 8,
                        background: 'rgba(0, 0, 0, 0.95)',
                        borderRadius: 12,
                        padding: '12px 0',
                        minWidth: 220,
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        zIndex: 100
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{ padding: '0 16px 8px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255, 255, 255, 0.5)', textTransform: 'uppercase' }}>
                            {t('player', 'currentSession')}
                        </span>
                    </div>

                    {/* Forced Subtitles Toggle */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 16px',
                            cursor: 'pointer',
                            transition: 'background 0.2s'
                        }}
                        onClick={onToggleForcedSession}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                        <div>
                            <div style={{ fontSize: 14, color: 'white', fontWeight: 500 }}>
                                Legendas Forçadas
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)', marginTop: 2 }}>
                                Placas e diálogos estrangeiros
                            </div>
                        </div>
                        <div
                            style={{
                                width: 36,
                                height: 20,
                                borderRadius: 10,
                                background: forcedEnabledForSession ? 'linear-gradient(135deg, #a855f7, #ec4899)' : 'rgba(255, 255, 255, 0.2)',
                                position: 'relative',
                                transition: 'background 0.3s'
                            }}
                        >
                            <div
                                style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: '50%',
                                    background: 'white',
                                    position: 'absolute',
                                    top: 2,
                                    left: forcedEnabledForSession ? 18 : 2,
                                    transition: 'left 0.3s'
                                }}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
